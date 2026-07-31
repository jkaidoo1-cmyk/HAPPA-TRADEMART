const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9000/api/' + path, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function testChartCalculation() {
  const pkgsRes = await get('packages?limit=200');
  const packages = pkgsRes.data || [];
  
  console.log(`Total packages found: ${packages.length}`);
  
  const now = new Date();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const data = [0, 0, 0, 0, 0];

  packages.forEach(p => {
    if (p.vendor_status === 'rejected' || p.status === 'cancelled') return;
    const dateStr = p.created_at || p.updated_at;
    if (!dateStr) return;
    const pkgDate = new Date(dateStr);
    const diffMs = now - pkgDate;
    if (diffMs < 0 || diffMs > 5 * oneWeekMs) return;

    const bucketIndex = 4 - Math.floor(diffMs / oneWeekMs);
    if (bucketIndex >= 0 && bucketIndex < 5) {
      const comm = parseFloat(p.commission_amount || p.platform_fee || 0);
      data[bucketIndex] += comm;
      console.log(`  Package ${p.code || p.id}: commission GHS ${comm} placed in W${bucketIndex + 1}`);
    }
  });

  console.log('Weekly Revenue Chart Buckets [W1..W5]:', data.map(v => v.toFixed(2)));
}

testChartCalculation().catch(console.error);
