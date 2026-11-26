// Horizon (Minecraft Java 26.3 reescrito en Rust): reglas puras, sin Electron, para poder probarlas
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MC_VERSION = '26.3';
// Único origen de descarga: las releases oficiales. No se usan forks ni espejos.
const REPO = 'horizon-rust/horizon';
const INSTALLED = '.installed';          // versión descargada y completa
const PREPARED = '.cubic-prepared';      // recursos generados sin errores

// nombres de los assets del juego (los mismos que declara PLATFORMS en el launcher de Horizon)
const ASSETS = {
  'linux-x64': ['horizon-linux-x86_64.tar.gz'],
  'darwin-arm64': ['horizon-macos-arm64.zip'],
  'darwin-x64': ['horizon-macos-x64.zip'],
  'win32-x64': ['horizon-windows-x64.zip'],
  'win32-arm64': ['horizon-windows-arm64.zip', 'horizon-windows-x64.zip'] // x64 funciona emulado
};
const assetNames = (platform = process.platform, arch = process.arch) => ASSETS[`${platform}-${arch}`] || [];
const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

// nombre de carpeta seguro: nunca puede contener rutas
function safeTag(tag) {
  const t = String(tag || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(t)) throw new Error(`Nombre de versión de Horizon no válido: ${t}`);
  return t;
}
const versionDir = (base, tag) => path.join(base, 'versions', safeTag(tag));
const resourcesDir = (vdir, mc = MC_VERSION) => path.join(vdir, '.local', 'horizon-client', mc);
const isInstalled = vdir => fs.existsSync(path.join(vdir, INSTALLED));
const isPrepared = vdir => fs.existsSync(path.join(resourcesDir(vdir), PREPARED));

