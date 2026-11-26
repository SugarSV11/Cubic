// Horizon: descarga, preparación de recursos y arranque
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const MclcHandler = require('minecraft-launcher-core/components/handler');
const C = require('./horizon-core');
const { SHARED, HORIZON } = require('./paths');
const { getJSON, download } = require('./http');
const { ensureJava, extract } = require('./java');
const { send, log } = require('./bus');
const accounts = require('./accounts');
const store = require('./store');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NO_JAR = 'Horizon necesita tu propia copia de Minecraft Java 26.3. Cómprala, ábrela una vez en la 26.3 con el launcher oficial y reintenta, o pulsa «Descargar 26.3».';

// ----- estado que ve la interfaz -----
let state = { running: false, text: '', progress: null, error: null, code: null };
let job = null;
let child = null;
const listeners = new Set();
const getState = () => ({ ...state, tag: C.installedVersion(HORIZON), ready: isReady() });
function isReady() {
  const tag = C.installedVersion(HORIZON);
  return !!tag && C.isPrepared(C.versionDir(HORIZON, tag));
}
function publish(patch) {
  state = { ...state, ...patch };
  send('horizon', getState());
  for (const fn of listeners) fn(state);
}
const step = (text, progress = null) => publish({ text, progress });

// reintenta fallos de red y errores del servidor; un 404 o un 403 no se arreglan repitiendo
async function retry(what, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const permanent = e.statusCode && e.statusCode < 500;
      if (permanent || i >= tries) throw netError(e);
      log(`[Horizon] ${what}: ${e.message} (intento ${i} de ${tries})`);
      step(`${what}: reintentando (${i + 1}/${tries})…`);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}
function netError(e) {
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT'].includes(e?.code) || /tiempo de espera/.test(e?.message)) {
    return new Error('Sin conexión a internet (o el servidor no responde). Revisa la red y reintenta.');
  }
  return e;
}

