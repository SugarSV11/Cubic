#!/usr/bin/env node
// Mantenimiento: regenera animated-logo.lock.json y THIRD_PARTY_NOTICES.md con las builds
// actuales de Modrinth. No lo ejecuta la compilación; revisa el resultado antes de commitear.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { unmet } = require('./fabric-versions');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'dWUOweyL'; // animated-mojang-logo, de BouncingElf10
const AUTHOR = 'BouncingElf10';
const BUNDLED = ['26.3', '26.2', '26.1.2', '26.1.1', '26.1', '1.21.11', '1.21.1', '1.21'];
const TMP = path.join(os.tmpdir(), 'cubic-logo-update');
const UA = { 'User-Agent': 'Cubic-build/1.0' };

const get = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r; };
const json = async url => (await get(url)).json();
const api = p => json(`https://api.modrinth.com/v2${p}`);
const memo = new Map();
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };

const versionsOf = id => once(`v:${id}`, () => api(`/project/${id}/version`));
const projectOf = id => once(`p:${id}`, () => api(`/project/${id}`));
const primary = v => v.files.find(f => f.primary) || v.files[0];

const jarMeta = f => once(`j:${f.hashes.sha512}`, async () => {
  const buf = Buffer.from(await (await get(f.url)).arrayBuffer());
  if (crypto.createHash('sha512').update(buf).digest('hex') !== f.hashes.sha512) throw new Error(`Hash incorrecto en ${f.filename}`);
  const zip = new AdmZip(buf);
  return JSON.parse(zip.readAsText('fabric.mod.json').replace(/[\r\n\t]+/g, ' '));
});

// proyectos de Modrinth que aportan cada mod requerido (algunas fichas no declaran todo lo que el jar exige)
const PROVIDERS = {
  'fabric-api': 'P7dR8mSH', fabric: 'P7dR8mSH', yet_another_config_lib_v3: '1eAoo2KR', 'yet-another-config-lib': '1eAoo2KR',
  modmenu: 'mOgUt4GM', timelesslib: 'vKDSSPpv', 'placeholder-api': 'eXts2L7r'
};
const FABRIC_API = 'P7dR8mSH';
const asFile = (version, meta) => ({ modId: meta.id, modVersion: meta.version, depends: meta.depends || {} });

async function candidates(project, mc) {
  const ok = (await versionsOf(project)).filter(v => v.loaders.includes('fabric') && v.game_versions.includes(mc))
    .sort((a, b) => b.date_published.localeCompare(a.date_published));
  return [...ok.filter(v => v.version_type === 'release'), ...ok.filter(v => v.version_type !== 'release')];
}

// El mod más nuevo para esa versión y, para cada dependencia, la versión más nueva cuyos requisitos
// encajen con lo ya elegido. Si no hay combinación válida, esa versión se queda sin intro.
async function resolve(mc, java) {
  const skip = why => { console.log(`  ${mc}: sin intro (${why})`); return null; };
  const [root] = await candidates(PROJECT, mc);
  if (!root) return null;
  const out = new Map();
  const queue = [];
  const add = async (project, version) => {
    const meta = await jarMeta(primary(version));
    out.set(project, { version, meta });
    const ids = Object.keys(meta.depends || {}).map(d => PROVIDERS[d]).filter(Boolean);
    const declared = version.dependencies.filter(d => d.dependency_type === 'required').map(d => d.project_id);
    queue.push(...ids, ...declared);
  };
  await add(PROJECT, root);
  const needed = Math.max(0, ...[out.get(PROJECT).meta.depends?.java].flat().filter(Boolean).map(s => Number(/\d+/.exec(s)?.[0] || 0)));
  if (needed > java) return skip(`el mod pide Java ${needed} y el juego usa ${java}`);
  queue.unshift(FABRIC_API); // primero, porque las demás dependen de su versión
  while (queue.length) {
    const project = queue.shift();
    if (out.has(project)) continue;
    let found = null;
    for (const v of (await candidates(project, mc)).slice(0, 40)) {
      const meta = await jarMeta(primary(v));
      const set = [...out.values()].map(x => asFile(x.version, x.meta)).concat(asFile(v, meta));
      // solo se juzga lo que ya está elegido; lo que falte se resuelve después
      if (!unmet(set, { minecraft: mc, java }).some(m => !m.includes(': falta '))) { found = v; break; }
    }
    if (!found) return skip(`no hay versión compatible de ${(await projectOf(project)).slug}`);
    await add(project, found);
  }
  const problems = unmet([...out.values()].map(x => asFile(x.version, x.meta)), { minecraft: mc, java });
  return problems.length ? skip(problems[0]) : out;
}

