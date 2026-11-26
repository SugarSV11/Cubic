// Modrinth — API oficial v2 (no necesita key)
const { getJSON, cached } = require('./http');
const BASE = 'https://api.modrinth.com/v2';
const q = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
const api = (p, ttl = 60000) => cached(`mr:${p}`, ttl, () => getJSON(`${BASE}${p}`));

const NAMES = { adventure: 'Aventura', cursed: 'Maldito', decoration: 'Decoración', economy: 'Economía', equipment: 'Equipamiento', food: 'Comida', 'game-mechanics': 'Mecánicas', library: 'Librería', magic: 'Magia', management: 'Gestión', minigame: 'Minijuego', mobs: 'Mobs', optimization: 'Optimización', social: 'Social', storage: 'Almacenamiento', technology: 'Tecnología', transportation: 'Transporte', utility: 'Utilidad', worldgen: 'Generación de mundo',
  combat: 'Combate', cartoon: 'Cartoon', realistic: 'Realista', simplistic: 'Simple', themed: 'Temático', tweaks: 'Ajustes', vanilla: 'Estilo vanilla', fantasy: 'Fantasía', semi_realistic: 'Semi-realista', atmosphere: 'Atmósfera', bloom: 'Bloom', colored_lighting: 'Luz de color', foliage: 'Vegetación', path_tracing: 'Path tracing', pbr: 'PBR', reflections: 'Reflejos', shadows: 'Sombras', cursed_: 'Maldito', modded: 'Modded', audio: 'Audio', blocks: 'Bloques', core_shaders: 'Core shaders', entities: 'Entidades', environment: 'Entorno', equipment_: 'Equipamiento', fonts: 'Fuentes', gui: 'Interfaz', items: 'Ítems', locale: 'Idioma', models: 'Modelos' };
const nice = n => NAMES[n] || n.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

async function categories(kind) {
  const all = await api('/tag/category', 3600e3);
  return all.filter(c => c.project_type === kind && c.header === 'categories').map(c => ({ id: c.name, name: nice(c.name) }));
}

const loadersFor = loader => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);

async function search({ kind, query, version, loader, category, sort = 'relevance', offset = 0, limit = 20 }) {
  const facets = [[`project_type:${kind}`]];
  if (version) facets.push([`versions:${version}`]);
  if (kind === 'mod' && loader && loader !== 'vanilla') facets.push(loadersFor(loader).map(l => `categories:${l}`));
  if (category) facets.push([`categories:${category}`]);
  const index = ['relevance', 'downloads', 'newest', 'updated'].includes(sort) ? sort : 'relevance';
  const r = await api(`/search?${q({ query, facets: JSON.stringify(facets), index, offset, limit })}`, 30000);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({ source: 'modrinth', id: h.project_id, title: h.title, author: h.author, description: h.description, icon: h.icon_url, downloads: h.downloads, kind }))
  };
}

async function detail(id) {
  const [p, members] = await Promise.all([api(`/project/${id}`), api(`/project/${id}/members`).catch(() => [])]);
  const owner = members.find(m => m.role === 'Owner') || members[0];
  return {
    source: 'modrinth', id: p.id, kind: p.project_type, title: p.title, author: owner?.user?.username || '', description: p.description,
    body: p.body || '', bodyFormat: 'markdown', icon: p.icon_url, downloads: p.downloads,
    gallery: (p.gallery || []).map(g => ({ url: g.url, title: g.title || '' })),
    url: `https://modrinth.com/${p.project_type}/${p.slug}`, versions: p.game_versions, loaders: p.loaders
  };
}

const RANK = { release: 0, beta: 1, alpha: 2 };

// Busca el archivo correcto para esa versión de Minecraft y ese loader
async function resolve({ id, kind, version, loader }) {
  const params = { game_versions: JSON.stringify([version]) };
  if (kind === 'mod') params.loaders = JSON.stringify(loadersFor(loader));
  const versions = await api(`/project/${id}/version?${q(params)}`, 30000);
  const usable = versions.filter(v => v.files?.length);
  if (!usable.length) return null;
  const best = usable.slice().sort((a, b) => RANK[a.version_type] - RANK[b.version_type] || new Date(b.date_published) - new Date(a.date_published))[0];
  const f = best.files.find(x => x.primary) || best.files[0];
  const deps = [];
  for (const d of best.dependencies || []) {
    if (d.dependency_type !== 'required') continue;
    let pid = d.project_id;
    if (!pid && d.version_id) pid = (await api(`/version/${d.version_id}`, 3600e3).catch(() => null))?.project_id;
    if (pid) deps.push(pid);
  }
  const proj = await api(`/project/${id}`).catch(() => null);
  return { title: proj?.title || id, versionId: best.id, versionName: best.version_number, file: { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size }, deps, website: proj ? `https://modrinth.com/${proj.project_type}/${proj.slug}` : null };
}

module.exports = { categories, search, detail, resolve };
