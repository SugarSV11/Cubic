// Navegador e instalador de mods / resourcepacks / shaders
const fs = require('fs');
const path = require('path');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const instances = require('./instances');
const { download } = require('./http');
const { send } = require('./bus');

const SOURCES = { modrinth, curseforge };
const FOLDER = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const src = s => SOURCES[s] || (() => { throw new Error('Fuente desconocida'); })();
const kindOk = k => { if (!FOLDER[k]) throw new Error('Tipo inválido'); return k; };

// Mods en loader Vanilla no funcionan: se avisa claro en vez de instalar a ciegas
function checkInstance(inst, kind) {
  if (kind === 'mod' && inst.loader === 'vanilla') return 'Es una instancia Vanilla: no admite mods (usa Fabric o Quilt).';
  if (kind === 'shader' && inst.loader === 'vanilla') return 'Los shaders necesitan el mod Iris: usa una instancia Fabric o Quilt.';
  return null;
}

// Los shaders no se ven sin Iris (que a su vez trae Sodium)
function hasIris(instanceId) {
  const dir = instances.kindDir(instanceId, 'mods');
  return fs.existsSync(dir) && fs.readdirSync(dir).some(f => /^iris[-_].*\.jar$/i.test(f));
}
const irisFor = inst => modrinth.resolve({ id: 'iris', kind: 'mod', version: inst.version, loader: inst.loader });

// El mismo mod desde Modrinth y desde CurseForge haría que el juego no arranque: se compara por nombre
const norm = t => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|[^a-z0-9]/g, '');
const sameTitle = (map, folder, title) => Object.values(map).some(v => v.kind === folder && norm(v.title) === norm(title));

async function compat(source, id, kind) {
  kindOk(kind);
  const S = src(source);
  const out = [];
  for (const inst of instances.list()) {
    const map = instances.readInstalled(inst.id);
    let installed = !!map[`${source}:${id}`];
    const why = checkInstance(inst, kind);
    if (why) { out.push({ id: inst.id, ok: false, reason: why, installed }); continue; }
    try {
      const r = await S.resolve({ id, kind, version: inst.version, loader: inst.loader });
      if (r?.title) installed = installed || sameTitle(map, FOLDER[kind], r.title);
      if (r && kind === 'shader' && !hasIris(inst.id) && !(await irisFor(inst))) {
        out.push({ id: inst.id, ok: false, installed, reason: `Iris (necesario para shaders) todavía no existe para Minecraft ${inst.version}.` });
        continue;
      }
      out.push(r
        ? { id: inst.id, ok: true, installed, blocked: !!r.blocked }
        : { id: inst.id, ok: false, installed, reason: `No hay versión para Minecraft ${inst.version}${kind === 'mod' ? ` con ${inst.loader}` : ''}.` });
    } catch (e) { out.push({ id: inst.id, ok: false, installed, reason: e.message }); }
  }
  return out;
}

async function install({ source, id, kind, instanceId }) {
  kindOk(kind);
  const S = src(source);
  const inst = instances.get(instanceId);
  const why = checkInstance(inst, kind);
  if (why) throw new Error(why);

  const installedMap = instances.readInstalled(instanceId);
  const result = { installed: [], skipped: [], blocked: [], missing: [] };
  const seen = new Set();

  async function one(pid, k, depth, from = source) {
    const key = `${from}:${pid}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (installedMap[key]) { result.skipped.push(installedMap[key].title); return; }

    send('install-progress', { text: depth ? 'Instalando dependencias…' : 'Buscando la versión correcta…', progress: null });
    const r = await SOURCES[from].resolve({ id: pid, kind: k, version: inst.version, loader: inst.loader });
    if (!r) {
      if (depth === 0) throw new Error(`No hay versión compatible con Minecraft ${inst.version}${k === 'mod' ? ` (${inst.loader})` : ''}.`);
      result.missing.push(String(pid));
      return;
    }
    if (r.blocked) { result.blocked.push({ title: r.title, url: r.website }); return; }
    if (sameTitle(installedMap, FOLDER[k], r.title)) { result.skipped.push(r.title); return; }

    const dir = instances.kindDir(instanceId, FOLDER[k]);
    fs.mkdirSync(dir, { recursive: true });
    const filename = path.basename(r.file.filename);
    if (!filename || filename.startsWith('.')) throw new Error('Nombre de archivo inválido');
    const dest = path.join(dir, filename);
    if (!fs.existsSync(dest)) {
      await download(r.file.url, dest, { sha1: r.file.sha1, onProgress: p => send('install-progress', { text: `Descargando ${r.title}…`, progress: p }) });
    }
    const entry = { title: r.title, file: filename, source: from, kind: FOLDER[k], versionId: r.versionId };
    instances.markInstalled(instanceId, key, entry);
    installedMap[key] = entry;
    result.installed.push(r.title);
    if (depth < 6) for (const dep of r.deps) await one(dep, 'mod', depth + 1, from);
  }

  const needsIris = kind === 'shader' && !hasIris(instanceId);
  if (needsIris && !(await irisFor(inst))) throw new Error(`Iris (necesario para shaders) todavía no existe para Minecraft ${inst.version}.`);
  await one(String(id), kind, 0);
  if (needsIris) await one((await modrinth.detail('iris')).id, 'mod', 1, 'modrinth');
  send('install-progress', { text: 'Listo', progress: null });
  return { ...result, instanceName: inst.name };
}

function register(handle) {
  handle('mods:categories', (source, kind) => src(source).categories(kindOk(kind)));
  handle('mods:search', async q => {
    kindOk(q.kind);
    const r = await src(q.source).search({ ...q, limit: Math.min(+q.limit || 20, 50), offset: Math.max(0, +q.offset || 0) });
    if (q.instanceId) {
      const inst = instances.readInstalled(q.instanceId);
      for (const h of r.hits) h.installed = !!inst[`${q.source}:${h.id}`];
    }
    return r;
  });
  handle('mods:detail', (source, id, kind) => src(source).detail(String(id), kindOk(kind)));
  handle('curseforge:test', key => curseforge.testKey(key));
  handle('mods:compat', compat);
  handle('mods:install', install);
}

module.exports = { register };
