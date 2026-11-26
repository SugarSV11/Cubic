// Instancias: cada una con su propia carpeta (mods, config, saves, resourcepacks…)
const fs = require('fs');
const path = require('path');
const { INSTANCES } = require('./paths');
const store = require('./store');

const ICONS = ['tree', 'pickaxe', 'sword', 'castle', 'flame', 'gem', 'moon', 'flask', 'rocket', 'flower', 'ghost', 'cube'];
// instancias creadas con la versión anterior guardaban emojis: se traducen a los iconos nuevos
const LEGACY_ICONS = { '🌲': 'tree', '⛏️': 'pickaxe', '🗡️': 'sword', '🏰': 'castle', '🐉': 'cube', '💎': 'gem', '🔥': 'flame', '🌙': 'moon', '🧪': 'flask', '🚀': 'rocket', '🌸': 'flower', '👾': 'ghost' };
const normIcon = i => (ICONS.includes(i) ? i : LEGACY_ICONS[i] || ICONS[0]);
const LOADER_LABEL = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };
const LOADERS = ['vanilla', 'fabric', 'quilt'];

const safeName = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 60);

// el id es el nombre de la carpeta; nunca puede contener rutas
function dirOf(id) {
  if (!id || id !== path.basename(String(id)) || id.startsWith('.')) throw new Error('Instancia inválida');
  return path.join(INSTANCES, id);
}
const metaFile = id => path.join(dirOf(id), 'instance.json');

function get(id) {
  const m = store.readJSON(metaFile(id), null);
  if (!m) throw new Error('Instancia no encontrada');
  return { loader: 'vanilla', ram: 4, ...m, icon: normIcon(m.icon), id };
}

function list() {
  fs.mkdirSync(INSTANCES, { recursive: true });
  const out = [];
  for (const d of fs.readdirSync(INSTANCES, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try { out.push(get(d.name)); } catch { /* carpeta sin instance.json */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueFolder(name) {
  let id = name, n = 2;
  while (fs.existsSync(path.join(INSTANCES, id))) id = `${name} (${n++})`;
  return id;
}

function validate(d) {
  if (!d.version) throw new Error('Elige una versión de Minecraft.');
  if (!LOADERS.includes(d.loader)) throw new Error('Loader no soportado.');
  const typed = String(d.name ?? '').trim();
  let name = safeName(typed);
  // sin nombre → uno por defecto (ej: "1.21.1 Fabric"); si escribió solo caracteres prohibidos, sí es un error
  if (!typed) name = `${d.version} ${LOADER_LABEL[d.loader]}`;
  else if (!name) throw new Error('El nombre solo tiene caracteres no permitidos (\\ / : * ? " < > |).');
  const ram = Math.max(2, Math.floor(Number(d.ram) || 4));
  return { name, version: String(d.version), loader: d.loader, ram, icon: normIcon(d.icon) };
}

function create(d) {
  const v = validate(d);
  const id = uniqueFolder(v.name);
  const dir = dirOf(id);
  for (const sub of ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  store.writeJSON(metaFile(id), { ...v, name: id, created: Date.now() }); // id = nombre único de carpeta
  return get(id);
}

function update(id, d) {
  const old = get(id);
  const v = validate({ ...old, ...d });
  store.writeJSON(metaFile(id), { ...old, ...v, id: undefined });
  return get(id);
}

function duplicate(id) {
  const old = get(id);
  const nid = uniqueFolder(safeName(`${old.name} (copia)`));
  fs.cpSync(dirOf(id), dirOf(nid), { recursive: true });
  store.writeJSON(metaFile(nid), { ...old, id: undefined, name: nid, created: Date.now() });
  return get(nid);
}

function remove(id) {
  get(id); // verifica que existe y que es una instancia
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  if (store.config.selectedInstance === id) { store.config.selectedInstance = null; store.saveConfig(); }
}

// ----- archivos de la instancia (mods, resourcepacks, shaderpacks) -----
const KINDS = ['mods', 'resourcepacks', 'shaderpacks'];
const kindDir = (id, kind) => {
  if (!KINDS.includes(kind)) throw new Error('Tipo inválido');
  return path.join(dirOf(id), kind);
};
function fileIn(id, kind, file) {
  if (file !== path.basename(file)) throw new Error('Nombre de archivo inválido');
  return path.join(kindDir(id, kind), file);
}

function files(id, kind = 'mods') {
  const dir = kindDir(id, kind);
  fs.mkdirSync(dir, { recursive: true });
  const meta = readInstalled(id);
  const byFile = new Map(Object.entries(meta).map(([k, v]) => [v.file, { key: k, ...v }]));
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => !f.name.endsWith('.part'))
    .map(f => {
      const enabled = !f.name.endsWith('.disabled');
      const real = enabled ? f.name : f.name.slice(0, -'.disabled'.length);
      const st = fs.statSync(path.join(dir, f.name));
      const m = byFile.get(real);
      return { file: f.name, name: m?.title || real.replace(/\.(jar|zip)$/i, ''), enabled, size: st.size, isDir: f.isDirectory(), source: m?.source || null, projectKey: m?.key || null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toggle(id, kind, file) {
  const from = fileIn(id, kind, file);
  const to = file.endsWith('.disabled') ? from.slice(0, -'.disabled'.length) : `${from}.disabled`;
  fs.renameSync(from, to);
}
function removeFile(id, kind, file) {
  fs.rmSync(fileIn(id, kind, file), { recursive: true, force: true });
}

// ----- registro de lo instalado desde el navegador de mods -----
const installedFile = id => path.join(dirOf(id), '.sugar-installed.json');
function readInstalled(id) {
  const all = store.readJSON(installedFile(id), {});
  // descarta lo que el usuario borró a mano
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    const d = kindDir(id, v.kind || 'mods');
    if (fs.existsSync(path.join(d, v.file)) || fs.existsSync(path.join(d, `${v.file}.disabled`))) out[k] = v;
  }
  return out;
}
function markInstalled(id, key, entry) {
  const all = readInstalled(id);
  all[key] = entry;
  store.writeJSON(installedFile(id), all);
}

module.exports = { ICONS, LOADERS, dirOf, get, list, create, update, duplicate, remove, files, toggle, removeFile, kindDir, readInstalled, markInstalled };
