const http = require('http');

function measureApiCall(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    http.get({ hostname: 'localhost', port: 9000, path }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const duration = Date.now() - start;
        resolve({
          duration,
          statusCode: res.statusCode,
          contentEncoding: res.headers['content-encoding'],
          cacheControl: res.headers['cache-control'],
          bodyLength: body.length
        });
      });
    }).on('error', reject);
  });
}

async function runPerfTest() {
  console.log('=== TESTING API PERFORMANCE & HEADERS ===\n');
  
  // First call (uncached or warm)
  const res1 = await measureApiCall('/api/products?limit=50');
  console.log(`Call 1 (/api/products): ${res1.duration} ms | Cache-Control: ${res1.cacheControl}`);

  // Second call (in-memory cached)
  const res2 = await measureApiCall('/api/products?limit=50');
  console.log(`Call 2 (/api/products - RAM cached): ${res2.duration} ms | Cache-Control: ${res2.cacheControl}`);

  console.log('\n✅ Performance check completed!');
}

runPerfTest().catch(err => console.error(err));
