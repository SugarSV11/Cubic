// Descarga automática de Java desde Adoptium
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { JAVA } = require('./paths');
const { download } = require('./http');
const { status } = require('./bus');

function javaBin(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const f of entries) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) stack.push(p);
      else if (f.name === exe && path.basename(d) === 'bin') return p;
    }
  }
  return null;
}

function extract(archive, dest) {
  return new Promise((resolve, reject) => {
    // tar viene en Linux, macOS y Windows 10+ (y en Windows también abre .zip)
    const t = spawn('tar', ['-xf', archive, '-C', dest]);
    t.on('close', code => (code === 0 ? resolve() : reject(new Error('No se pudo extraer Java'))));
    t.on('error', reject);
  });
}

// Adoptium ya no publica Java 16 (lo pide Minecraft 1.17): con Java 17 funciona
const REPLACEMENT = { 16: 17 };

async function ensureJava(wanted) {
  const major = REPLACEMENT[wanted] || wanted;
  const dir = path.join(JAVA, String(major));
  const existing = fs.existsSync(dir) && javaBin(dir);
  if (existing) return existing;

  fs.mkdirSync(JAVA, { recursive: true });
  const osName = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch] || 'x64';
  const archive = path.join(JAVA, `java${major}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;

  status(`Descargando Java ${major}…`, 0);
  await download(url, archive, { onProgress: p => status(`Descargando Java ${major}…`, p) });

  status(`Instalando Java ${major}…`, null);
  // se extrae a una carpeta temporal y luego se renombra: nunca queda un Java a medias
  const part = `${dir}.part`;
  fs.rmSync(part, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(part, { recursive: true });
  try { await extract(archive, part); } finally { fs.rmSync(archive, { force: true }); }
  fs.renameSync(part, dir);

  const bin = javaBin(dir);
  if (!bin) throw new Error('Java descargado pero no encontré el ejecutable');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  return bin;
}

module.exports = { ensureJava };
