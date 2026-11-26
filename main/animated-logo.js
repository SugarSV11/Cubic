// Intro animada: de dónde salen los jars y cuándo se aplica a cada instancia
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const C = require('./animated-logo-core');
const { SHARED } = require('./paths');
const { download } = require('./http');
const { log, status } = require('./bus');
const instances = require('./instances');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const lock = store.readJSON(path.join(ROOT, 'animated-logo.lock.json'), { games: {}, files: {} });
// jars incluidos con Cubic (los pone scripts/fetch-animated-logo.js al compilar)
const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'animated-logo') : path.join(ROOT, 'build-resources', 'animated-logo'));
const licensesDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'licenses') : ROOT);
const cacheDir = path.join(SHARED, 'animated-logo'); // versiones no incluidas: se bajan una sola vez

async function locate(file, allowDownload) {
  const name = C.storeName(file.sha512);
  const bundled = path.join(bundledDir(), name);
  if (fs.existsSync(bundled)) return bundled;
  const cached = path.join(cacheDir, name);
  if (fs.existsSync(cached)) return cached;
  if (!allowDownload) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  status(`Descargando intro animada: ${file.slug}…`, 0);
  await download(file.url, cached, { sha512: file.sha512, onProgress: p => status(`Descargando intro animada: ${file.slug}…`, p) });
  return cached;
}

// una instancia cada vez: dos sincronizaciones a la vez se pisarían los archivos
let queue = Promise.resolve();
function sync(id, { download: allowDownload = false } = {}) {
  const run = async () => {
    const inst = instances.get(id);
    const r = await C.sync({
      dir: instances.dirOf(id), inst, lock, globalOn: store.config.animatedLogo,
      userFiles: new Set(Object.values(instances.readInstalled(id)).map(v => v.file)),
      locate: f => locate(f, allowDownload)
    });
    if (r.reason === 'no-build') log(`[Cubic] Sin intro animada para Minecraft ${inst.version}.`);
    instances.patch(id, { logo: r.logo, logoState: r.logoState });
    return r;
  };
  const p = queue.then(run);
  queue = p.catch(() => {});
  return p;
}

// para cambios que no deben fallar por culpa de la intro (sin red, disco lleno…)
const trySync = (id, opts) => sync(id, opts).catch(e => { log(`[Cubic] Intro animada en «${id}»: ${e.message}`); return { active: false }; });

// migración suave y cambios del ajuste global: solo con lo que ya hay en el disco
async function syncAll(skip) {
  for (const i of instances.list()) if (i.id !== skip) await trySync(i.id);
}

// interruptor por instancia: true, false o null (usar el ajuste global)
function setOverride(id, value) {
  const inst = instances.get(id);
  const logo = value === true || value === false ? value : null;
  const logoState = { ...(inst.logoState || { files: [] }) };
  // encenderlo a mano revoca el «lo borré»; los jars que faltan se vuelven a copiar
  if (logo === true) { logoState.removed = false; logoState.mc = undefined; }
  logoState.on = false;
  logoState.note = 'changed';
  instances.patch(id, { logo, logoState });
}

const describe = inst => C.describe(inst, lock, store.config.animatedLogo);
const info = () => ({ version: lock.mod?.version || null, games: Object.keys(lock.games) });

module.exports = { sync, trySync, syncAll, setOverride, describe, info, licensesDir };