// ----- 1) la build del juego -----
async function installRelease() {
  step('Buscando la última versión de Horizon…');
  let list;
  try {
    list = await retry('Consultando GitHub', () => getJSON(`https://api.github.com/repos/${C.REPO}/releases?per_page=30`, { Accept: 'application/vnd.github+json' }));
  } catch (e) {
    if (e.statusCode === 404) throw new Error(`Las descargas oficiales de Horizon no están disponibles: GitHub responde 404 para ${C.REPO}. Cubic no lo descarga de otros sitios.`);
    if (e.statusCode === 403 || e.statusCode === 429) throw new Error('GitHub limitó las consultas desde tu red. Espera un rato y reintenta.');
    throw e;
  }
  const { asset, tag } = C.pickRelease(list);
  const dir = C.versionDir(HORIZON, tag);
  if (C.isInstalled(dir)) return tag;

  const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')?.[1];
  if (!sha256) throw new Error(`La release no publica el hash de ${asset.name}: no se puede verificar la descarga.`);

  const part = `${dir}.part`;
  fs.rmSync(part, { recursive: true, force: true });
  const unpacked = path.join(part, 'unpacked');
  fs.mkdirSync(unpacked, { recursive: true });
  try {
    const archive = path.join(part, path.basename(asset.name));
    await retry('Descargando Horizon', () => download(asset.browser_download_url, archive, { sha256, onProgress: p => step('Descargando Horizon…', p) }));
    step('Instalando Horizon…');
    await extract(archive, unpacked, 'No se pudo extraer Horizon');
    // el archivo trae una carpeta raíz (horizon-linux-x86_64/…): su contenido es la versión
    const entries = fs.readdirSync(unpacked, { withFileTypes: true });
    const top = entries.length === 1 && entries[0].isDirectory() ? path.join(unpacked, entries[0].name) : unpacked;
    for (const bin of ['horizon-client', 'horizon-prepare']) {
      const p = path.join(top, C.exe(bin));
      if (!fs.existsSync(p)) throw new Error(`La descarga de Horizon no incluye ${C.exe(bin)}.`);
      if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(top, dir);
    fs.writeFileSync(path.join(dir, C.INSTALLED), '');
  } finally { fs.rmSync(part, { recursive: true, force: true }); }
  return tag;
}

// ----- 2) los archivos de Minecraft 26.3 del propio usuario -----
// Cubic solo baja archivos de Mojang para una cuenta Microsoft que tenga el juego
async function requireOwner() {
  const ms = store.getAccounts().filter(a => a.type === 'microsoft');
  const acc = ms.find(a => a.id === store.config.selectedAccount) || ms[0];
  if (!acc) throw new Error('Horizon requiere tu copia de Minecraft Java: inicia sesión en Cuentas con la cuenta de Microsoft que lo tiene.');
  await accounts.getAuth(acc.id);
}

const mcdirs = () => [...C.officialMinecraftDirs(process.platform, os.homedir(), process.env), SHARED];

async function mojangVersion() {
  const m = await retry('Consultando Mojang', () => getJSON(MANIFEST));
  const entry = m.versions.find(v => v.id === C.MC_VERSION);
  if (!entry) throw new Error(`Mojang ya no lista Minecraft ${C.MC_VERSION}.`);
  return { entry, json: await retry('Consultando Mojang', () => getJSON(entry.url)) };
}

// Descarga 26.3 en la carpeta compartida de Cubic, con las mismas funciones de MCLC que usa Vanilla
async function downloadVanilla(clientSha1) {
  await requireOwner();
  const mc = C.MC_VERSION;
  const { entry, json } = await mojangVersion();
  if (json.downloads.client.sha1 !== clientSha1) throw new Error('El cliente 26.3 de Mojang no coincide con el que espera esta versión de Horizon.');
  const vdir = path.join(SHARED, 'versions', mc);
  fs.mkdirSync(vdir, { recursive: true });
  const jar = path.join(vdir, `${mc}.jar`);
  await retry('Descargando Minecraft', () => download(json.downloads.client.url, jar, { sha1: clientSha1, onProgress: p => step('Descargando Minecraft 26.3…', p) }));

  const names = { assets: 'Descargando assets de Minecraft', classes: 'Descargando librerías de Minecraft' };
  const handler = new MclcHandler({
    options: { root: SHARED, directory: vdir, version: { number: mc }, overrides: { maxSockets: 4, url: { resource: 'https://resources.download.minecraft.net' } } },
    emit: (ev, p) => { if (ev === 'progress' && names[p.type]) step(`${names[p.type]}…`, p.total ? p.task / p.total : null); else if (ev === 'debug') log(p); }
  });
  handler.version = json;
  step('Descargando librerías de Minecraft…');
  await handler.getClasses(null);
  step('Descargando assets de Minecraft…');
  await handler.getAssets();

  // el preparador comprueba los archivos tal cual los publica Mojang
  await retry('Descargando datos de 26.3', () => download(entry.url, path.join(vdir, `${mc}.json`), { sha1: entry.sha1 }));
  const indexes = path.join(SHARED, 'assets', 'indexes');
  await retry('Descargando índice de assets', () => download(json.assetIndex.url, path.join(indexes, `${json.assetIndex.id}.json`), { sha1: json.assetIndex.sha1 }));
  // MCLC no avisa de los archivos que fallan: se comprueba que estén todos
  const index = JSON.parse(fs.readFileSync(path.join(indexes, `${json.assetIndex.id}.json`), 'utf8'));
  if (Object.values(index.objects).some(o => !fs.existsSync(path.join(SHARED, 'assets', 'objects', o.hash.slice(0, 2), o.hash)))) {
    throw new Error('Faltaron archivos de Minecraft al descargar. Revisa la conexión y reintenta.');
  }
}

async function findMinecraft(clientSha1, allowDownload) {
  step('Comprobando tu Minecraft 26.3…');
  let wrong = null;
  for (const dir of mcdirs()) {
    const r = await C.inspectMinecraftDir(dir, clientSha1);
    if (r.ok) return dir;
    if (r.reason === 'wrong-jar') wrong = r.jar;
  }
  if (allowDownload) {
    await downloadVanilla(clientSha1);
    const r = await C.inspectMinecraftDir(SHARED, clientSha1);
    if (r.ok) return SHARED;
    throw new Error('La descarga de Minecraft 26.3 quedó incompleta. Reintenta.');
  }
  const e = new Error(wrong ? `El archivo ${wrong} no es el cliente de Minecraft 26.3 (el checksum no coincide). ${NO_JAR}` : NO_JAR);
  e.code = 'NO_JAR';
  throw e;
}

// ----- 3) preparar recursos (una sola vez por versión) -----
// Ejecuta un programa de Horizon. Devuelve su salida; con --progress json actualiza la barra.
function run(bin, args, { cwd, env, onLine }) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, env, windowsHide: true });
    child = p;
    let out = '', buf = '';
    const tail = [];
    const feed = chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) { tail.push(l); if (tail.length > 15) tail.shift(); onLine?.(l); }
    };
    p.stdout.setEncoding('utf8').on('data', d => { out += d; feed(d); });
    p.stderr.setEncoding('utf8').on('data', feed);
    p.on('error', e => { child = null; reject(new Error(`No se pudo ejecutar ${path.basename(bin)}: ${e.message}`)); });
    p.on('close', code => {
      child = null;
      if (buf) { tail.push(buf); onLine?.(buf); }
      if (code === 0) return resolve(out);
      const e = new Error(`${path.basename(bin)} falló (código ${code ?? 'sin código'}): ${tail.slice(-4).join(' · ')}`);
      e.exitCode = code;
      reject(e);
    });
  });
}

