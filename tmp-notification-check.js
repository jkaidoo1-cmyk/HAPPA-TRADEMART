const http = require('http');
const assert = require('node:assert/strict');
const app = require('./api/index.js');
const { createSessionToken } = require('./lib/session');

const server = app.listen(0, async () => {
  const port = server.address().port;
  const adminToken = createSessionToken('admin-1', 'admin');
  const userToken = createSessionToken('u-42', 'buyer');
  const req = (path, method, body, token) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text || '{}') });
        } catch {
          resolve({ status: res.statusCode, body: text });
        }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });

  try {
    const post = await req('/api/notifications', 'POST', {
      user_id: 'u-42',
      type: 'system',
      title: 'Hello from admin',
      message: 'Your test notification was saved.',
      is_read: false,
      created_at: new Date().toISOString(),
      action_url: ''
    }, adminToken);

    assert.equal(post.status, 201);
    const rows = await req('/api/notifications?limit=50', 'GET', null, userToken);
    assert.equal(rows.status, 200);
    const data = rows.body.data || [];
    assert.ok(data.some(n => String(n.user_id) === 'u-42' && n.title === 'Hello from admin'));
    console.log('notification verification passed');
  } finally {
    server.close();
  }
});
