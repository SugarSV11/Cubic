// Descargas: hash, archivos parciales, redirecciones y errores (red simulada)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const http = require('../main/http');

const routes = new Map();
let requests = 0;
https.get = (url, _opts, cb) => {
  requests++;
  const req = new EventEmitter();
  req.destroy = e => req.emit('error', e);
  const r = routes.get(url.href);
  process.nextTick(() => {
    if (!r) return req.emit('error', Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
    const res = r.truncated
      ? new Readable({ read() { this.push('par'); this.destroy(new Error('aborted')); } })
      : Readable.from([Buffer.from(r.body || '')]);
    res.statusCode = r.status || 200;
    res.headers = r.headers || { 'content-length': String(Buffer.byteLength(r.body || '')) };
    cb(res);
  });
  return req;
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-http-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const hash = (a, s) => crypto.createHash(a).update(s).digest('hex');
const left = () => fs.readdirSync(dir);

test('verifica sha1, sha256 y sha512', async () => {
  routes.set('https://a/f', { body: 'hola' });
  for (const a of ['sha1', 'sha256', 'sha512']) {
    const seen = [];
    await http.download('https://a/f', path.join(dir, a), { [a]: hash(a, 'hola').toUpperCase(), onProgress: p => seen.push(p) });
    assert.strictEqual(fs.readFileSync(path.join(dir, a), 'utf8'), 'hola');
    assert.strictEqual(seen.at(-1), 1);
    await assert.rejects(http.download('https://a/f', path.join(dir, 'mal'), { [a]: hash(a, 'otro') }), /corrupto/);
  }
  assert.deepStrictEqual(left().sort(), ['sha1', 'sha256', 'sha512']);
});

test('sigue redirecciones, solo https, y no deja parciales si falla', async () => {
  routes.set('https://a/r', { status: 302, headers: { location: '/f' } });
  await http.download('https://a/r', path.join(dir, 'redir'));
  await assert.rejects(async () => http.download('http://a/f', path.join(dir, 'x')), /Solo se permiten descargas HTTPS/);
  routes.set('https://a/404', { status: 404, body: ' motivo ' });
  await assert.rejects(http.download('https://a/404', path.join(dir, 'x')), e => e.statusCode === 404 && e.body === 'motivo');
  routes.set('https://a/loop', { status: 302, headers: { location: '/loop' } });
  await assert.rejects(http.download('https://a/loop', path.join(dir, 'x')), /Demasiadas redirecciones/);
  routes.set('https://a/corta', { truncated: true });
  await assert.rejects(http.download('https://a/corta', path.join(dir, 'x')), /aborted/);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(!left().some(f => f.startsWith('x')), left().join());
});

test('getJSON y errores de red', async () => {
  routes.set('https://a/j', { body: '{"a":1}' });
  assert.deepStrictEqual(await http.getJSON('https://a/j'), { a: 1 });
  routes.set('https://a/mal', { body: '<html>' });
  await assert.rejects(http.getJSON('https://a/mal'), SyntaxError);
  await assert.rejects(http.getJSON('https://sin-red/'), { code: 'ENOTFOUND' });
});

test('caché: reutiliza, caduca y no guarda errores', async t => {
  let now = 0, n = 0;
  t.mock.method(Date, 'now', () => now);
  const fn = async () => ++n;
  assert.strictEqual(await http.cached('k', 100, fn), 1);
  assert.strictEqual(await http.cached('k', 100, fn), 1);
  now = 150;
  assert.strictEqual(await http.cached('k', 100, fn), 2);
  await assert.rejects(http.cached('e', 100, async () => { throw new Error('x'); }), /x/);
  assert.strictEqual(await http.cached('e', 100, fn), 3);
});
