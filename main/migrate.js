// Migración desde la carpeta de datos antigua ("Sugar Launcher") a la nueva ("Cubic").
// Se ejecuta una sola vez, al arrancar, ANTES de que Electron cree nada en la carpeta nueva.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const OLD_NAME = 'Sugar Launcher';

function move(from, to) {
  try { fs.renameSync(from, to); }
  catch (e) { if (e.code === 'EXDEV') { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); } else throw e; }
}

function run() {
  const dest = app.getPath('userData');
  const old = path.join(path.dirname(dest), OLD_NAME);
  if (path.resolve(old) === path.resolve(dest) || !fs.existsSync(old)) return null;
  // si la carpeta nueva ya tiene datos, no se pisa nada
  if (['config.json', 'accounts.json', 'instances'].some(f => fs.existsSync(path.join(dest, f)))) return null;

  const done = [];
  try {
    fs.mkdirSync(dest, { recursive: true });
    // config y cuentas son pequeños: se COPIAN (la carpeta vieja queda como respaldo)
    for (const f of ['config.json', 'accounts.json']) {
      const src = path.join(old, f);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dest, f)); fs.chmodSync(path.join(dest, f), 0o600); done.push(f); }
    }
    // instancias, librerías y Java pueden pesar GB: se MUEVEN (rápido, sin duplicar espacio)
    for (const d of ['instances', 'shared', 'java']) {
      const src = path.join(old, d);
      if (fs.existsSync(src)) { move(src, path.join(dest, d)); done.push(d); }
    }
    fs.writeFileSync(path.join(dest, '.migrated-from-sugar-launcher'), new Date().toISOString());
  } catch (e) {
    console.error('[migrate] No se pudo migrar por completo:', e);
  }
  return { from: old, to: dest, done };
}

module.exports = { run };
