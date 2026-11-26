// Intro animada (mod «Animated Mojang Logo» de BouncingElf10): reglas puras, sin Electron.
// Cubic solo copia o renombra jars; nunca los modifica.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const MOD_ID = 'animated-mojang-logo';
const OFF = '.disabled';

const sha512File = file => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha512');
  fs.createReadStream(file).on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

// nombre con el que se guarda un jar fuera de las instancias (varias builds comparten nombre de archivo)
const storeName = sha512 => `${sha512.slice(0, 32)}.jar`;

// archivos que necesita una versión de Minecraft, o null si no hay build
function filesFor(lock, mc) {
  const ids = lock?.games?.[mc];
  return ids ? ids.map(id => ({ ...lock.files[id], sha512: id })) : null;
}

function modIdOf(jar) {
  try {
    const entry = new AdmZip(jar).getEntry('fabric.mod.json');
    // algunos mods dejan saltos de línea sueltos dentro de las cadenas del JSON
    return entry ? JSON.parse(entry.getData().toString('utf8').replace(/[\r\n\t]+/g, ' ')).id : null;
  } catch { return null; }
}

// ¿se puede poner la intro en esta instancia?
function applicability(inst, lock) {
  if (inst.loader === 'horizon') return { ok: false, reason: 'horizon' };
  if (!['vanilla', 'fabric'].includes(inst.loader)) return { ok: false, reason: 'loader' };
  const files = filesFor(lock, inst.version);
  return files ? { ok: true, files } : { ok: false, reason: 'no-build' };
}

const wanted = (inst, globalOn) => (inst.logo ?? globalOn) === true && !inst.logoState?.removed;

// Lo que ve la interfaz, sin tocar el disco
function describe(inst, lock, globalOn) {
  const app = applicability(inst, lock);
  const on = wanted(inst, globalOn);
  return {
    available: app.ok, reason: app.ok ? (inst.logoState?.note || null) : app.reason,
    on: app.ok && on, override: inst.logo ?? null, removed: !!inst.logoState?.removed,
    active: !!inst.logoState?.on, fabricForVanilla: app.ok && on && inst.loader === 'vanilla'
  };
}

const enabledPath = (mods, name) => path.join(mods, name);
const disabledPath = (mods, name) => path.join(mods, name + OFF);
const present = (mods, name) => fs.existsSync(enabledPath(mods, name)) || fs.existsSync(disabledPath(mods, name));
function disable(mods, name) {
  if (!fs.existsSync(enabledPath(mods, name))) return;
  fs.rmSync(disabledPath(mods, name), { force: true });
  fs.renameSync(enabledPath(mods, name), disabledPath(mods, name));
}
function drop(mods, name) {
  fs.rmSync(enabledPath(mods, name), { force: true });
  fs.rmSync(disabledPath(mods, name), { force: true });
}

// Pone la instancia de acuerdo con los ajustes.
//   dir        carpeta de la instancia
//   inst       { loader, version, logo, logoState }
//   userFiles  nombres que el usuario instaló desde Cubic (nunca se tocan)
//   locate     async (archivo) → ruta local del jar verificado, o null si ahora no está disponible
// Devuelve { logo, logoState, active, reason }. «active» = hay que jugar con el mod cargado.
async function sync({ dir, inst, lock, globalOn, userFiles = new Set(), locate }) {
  const mods = path.join(dir, 'mods');
  fs.mkdirSync(mods, { recursive: true });
  let logo = inst.logo ?? null;
  let state = inst.logoState ? { ...inst.logoState } : { files: [] };
  // lo que el usuario instaló encima deja de ser de Cubic
  let managed = (state.files || []).filter(f => !userFiles.has(f.name));
  const done = (extra = {}) => {
    const { reason = null, active = false } = extra;
    state = { mc: state.mc, files: managed, on: active, removed: !!state.removed, note: reason };
    return { logo, logoState: state, active, reason };
  };

  // 1) respetar lo que el usuario hizo a mano desde la pestaña Mods
  if (state.mc === inst.version && managed.length) {
    if (managed.some(f => !present(mods, f.name))) {
      state.removed = true; // borró el mod o una dependencia: no se vuelve a meter
      managed = managed.filter(f => present(mods, f.name));
    } else {
      const enabled = f => fs.existsSync(enabledPath(mods, f.name));
      const main = managed.find(f => f.modId === MOD_ID);
      if (state.on && !managed.every(enabled)) logo = false; // deshabilitó el mod o una dependencia
      else if (!state.on && !state.note && main && enabled(main) && !wanted({ ...inst, logo }, globalOn)) logo = true;
    }
  }

  const app = applicability(inst, lock);
  // 2) cambió la versión o el loader: se quitan las copias que puso Cubic (son suyas)
  if (!app.ok || (state.mc && state.mc !== inst.version)) {
    for (const f of managed) drop(mods, f.name);
    managed = [];
    state.mc = undefined;
  }
  if (!app.ok) return done({ reason: app.reason === 'horizon' ? null : app.reason });
  state.mc = inst.version;

  const mine = new Set(managed.map(f => f.name));
  const others = fs.readdirSync(mods).filter(n => n.endsWith('.jar') && !mine.has(n));
  const userIds = new Set(others.map(n => modIdOf(path.join(mods, n))).filter(Boolean));
  // las dependencias siguen activas si hay otros mods que quizá las usen, salvo que ya las traigan ellos
  const disableAll = () => {
    for (const f of managed) if (f.modId === MOD_ID || !others.length || userIds.has(f.modId)) disable(mods, f.name);
  };

  // 3) desactivada: se deshabilita sin borrar nada
  if (!wanted({ ...inst, logo, logoState: state }, globalOn)) { disableAll(); return done(); }

  // una instancia vanilla con jars ajenos no se arranca con Fabric: los cargaría sin que lo pidieran
  if (inst.loader === 'vanilla' && others.length) { disableAll(); return done({ reason: 'other-mods' }); }

  if (userIds.has(MOD_ID)) {
    for (const f of managed) if (userIds.has(f.modId)) disable(mods, f.name);
    return done({ reason: 'own-copy' });
  }

  // 4) primero se consiguen todos los jars: nunca queda una instalación a medias
  const plan = [];
  for (const file of app.files) {
    if (userIds.has(file.modId)) continue; // ya lo tiene el usuario: no duplicar
    const have = present(mods, file.filename) && managed.some(f => f.name === file.filename && f.sha512 === file.sha512);
    const source = have ? null : await locate(file);
    if (!have && !source) return done({ reason: 'pending' });
    plan.push({ file, source });
  }
  const keep = new Set(plan.map(p => p.file.filename));
  // jars de una versión anterior del mod, o que el usuario ya aporta por su cuenta
  for (const f of managed) if (!keep.has(f.name)) drop(mods, f.name);

  const next = [];
  for (const { file, source } of plan) {
    const on = enabledPath(mods, file.filename);
    if (source) {
      fs.rmSync(disabledPath(mods, file.filename), { force: true });
      fs.copyFileSync(source, `${on}.part`, fs.constants.COPYFILE_FICLONE);
      fs.renameSync(`${on}.part`, on);
    } else if (!fs.existsSync(on)) {
      fs.renameSync(disabledPath(mods, file.filename), on);
    }
    next.push({ name: file.filename, sha512: file.sha512, modId: file.modId });
  }
  managed = next;
  return done({ active: true });
}

module.exports = { MOD_ID, sha512File, storeName, filesFor, modIdOf, applicability, wanted, describe, sync };