// la versión instalada más reciente (la que comparten todas las instancias)
function installedVersion(base) {
  let dirs;
  try { dirs = fs.readdirSync(path.join(base, 'versions'), { withFileTypes: true }); } catch { return null; }
  return dirs
    .filter(d => d.isDirectory() && isInstalled(path.join(base, 'versions', d.name)))
    .map(d => ({ tag: d.name, t: fs.statSync(path.join(base, 'versions', d.name, INSTALLED)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]?.tag || null;
}

// "Nightly 2026-10-28 · 0c02067"  →  nightly-2026-10-28-0c02067 (igual que el launcher de Horizon)
function installTag(release) {
  if (release.tag_name !== 'nightly') return release.tag_name;
  const m = /^Nightly (\d{4}-\d{2}-\d{2})(?: · ([0-9a-fA-F]+))?/.exec(release.name || '');
  const date = m?.[1] || String(release.published_at || '').slice(0, 10);
  return ['nightly', date, m?.[2]].filter(Boolean).join('-');
}

// De la lista de la API de GitHub, la build del juego para este sistema.
// El repo mezcla releases del launcher (launcher@x) con las del juego, y desde octubre de 2026
// el juego solo se publica como la prerelease "nightly": por eso no sirve /releases/latest.
function pickRelease(list, platform = process.platform, arch = process.arch) {
  const names = assetNames(platform, arch);
  if (!names.length) throw new Error(`Horizon no publica versión para este sistema (${platform} ${arch}).`);
  const game = (Array.isArray(list) ? list : [])
    .filter(r => !r.draft && (r.tag_name === 'nightly' || (/^v\d/.test(r.tag_name) && !r.prerelease)))
    .sort((a, b) => (b.tag_name === 'nightly') - (a.tag_name === 'nightly') || String(b.published_at).localeCompare(String(a.published_at)));
  for (const r of game) {
    for (const n of names) {
      const asset = r.assets?.find(a => a.name === n);
      if (asset) return { release: r, asset, tag: installTag(r) };
    }
  }
  throw new Error(`La última release de Horizon no trae un archivo para este sistema (se esperaba ${names[0]}).`);
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Carpeta con distribución del launcher oficial: ¿tiene el cliente 26.3 correcto y lo que hace falta?
async function inspectMinecraftDir(dir, clientSha1, mc = MC_VERSION) {
  const jar = path.join(dir, 'versions', mc, `${mc}.jar`);
  if (!fs.existsSync(jar)) return { ok: false, reason: 'missing-jar', jar };
  if (await sha1File(jar) !== String(clientSha1).toLowerCase()) return { ok: false, reason: 'wrong-jar', jar };
  const need = [path.join('versions', mc, `${mc}.json`), 'libraries', path.join('assets', 'indexes'), path.join('assets', 'objects')];
  if (need.some(n => !fs.existsSync(path.join(dir, n)))) return { ok: false, reason: 'incomplete', jar };
  return { ok: true, dir, jar };
}

function officialMinecraftDirs(platform, home, env = {}) {
  if (platform === 'win32') return [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft')];
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'minecraft')];
  return [path.join(home, '.minecraft'), path.join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft')];
}

// argumentos del preparador; solo se pasan las opciones que la propia build declara (--launch-api)
function prepareArgs({ root, serverJar, minecraftDir, javaHome, options = [] }) {
  const has = n => options.includes(n);
  const args = ['--root', root, '--prepare', '--server-jar', serverJar, '--minecraft-dir', minecraftDir];
  if (has('--java-home')) args.push('--java-home', javaHome);
  if (has('--complete')) args.push('--complete');
  if (has('--progress')) args.push('--progress', 'json');
  return args;
}

// Variables que no deben llegar al juego: ajustes de renderizado del launcher, restos de Electron
// y las rutas que añade el AppImage de Cubic a las librerías.
const STRIP_ENV = [
  'HORIZON_ACCOUNT_SESSIONS', 'HORIZON_SESSION_FILE',
  'LIBGL_ALWAYS_SOFTWARE', 'GALLIUM_DRIVER', 'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DISABLE_COMPOSITING_MODE',
  'ELECTRON_RUN_AS_NODE', 'ELECTRON_OZONE_PLATFORM_HINT', 'CHROME_DESKTOP', 'APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'
];
function gameEnv(env) {
  const out = { ...env };
  const appdir = env.APPDIR;
  if (appdir) {
    for (const k of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) {
      if (!out[k]) continue;
      const keep = out[k].split(':').filter(p => p && !p.startsWith(appdir));
      if (keep.length) out[k] = keep.join(':'); else delete out[k];
    }
  }
  for (const k of STRIP_ENV) delete out[k];
  return out;
}

// Cómo se lanza el juego (misma forma que client_command / client_as del launcher de Horizon).
// Con cuenta Microsoft: --session-file. Con cuenta offline: --name (Horizon calcula el UUID offline).
function buildLaunchCommand({ vdir, home, sessionFile = null, name = null, env = process.env, platform = process.platform }) {
  const e = gameEnv(env);
  e.HORIZON_HOME = home;
  if (e.PIPEWIRE_PROPS === undefined) e.PIPEWIRE_PROPS = '{ application.name = "Horizon" media.role = "Game" }';
  const args = ['--resources', resourcesDir(vdir)];
  if (sessionFile) args.push('--session-file', sessionFile);
  else if (name) args.push('--name', name);
  return { command: path.join(vdir, exe('horizon-client', platform)), args, cwd: home, env: e };
}

// El juego lee el archivo una vez y lo borra; exige permisos 0600 y menos de dos minutos de antigüedad
function writeSessionFile(home, auth) {
  const dir = path.join(home, 'sessions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${crypto.randomBytes(12).toString('hex')}.json`);
  fs.writeFileSync(file, JSON.stringify({
    name: auth.name, uuid: auth.uuid, access_token: auth.access_token, user_type: 'msa',
    ...(auth.meta?.xuid ? { xuid: auth.meta.xuid } : {})
  }), { mode: 0o600, flag: 'wx' });
  return file;
}

module.exports = {
  MC_VERSION, REPO, INSTALLED, PREPARED, exe, safeTag, assetNames, versionDir, resourcesDir,
  isInstalled, isPrepared, installedVersion, installTag, pickRelease, sha1File, inspectMinecraftDir,
  officialMinecraftDirs, prepareArgs, gameEnv, buildLaunchCommand, writeSessionFile
};
