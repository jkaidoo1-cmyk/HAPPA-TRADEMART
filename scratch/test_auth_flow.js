const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 9000,
      path: '/api/' + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function testAuth() {
  console.log('Testing authentication endpoint...');
  const res = await post('auth/login', { email: 'admin@happatrademart.com', password: 'admin123' });
  console.log('Login Status:', res.status);
  console.log('Token Received:', !!res.body.token);
  console.log('User Role:', res.body.user?.role);
}

testAuth().catch(console.error);