// etiqueta o commit del código fuente que corresponde a una versión publicada
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function clone(repo) {
  const dir = path.join(TMP, repo.split('/').slice(-2).join('_'));
  if (!fs.existsSync(dir)) git(['clone', '-q', '--bare', '--filter=blob:none', repo, dir]);
  return dir;
}
function sourceRef(repo, version, slug) {
  const dir = clone(repo);
  const tags = git(['tag', '-l'], dir).split('\n');
  const n = version.version_number;
  const tag = [n, `v${n}`, n.replace(/-fabric$/, '')].find(t => tags.includes(t));
  // el mod y TimelessLib no etiquetan: último commit de la rama correspondiente anterior a la publicación
  if (tag && slug !== 'animated-mojang-logo') return { repo, ref: tag, kind: 'tag' };
  const mc = [...version.game_versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  const branches = git(['branch', '--format=%(refname:short)'], dir).split('\n');
  const wanted = slug === 'animated-mojang-logo'
    ? [`${mc}-fabric`, `${mc.replace(/\.\d+$/, '')}-fabric`]
    : branches.filter(b => b.startsWith('fabric-') && n.includes(b.slice('fabric-'.length).replace('+', '')));
  const branch = wanted.find(b => branches.includes(b));
  if (!branch) return byDeclaredVersion(repo, dir, version);
  const ref = git(['log', '-1', `--before=${version.date_published}`, '--format=%H', branch], dir);
  return { repo, ref: ref || null, kind: `commit de la rama ${branch} (por fecha)` };
}

// YACL no etiqueta cada versión: último commit anterior a la publicación cuyo build declara ese número
function byDeclaredVersion(repo, dir, version) {
  const base = version.version_number.split('+')[0].replace(/[.]/g, '\\.');
  const declares = new RegExp(`(modVersion|mod_version|[\\s.]version)\\s*=\\s*"?${base}"?\\s*$|version\\s*=\\s*"${base}"`, 'm');
  const commits = git(['log', '--all', `--before=${version.date_published}`, '--date-order', '-150', '--format=%H'], dir).split('\n');
  for (const ref of commits) {
    for (const file of ['gradle.properties', 'build.gradle.kts']) {
      let text = '';
      try { text = git(['show', `${ref}:${file}`], dir); } catch { continue; }
      if (declares.test(text)) return { repo, ref, kind: 'commit que declara esa versión' };
    }
  }
  return { repo, ref: null, kind: 'no encontrado' };
}

function notices(lock) {
  const rows = Object.entries(lock.files).map(([sha, f]) => {
    const games = Object.keys(lock.games).filter(mc => lock.games[mc].includes(sha));
    return { ...f, sha, games, bundled: games.some(mc => lock.bundledGames.includes(mc)) };
  }).sort((a, b) => a.slug.localeCompare(b.slug) || a.version.localeCompare(b.version, undefined, { numeric: true }));
  const src = f => (f.source.ref ? `[${f.source.ref.slice(0, 40)}](${f.source.repo}/tree/${encodeURIComponent(f.source.ref)})` : `[repositorio](${f.source.repo}) (sin etiqueta identificada)`);
  const table = list => ['| Componente | Versión | Licencia | Minecraft | Modrinth | Código fuente |', '|---|---|---|---|---|---|',
    ...list.map(f => `| ${f.title} | ${f.version} | ${f.license} | ${f.games.join(', ')} | [versión](https://modrinth.com/mod/${f.slug}/version/${f.versionId}) | ${src(f)} |`)].join('\n');
  const authors = [...new Map(rows.map(f => [f.slug, f])).values()]
    .map(f => `- **${f.title}** — ${f.authors.join(', ')} — https://modrinth.com/mod/${f.slug} — ${f.source.repo} — ${f.license}`).join('\n');
  return `# Software de terceros incluido o descargado por Cubic

Archivo generado por \`scripts/update-animated-logo.js\` a partir de \`animated-logo.lock.json\`.

## Animated Mojang Logo (intro animada)

- Autor: **${AUTHOR}** (colaboradores según su fabric.mod.json: ${lock.mod.contributors.join(', ') || 'ninguno'})
- Proyecto: https://modrinth.com/mod/animated-mojang-logo
- Código fuente: https://github.com/BouncingElf10/Animated-Mojang-Logo
- Versión incluida: ${lock.mod.version}
- Licencia: **GPL-3.0-or-later** según Modrinth; el repositorio y el jar traen el texto de la GPL v3.
  Su \`fabric.mod.json\` todavía dice \`ZLIB\`; Cubic cumple la más exigente (GPL). Texto: [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt)
- Cubic distribuye los jars **sin modificar** (se comprueba su sha512 contra Modrinth al compilar).

### Material de Mojang y Microsoft

Según su autor, la animación y el jingle son los de **Minecraft Dungeons / MC Live** (intro de Mojang Studios).
Ese material pertenece a Mojang Studios / Microsoft; la licencia del mod no concede derechos sobre él.
Cubic y el mod no están afiliados, patrocinados ni aprobados por Mojang ni por Microsoft.

## Autores y licencias

${authors}

Textos completos en [LICENSES/](LICENSES/): GPL-3.0, LGPL-3.0, Apache-2.0, MIT (Mod Menu) y la licencia de TimelessLib
(su jar declara CC0-1.0 y su ficha de Modrinth, Zlib).

## Incluido dentro de Cubic

${table(rows.filter(r => r.bundled))}

## No incluido: se descarga de Modrinth solo si se usa esa versión

${table(rows.filter(r => !r.bundled))}

## Otros materiales incluidos en Cubic

- Tipografía Inter (SIL OFL): \`renderer/fonts/Inter-LICENSE.txt\`
- Iconos Lucide (ISC): \`renderer/fonts/Lucide-LICENSE.txt\`
- Logotipo de Horizon (MIT): \`renderer/img/horizon-LICENSE.txt\`
`;
}

(async () => {
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const candidates = [...new Set((await versionsOf(PROJECT)).filter(v => v.loaders.includes('fabric')).flatMap(v => v.game_versions))];
  const lock = { mod: {}, bundledGames: [], games: {}, files: {} };
  for (const mc of candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const entry = manifest.versions.find(v => v.id === mc);
    if (!entry) continue;
    const javaMax = (await json(entry.url)).javaVersion?.majorVersion || 8;
    const set = await resolve(mc, javaMax);
    if (!set) continue;
    const ids = [];
    for (const [project, { version, meta }] of set) {
      const file = primary(version);
      const sha = file.hashes.sha512;
      ids.push(sha);
      if (lock.files[sha]) continue;
      const p = await projectOf(project);
      const repo = p.source_url.replace(/\/(tree\/.*)?$/, '').replace(/\.git$/, '');
      lock.files[sha] = {
        project, slug: p.slug, title: p.title, modId: meta.id, modVersion: meta.version, depends: meta.depends || {}, versionId: version.id, version: version.version_number,
        filename: file.filename, url: file.url, size: file.size, license: p.license.id,
        authors: [meta.authors].flat().filter(Boolean).map(a => a.name || a), source: sourceRef(repo, version, p.slug)
      };
      if (project === PROJECT) lock.mod = { version: version.version_number, contributors: (meta.contributors || []).map(c => c.name || c) };
    }
    lock.games[mc] = ids;
    console.log(`${mc}: ${ids.length} archivos`);
  }
  lock.bundledGames = BUNDLED.filter(mc => lock.games[mc]);
  fs.writeFileSync(path.join(ROOT, 'animated-logo.lock.json'), `${JSON.stringify(lock, null, 1)}\n`);
  fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), notices(lock));
  const bytes = [...new Set(lock.bundledGames.flatMap(mc => lock.games[mc]))].reduce((n, id) => n + lock.files[id].size, 0);
  console.log(`Incluidos: ${lock.bundledGames.join(', ')} → ${(bytes / 1e6).toFixed(1)} MB`);
  console.log('Sin código fuente identificado:', Object.values(lock.files).filter(f => !f.source.ref).map(f => `${f.slug} ${f.version}`).join(', ') || 'ninguno');
})().catch(e => { console.error(e.message); process.exit(1); });
