// Comprobación de los requisitos de versión que declaran los fabric.mod.json (>=, <=, >, <, ~, ^, x, *)
function key(v) {
  const clean = v.split('+')[0];
  const dash = clean.indexOf('-');
  const core = (dash < 0 ? clean : clean.slice(0, dash)).split('.').map(n => Number(n) || 0);
  while (core.length < 4) core.push(0);
  return { core, pre: dash < 0 ? null : clean.slice(dash + 1).split('.').filter(Boolean) };
}

function compare(a, b) {
  const x = key(a), y = key(b);
  for (let i = 0; i < 4; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0; // la versión final es mayor que sus previas
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const c = x.pre[i].localeCompare(y.pre[i], 'en', { numeric: true });
    if (c) return c;
  }
  return 0;
}

function one(version, term) {
  if (term === '*') return true;
  let [, op = '=', target] = /^(>=|<=|>|<|=|~|\^)?(.*)$/.exec(term);
  if (target.endsWith('.x')) {
    const prefix = target.slice(0, -2).split('.');
    return version.split(/[+-]/)[0].split('.').slice(0, prefix.length).join('.') === prefix.join('.');
  }
  if (target.endsWith('-')) target += '0';
  const c = compare(version, target);
  const a = key(version).core, b = key(target).core;
  if (op === '~') return c >= 0 && a[0] === b[0] && a[1] === b[1];
  if (op === '^') return c >= 0 && a[0] === b[0];
  return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[op];
}

// una lista significa «cualquiera de estas»; separadas por espacios, «todas»
const satisfies = (version, predicate) => [predicate].flat().some(p => p.trim().split(/\s+/).every(t => one(version, t)));

// requisitos sin cumplir de un conjunto de archivos [{ modId, modVersion, depends }]
function unmet(files, { minecraft, java }) {
  const have = { minecraft, java: String(java) };
  for (const f of files) have[f.modId] = f.modVersion;
  // Fabric API se llamaba «fabric» en las versiones antiguas
  if (have['fabric-api']) have.fabric = have['fabric-api'];
  else if (have.fabric) have['fabric-api'] = have.fabric;
  const out = [];
  for (const f of files) {
    for (const [dep, predicate] of Object.entries(f.depends || {})) {
      if (dep === 'fabricloader' || dep.startsWith('fabric-') && dep !== 'fabric-api' && have['fabric-api']) continue; // loader: se usa el último; módulos: van dentro de Fabric API
      if (!have[dep]) out.push(`${f.modId}: falta ${dep}`);
      else if (!satisfies(have[dep], predicate)) out.push(`${f.modId}: pide ${dep} ${predicate}, hay ${have[dep]}`);
    }
  }
  return out;
}

module.exports = { satisfies, unmet };
