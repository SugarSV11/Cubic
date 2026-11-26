#!/usr/bin/env node
// Descarga a build-resources/animated-logo/ los jars que van DENTRO de Cubic, según
// animated-logo.lock.json, y comprueba cada sha512 contra la API de Modrinth.
// Si algo no cuadra o no hay red, termina con error y la compilación se detiene.
//   node scripts/fetch-animated-logo.js            (lo llama electron-builder antes de empaquetar)
//   node scripts/fetch-animated-logo.js --sources  (además, baja el código fuente a dist-sources/)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build-resources', 'animated-logo');
const UA = { 'User-Agent': 'Cubic-build/1.0' };
const storeName = sha => `${sha.slice(0, 32)}.jar`; // igual que main/animated-logo-core.js

async function get(url) {
  let res;
  try { res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) }); }
  catch (e) { throw new Error(`Sin conexión: no pude acceder a ${new URL(url).host} (${e.cause?.code || e.message}).`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res;
}

function bundledFiles(lock) {
  const ids = new Set(lock.bundledGames.flatMap(mc => {
    if (!lock.games[mc]) throw new Error(`El lock dice incluir Minecraft ${mc}, pero no tiene sus archivos.`);
    return lock.games[mc];
  }));
  return [...ids].map(sha512 => ({ ...lock.files[sha512], sha512 }));
}

// comprueba que Modrinth siga publicando exactamente esos archivos
async function checkAgainstApi(files) {
  const ids = encodeURIComponent(JSON.stringify(files.map(f => f.versionId)));
  const versions = await (await get(`https://api.modrinth.com/v2/versions?ids=${ids}`)).json();
  for (const f of files) {
    const v = versions.find(x => x.id === f.versionId);
    const remote = v?.files.find(x => x.filename === f.filename);
    if (!v || v.project_id !== f.project || !remote) throw new Error(`Modrinth ya no publica ${f.filename} (versión ${f.versionId}).`);
    if (remote.hashes.sha512 !== f.sha512) throw new Error(`El sha512 de ${f.filename} en Modrinth no coincide con animated-logo.lock.json.`);
  }
}

const sha512 = buf => crypto.createHash('sha512').update(buf).digest('hex');

async function fetchJars({ lock, out = OUT, check = checkAgainstApi }) {
  const files = bundledFiles(lock);
  await check(files);
  fs.mkdirSync(out, { recursive: true });
  let bytes = 0;
  for (const f of files) {
    const dest = path.join(out, storeName(f.sha512));
    let data = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (!data || sha512(data) !== f.sha512) {
      console.log(`  descargando ${f.filename} (${f.slug} ${f.version})`);
      data = Buffer.from(await (await get(f.url)).arrayBuffer());
      if (sha512(data) !== f.sha512) throw new Error(`Hash incorrecto en ${f.filename}: la descarga está dañada o fue alterada.`);
      fs.writeFileSync(`${dest}.part`, data);
      fs.renameSync(`${dest}.part`, dest);
    }
    bytes += data.length;
  }
  // nada que no esté en el lock puede colarse en el paquete
  const keep = new Set(files.map(f => storeName(f.sha512)));
  for (const n of fs.readdirSync(out)) if (!keep.has(n)) fs.rmSync(path.join(out, n), { recursive: true, force: true });
  console.log(`Intro animada: ${files.length} jars verificados (${(bytes / 1e6).toFixed(1)} MB).`);
  return { files, bytes };
}

// Copia del código fuente correspondiente, para adjuntarla a cada release
async function fetchSources(files) {
  const dir = path.join(ROOT, 'dist-sources');
  fs.mkdirSync(dir, { recursive: true });
  const seen = new Map(files.map(f => [`${f.source.repo}@${f.source.ref}`, f]));
  for (const f of seen.values()) {
    const name = `${f.slug}-${f.source.ref.replace(/[^\w.+-]/g, '_')}.tar.gz`;
    console.log(`  código fuente ${name}`);
    const res = await get(`${f.source.repo}/archive/${encodeURIComponent(f.source.ref)}.tar.gz`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
  }
  console.log(`Código fuente guardado en ${dir}`);
}

const readLock = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'animated-logo.lock.json'), 'utf8'));
async function main() {
  const { files } = await fetchJars({ lock: readLock() });
  if (process.argv.includes('--sources')) await fetchSources(files);
}

if (require.main === module) {
  main().catch(e => { console.error(`\nERROR (intro animada): ${e.message}\nNo se puede compilar Cubic sin estos archivos.`); process.exit(1); });
}

// hook beforePack de electron-builder: cualquier compilación pasa por aquí
module.exports = async () => { await fetchJars({ lock: readLock() }); };
Object.assign(module.exports, { fetchJars, storeName });
