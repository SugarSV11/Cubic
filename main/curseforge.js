// CurseForge — API oficial v1 (necesita API key: console.curseforge.com)
const { getJSON, cached, query: q } = require('./http');
const store = require('./store');
const BASE = 'https://api.curseforge.com/v1';
const GAME = 432; // Minecraft
const CLASS = { mod: 6, resourcepack: 12, shader: 6552 };
const LOADER = { fabric: 4, quilt: 5 };
const SORT = { relevance: 2, downloads: 6, newest: 11, updated: 3 };

// Limpia lo que suele colarse al copiar/pegar: espacios, saltos de línea, comillas, "x-api-key:".
// Las keys de CurseForge empiezan por "$2a$10$": el "$" se trata como un carácter normal (no hay plantillas ni replace con ella).
function normalizeKey(raw) {
  let k = String(raw ?? '').replace(/[\s\u200b-\u200d\ufeff]+/g, '');
  k = k.replace(/^x-api-key:/i, '').replace(/^["'`]+|["'`]+$/g, '');
  return k;
}
const looksLikeKey = k => /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(k);

const REJECTED = 'CurseForge rechazó la API key';
function explain(e) {
  const code = e.statusCode;
  if (code === 401 || code === 403) return new Error(`${REJECTED} (HTTP ${code}). Pulsa «Probar key» para ver qué le pasa.`);
  if (code === 429) return new Error('CurseForge recibió demasiadas peticiones (HTTP 429). Espera un minuto e inténtalo de nuevo.');
  if (code >= 500) return new Error(`CurseForge tiene problemas ahora mismo (HTTP ${code}). Inténtalo más tarde.`);
  if (code) return new Error(`CurseForge respondió HTTP ${code}${e.body ? `: ${e.body.slice(0, 160)}` : ''}`);
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET'].includes(e.code)) return new Error('No hay conexión con CurseForge. Revisa tu internet.');
  return e;
}

// La key sale del proceso principal (nunca del renderer) y va en la cabecera x-api-key
function api(p, ttl = 60000) {
  const key = normalizeKey(store.config.curseforgeKey);
  if (!key) throw new Error('Falta la API key de CurseForge.');
  return cached(`cf:${key.slice(-6)}:${p}`, ttl, () => getJSON(`${BASE}${p}`, { 'x-api-key': key, Accept: 'application/json' })).catch(e => { throw explain(e); });
}

// Comprueba una key (la escrita o la guardada) contra /v1/games/432. Nunca lanza: devuelve un veredicto.
async function testKey(candidate) {
  const key = normalizeKey(candidate !== undefined && candidate !== '' ? candidate : store.config.curseforgeKey);
  if (!key) return { ok: false, message: 'Escribe o pega una API key primero.' };
  const shape = looksLikeKey(key) ? '' : ` Ojo: tiene ${key.length} caracteres y las keys de CurseForge tienen 60 y empiezan por $2a$10$. Puede que se copiara incompleta.`;
  try {
    const r = await getJSON(`${BASE}/games/${GAME}`, { 'x-api-key': key, Accept: 'application/json' });
    return { ok: true, message: `La key es válida${r?.data?.name ? ` (${r.data.name})` : ''}.` };
  } catch (e) {
    const code = e.statusCode;
    if (code === 401 || code === 403) return { ok: false, status: code, message: `CurseForge rechazó la key (HTTP ${code}).${shape || ' Cópiala de nuevo desde console.curseforge.com → API keys, completa y sin espacios.'}` };
    return { ok: false, status: code, message: `${explain(e).message}${shape}` };
  }
}

async function categories(kind) {
  const r = await api(`/categories?${q({ gameId: GAME, classId: CLASS[kind] })}`, 3600e3);
  return r.data.filter(c => !c.isClass && c.classId === CLASS[kind]).map(c => ({ id: String(c.id), name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function search({ kind, query, version, loader, category, sort = 'relevance', offset = 0, limit = 20 }) {
  const params = { gameId: GAME, classId: CLASS[kind], searchFilter: query, gameVersion: version, categoryId: category, sortField: SORT[sort] || 2, sortOrder: 'desc', index: offset, pageSize: limit };
  if (kind === 'mod' && LOADER[loader]) params.modLoaderType = LOADER[loader];
  const r = await api(`/mods/search?${q(params)}`, 30000);
  return {
    total: Math.min(r.pagination.totalCount, 10000 - limit),
    hits: r.data.map(m => ({ source: 'curseforge', id: String(m.id), title: m.name, author: m.authors?.[0]?.name || '', description: m.summary, icon: m.logo?.thumbnailUrl || m.logo?.url, downloads: m.downloadCount, kind }))
  };
}

async function detail(id, kind) {
  const [{ data: m }, { data: html }] = await Promise.all([api(`/mods/${id}`), api(`/mods/${id}/description`).catch(() => ({ data: '' }))]);
  return {
    source: 'curseforge', id: String(m.id), kind, title: m.name, author: m.authors?.[0]?.name || '', description: m.summary,
    body: html, bodyFormat: 'html', icon: m.logo?.thumbnailUrl || m.logo?.url, downloads: m.downloadCount,
    gallery: (m.screenshots || []).map(s => ({ url: s.url, title: s.title || '' })), url: m.links?.websiteUrl || null
  };
}

const RANK = { 1: 0, 2: 1, 3: 2 }; // release, beta, alpha

async function resolve({ id, kind, version, loader }) {
  const tries = kind === 'mod' && loader === 'quilt' ? [5, 4] : kind === 'mod' && LOADER[loader] ? [LOADER[loader]] : [undefined];
  let files = [];
  for (const lt of tries) {
    const r = await api(`/mods/${id}/files?${q({ gameVersion: version, modLoaderType: lt, pageSize: 50 })}`, 30000);
    files = r.data.filter(f => f.isAvailable !== false);
    if (files.length) break;
  }
  if (!files.length) return null;
  const best = files.slice().sort((a, b) => (RANK[a.releaseType] ?? 3) - (RANK[b.releaseType] ?? 3) || new Date(b.fileDate) - new Date(a.fileDate))[0];
  const { data: m } = await api(`/mods/${id}`).catch(() => ({ data: null }));
  const title = m?.name || String(id), website = m?.links?.websiteUrl || null;
  // downloadUrl vacío = el autor no permite descargas desde apps externas
  if (!best.downloadUrl) return { blocked: true, title, website };
  const sha1 = best.hashes?.find(h => h.algo === 1)?.value;
  return {
    title, website, versionId: String(best.id), versionName: best.displayName,
    file: { url: best.downloadUrl, filename: best.fileName, sha1, size: best.fileLength },
    deps: (best.dependencies || []).filter(d => d.relationType === 3).map(d => String(d.modId))
  };
}

module.exports = { categories, search, detail, resolve, testKey, normalizeKey, REJECTED };