async function prepare(vdir, allowDownload) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(path.join(vdir, 'research-lock.json'), 'utf8')).minecraft; }
  catch { throw new Error('La versión descargada de Horizon no trae research-lock.json.'); }
  if (lock.version !== C.MC_VERSION) throw new Error(`Esta build de Horizon es para Minecraft ${lock.version}; Cubic solo admite ${C.MC_VERSION}.`);

  const minecraftDir = await findMinecraft(lock.client_sha1, allowDownload);

  // Horizon necesita además el server.jar de 26.3, que ningún launcher guarda
  const serverJar = path.join(HORIZON, 'server-jars', `${C.MC_VERSION}.jar`);
  if (!fs.existsSync(serverJar) || await C.sha1File(serverJar) !== lock.server_sha1) {
    await requireOwner();
    const { json } = await mojangVersion();
    if (json.downloads.server.sha1 !== lock.server_sha1) throw new Error('El servidor 26.3 de Mojang no coincide con el que espera esta versión de Horizon.');
    fs.mkdirSync(path.dirname(serverJar), { recursive: true });
    await retry('Descargando server.jar', () => download(json.downloads.server.url, serverJar, { sha1: lock.server_sha1, onProgress: p => step('Descargando server.jar 26.3…', p) }));
  }

  const major = lock.java_major || 25;
  let javaHome;
  try {
    // el preparador puede necesitar compilar: se pide el JDK, no solo el runtime
    const java = await retry(`Descargando Java ${major}`, () => ensureJava(major, { image: 'jdk', report: step }));
    javaHome = path.dirname(path.dirname(java));
  } catch (e) { throw new Error(`Java ${major} no está disponible: ${e.message}`); }

  const bin = path.join(vdir, C.exe('horizon-prepare'));
  const env = { ...C.gameEnv(process.env), JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}` };
  let options = [];
  try { options = JSON.parse(await run(bin, ['--launch-api', '--root', vdir], { cwd: vdir, env })).options.map(o => o.name); }
  catch (e) { log(`[Horizon] sin Launch API: ${e.message}`); }

  step('Preparando texturas y sonidos (solo la primera vez)…');
  const onLine = line => {
    let m = null;
    try { m = JSON.parse(line); } catch { /* texto normal */ }
    if (m && typeof m.fraction === 'number') return step('Preparando texturas y sonidos…', m.fraction);
    const text = m ? m.message || m.error : line;
    if (text) log(`[Horizon] ${text}`);
  };
  await run(bin, C.prepareArgs({ root: vdir, serverJar, minecraftDir, javaHome, options }), { cwd: vdir, env, onLine });
  // builds sin --complete: los sonidos son un paso aparte (opcional para jugar)
  if (!options.includes('--complete')) {
    step('Copiando sonidos…');
    try { await run(bin, ['sounds', '--root', vdir, '--minecraft-dir', minecraftDir], { cwd: vdir, env, onLine }); }
    catch (e) { log(`[Horizon] Sin sonidos: ${e.message}`); }
  }
  const res = C.resourcesDir(vdir);
  if (!fs.existsSync(res)) throw new Error('El preparador terminó pero no creó los recursos.');
  fs.writeFileSync(path.join(res, C.PREPARED), '');
}

// Deja Horizon listo. Todas las instancias comparten la misma descarga y la misma ejecución.
function ensureInstalled({ download: allowDownload = false } = {}) {
  if (job) return job;
  job = (async () => {
    publish({ running: true, text: 'Preparando Horizon…', progress: null, error: null, code: null });
    try {
      let tag = C.installedVersion(HORIZON);
      if (!tag || !C.isPrepared(C.versionDir(HORIZON, tag))) {
        if (!store.getAccounts().some(a => a.type === 'microsoft')) await requireOwner();
        tag = tag || await installRelease();
        const vdir = C.versionDir(HORIZON, tag);
        if (!C.isPrepared(vdir)) await prepare(vdir, allowDownload);
      }
      publish({ running: false, text: 'Horizon listo', progress: 1 });
      return tag;
    } catch (e) {
      log(`[Horizon] Error: ${e?.stack || e}`);
      publish({ running: false, text: '', progress: null, error: e.message, code: e.code === 'NO_JAR' ? 'NO_JAR' : null });
      throw e;
    } finally { job = null; }
  })();
  return job;
}

// ----- jugar -----
const EARLY_MS = 5000;
const SIGNALS = { SIGSEGV: 139, SIGABRT: 134, SIGILL: 132, SIGBUS: 135, SIGFPE: 136 };

// Arranca el juego. Si se cierra al instante con error, rechaza con las últimas líneas del log.
async function start({ home, accountId, onProgress, onClose }) {
  const listener = s => { if (s.running) onProgress?.(s.text, s.progress); };
  listeners.add(listener);
  let tag;
  try { tag = await ensureInstalled(); } finally { listeners.delete(listener); }

  const acc = store.getAccounts().find(a => a.id === accountId);
  const auth = await accounts.getAuth(accountId);
  fs.mkdirSync(home, { recursive: true });
  const sessionFile = acc.type === 'microsoft' ? C.writeSessionFile(home, auth) : null;
  const cleanSession = () => { if (sessionFile) fs.rmSync(sessionFile, { force: true }); };

  const c = C.buildLaunchCommand({ vdir: C.versionDir(HORIZON, tag), home, sessionFile, name: auth.name });
  onProgress?.('Lanzando Horizon…', null);
  const proc = spawn(c.command, c.args, { cwd: c.cwd, env: c.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tail = [];
  const feed = d => { log(d); tail.push(...String(d).split('\n').filter(l => l.trim())); tail.splice(0, Math.max(0, tail.length - 20)); };
  proc.stdout.setEncoding('utf8').on('data', feed);
  proc.stderr.setEncoding('utf8').on('data', feed);

  return new Promise((resolve, reject) => {
    let started = false, settled = false;
    const timer = setTimeout(() => { started = true; settled = true; resolve(proc); }, EARLY_MS);
    proc.on('error', e => {
      clearTimeout(timer); cleanSession();
      if (!settled) { settled = true; reject(new Error(`No se pudo ejecutar Horizon: ${e.message}`)); }
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timer); cleanSession();
      const exit = code ?? SIGNALS[signal] ?? 0;
      if (started) return onClose(exit);
      if (settled) return;
      settled = true;
      if (exit === 0) { resolve(proc); return setImmediate(() => onClose(0)); }
      reject(new Error(`Horizon se cerró al arrancar (código ${exit}). ${tail.slice(-4).join(' · ') || 'No escribió nada en el log.'}`));
    });
  });
}

const isInstalling = () => !!job;
const abort = () => { if (child) child.kill(); };

module.exports = { ensureInstalled, start, getState, isInstalling, abort };
