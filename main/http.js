const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const UA = 'Cubic/1.1.0';

function httpGet(url, headers, cb, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('Solo se permiten descargas HTTPS'));
    const req = https.get(u, { headers: { 'User-Agent': UA, ...headers }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('Demasiadas redirecciones'));
        return resolve(httpGet(new URL(res.headers.location, u).toString(), headers, cb, redirects + 1));
      }
      if (res.statusCode !== 200) {
        // se lee un trozo del cuerpo: muchas APIs explican ahí el motivo real del error
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (body.length < 400) body += c; });
        res.on('end', () => {
          const e = new Error(`HTTP ${res.statusCode} en ${u.host}${u.pathname}`);
          e.statusCode = res.statusCode;
          e.body = body.trim();
          reject(e);
        });
        res.on('error', reject);
        return;
      }
      cb(res, resolve, reject);
    });
    req.on('timeout', () => req.destroy(new Error('Se agotó el tiempo de espera de la red')));
    req.on('error', reject);
  });
}

const getJSON = (url, headers = {}) => httpGet(url, headers, (res, resolve, reject) => {
  let d = '';
  res.setEncoding('utf8');
  res.on('data', c => (d += c));
  res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  res.on('error', reject);
});

// Descarga a un archivo temporal y lo mueve al final. Si pasas sha1, sha256 o sha512, lo verifica.
function download(url, dest, { onProgress, sha1, sha256, sha512, headers = {} } = {}) {
  const tmp = `${dest}.part`;
  return httpGet(url, headers, (res, resolve, reject) => {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let got = 0;
    const expected = sha512 || sha256 || sha1;
    const hash = crypto.createHash(sha512 ? 'sha512' : sha256 ? 'sha256' : 'sha1');
    const out = fs.createWriteStream(tmp);
    res.on('data', c => { got += c.length; hash.update(c); if (total && onProgress) onProgress(got / total); });
    res.on('error', e => { out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); });
    res.pipe(out);
    out.on('error', e => { fs.rmSync(tmp, { force: true }); reject(e); });
    out.on('finish', () => out.close(() => {
      if (expected && hash.digest('hex') !== expected.toLowerCase()) {
        fs.rmSync(tmp, { force: true });
        return reject(new Error('El archivo descargado está corrupto (el hash no coincide)'));
      }
      fs.renameSync(tmp, dest);
      resolve(dest);
    }));
  });
}

// caché en memoria con caducidad (para no repetir peticiones iguales, ni siquiera simultáneas)
const memo = new Map(); // clave -> { v: promesa, t: cuándo llegó, o null si sigue en camino }
function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && (hit.t === null || Date.now() - hit.t < ttlMs)) return hit.v;
  const entry = { t: null };
  entry.v = (async () => fn())();
  memo.set(key, entry);
  entry.v.then(() => { entry.t = Date.now(); }, () => memo.delete(key)); // los errores no se guardan
  return entry.v;
}

// parámetros de URL, sin los vacíos
const query = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();

module.exports = { getJSON, download, cached, query, UA };
