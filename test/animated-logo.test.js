const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const C = require('../main/animated-logo-core');
const realLock = require('../animated-logo.lock.json');
const { fetchJars, storeName } = require('../scripts/fetch-animated-logo');
const { satisfies, unmet } = require('../scripts/fabric-versions');

const sha512 = b => crypto.createHash('sha512').update(b).digest('hex');

// jars de mentira con su fabric.mod.json
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-logo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = { games: {}, files: {} }, sources = new Map();
  const jar = (modId, filename) => {
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: modId, v: filename })));
    const file = path.join(root, `src-${filename}`);
    zip.writeZip(file);
    return file;
  };
  const add = (mc, modId, filename) => {
    const src = jar(modId, filename), id = sha512(fs.readFileSync(src));
    lock.files[id] = { modId, filename };
    sources.set(id, src);
    (lock.games[mc] ||= []).push(id);
  };
  for (const mc of ['26.3', '26.2']) { add(mc, C.MOD_ID, `logo-${mc}.jar`); add(mc, 'fabric-api', `fabric-api-${mc}.jar`); }
  const dir = path.join(root, 'inst');
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  const inst = { loader: 'fabric', version: '26.3' };
  let globalOn = true, online = true;
  const run = async (userFiles) => {
    const r = await C.sync({ dir, inst, lock, globalOn, userFiles, locate: async f => (online ? sources.get(f.sha512) : null) });
    inst.logo = r.logo; inst.logoState = r.logoState;
    return r;
  };
  const ls = () => fs.readdirSync(path.join(dir, 'mods')).sort();
  const p = n => path.join(dir, 'mods', n);
  return { root, dir, lock, inst, run, ls, p, jar, setGlobal: v => (globalOn = v), setOnline: v => (online = v) };
}

test('elige la build según la versión de Minecraft', () => {
  const names = mc => C.filesFor(realLock, mc).map(f => f.modId);
  assert.ok(names('26.3').includes(C.MOD_ID) && names('26.3').includes('fabric-api'));
  const aml = mc => C.filesFor(realLock, mc).find(f => f.modId === C.MOD_ID).versionId;
  assert.notStrictEqual(aml('26.3'), aml('1.21.1'));
  assert.strictEqual(aml('1.21'), aml('1.21.1'));
  assert.strictEqual(C.filesFor(realLock, '1.19.4'), null); // esa build pide Java 21 y el juego usa 17
  assert.strictEqual(C.filesFor(realLock, '1.8.9'), null);
});

test('el lock tiene hashes y código fuente, y los avisos listan todo', () => {
  const notices = fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const [id, f] of Object.entries(realLock.files)) {
    assert.match(id, /^[0-9a-f]{128}$/);
    assert.ok(f.source.ref, `${f.slug} ${f.version} sin código fuente`);
    assert.ok(notices.includes(f.versionId), `${f.slug} ${f.version} no está en THIRD_PARTY_NOTICES`);
  }
});

test('cada versión de Minecraft del lock cumple los requisitos que declaran sus jars', () => {
  assert.ok(satisfies('0.102.0+1.21', '>=0.100.0'));
  assert.ok(!satisfies('0.102.0+1.21', '>=0.104.0+1.21.1'));
  assert.ok(satisfies('26.3', '>=26.3-') && satisfies('1.21.1', '~1.21 <1.21.2') && !satisfies('1.21.2', '1.21.x <1.21.2'));
  const java = mc => (mc.startsWith('26') ? 25 : /^1\.21|^1\.20\.[56]$/.test(mc) ? 21 : 17);
  for (const mc of Object.keys(realLock.games)) {
    assert.deepStrictEqual(unmet(C.filesFor(realLock, mc), { minecraft: mc, java: java(mc) }), [], mc);
  }
});

test('copia el mod y sus dependencias, también en vanilla', async t => {
  const f = fixture(t);
  f.inst.loader = 'vanilla';
  assert.strictEqual((await f.run()).active, true);
  assert.deepStrictEqual(f.ls(), ['fabric-api-26.3.jar', 'logo-26.3.jar']);
  assert.strictEqual(C.describe(f.inst, f.lock, true).fabricForVanilla, true);
});

test('versión sin build, Quilt y Horizon: no se instala nada', async t => {
  const f = fixture(t);
  for (const [loader, version, reason] of [['fabric', '1.8.9', 'no-build'], ['quilt', '26.3', 'loader'], ['horizon', '26.3', null]]) {
    Object.assign(f.inst, { loader, version, logoState: undefined });
    const r = await f.run();
    assert.strictEqual(r.active, false);
    assert.strictEqual(r.reason, reason);
    assert.deepStrictEqual(f.ls(), []);
  }
});

test('convertir a Horizon retira las copias de Cubic', async t => {
  const f = fixture(t);
  await f.run();
  f.inst.loader = 'horizon';
  await f.run();
  assert.deepStrictEqual(f.ls(), []);
});

test('desactivar deshabilita sin borrar y reactivar habilita', async t => {
  const f = fixture(t);
  await f.run();
  f.setGlobal(false);
  assert.strictEqual((await f.run()).active, false);
  assert.deepStrictEqual(f.ls(), ['fabric-api-26.3.jar.disabled', 'logo-26.3.jar.disabled']);
  f.setGlobal(true);
  assert.strictEqual((await f.run()).active, true);
  assert.deepStrictEqual(f.ls(), ['fabric-api-26.3.jar', 'logo-26.3.jar']);
});

test('el ajuste de la instancia manda sobre el global', async t => {
  const f = fixture(t);
  f.setGlobal(false);
  f.inst.logo = true;
  assert.strictEqual((await f.run()).active, true);
  f.setGlobal(true);
  f.inst.logo = false;
  assert.strictEqual((await f.run()).active, false);
});

test('deshabilitarlo desde la pestaña Mods se respeta', async t => {
  const f = fixture(t);
  await f.run();
  fs.renameSync(f.p('logo-26.3.jar'), f.p('logo-26.3.jar.disabled'));
  assert.strictEqual((await f.run()).logo, false);
  assert.ok(f.ls().includes('logo-26.3.jar.disabled'));
});

test('si el usuario borra el mod no se vuelve a meter, ni al cambiar de versión', async t => {
  const f = fixture(t);
  await f.run();
  fs.rmSync(f.p('logo-26.3.jar'));
  assert.strictEqual((await f.run()).active, false);
  f.setGlobal(false); await f.run(); f.setGlobal(true);
  f.inst.version = '26.2';
  await f.run();
  assert.ok(!f.ls().some(n => n.startsWith('logo-')), f.ls().join());
  assert.strictEqual(f.inst.logoState.removed, true);
});

test('reactivar a mano después de borrarlo lo recupera', async t => {
  const f = fixture(t);
  await f.run();
  fs.rmSync(f.p('logo-26.3.jar'));
  await f.run();
  // lo mismo que hace el interruptor de la instancia
  f.inst.logo = true;
  f.inst.logoState = { ...f.inst.logoState, removed: false, mc: undefined, on: false, note: 'changed' };
  assert.strictEqual((await f.run()).active, true);
  assert.ok(f.ls().includes('logo-26.3.jar'));
});

test('migración: instancia antigua con mods propios, sin duplicar dependencias', async t => {
  const f = fixture(t);
  fs.copyFileSync(f.jar('fabric-api', 'mi-fabric-api.jar'), f.p('mi-fabric-api.jar'));
  assert.strictEqual((await f.run()).active, true);
  assert.deepStrictEqual(f.ls(), ['logo-26.3.jar', 'mi-fabric-api.jar']);
  f.setGlobal(false); await f.run();
  assert.deepStrictEqual(f.ls(), ['logo-26.3.jar.disabled', 'mi-fabric-api.jar']); // lo del usuario, intacto
});

test('vanilla con mods ajenos o copia propia del mod: no se toca', async t => {
  const f = fixture(t);
  f.inst.loader = 'vanilla';
  fs.copyFileSync(f.jar('otro', 'otro.jar'), f.p('otro.jar'));
  assert.strictEqual((await f.run()).reason, 'other-mods');
  assert.deepStrictEqual(f.ls(), ['otro.jar']);
  fs.rmSync(f.p('otro.jar'));
  f.inst.loader = 'fabric';
  fs.copyFileSync(f.jar(C.MOD_ID, 'mio.jar'), f.p('mio.jar'));
  assert.strictEqual((await f.run()).reason, 'own-copy');
  assert.deepStrictEqual(f.ls(), ['mio.jar']);
});

test('sin el jar disponible no deja nada a medias', async t => {
  const f = fixture(t);
  f.setOnline(false);
  assert.strictEqual((await f.run()).reason, 'pending');
  assert.deepStrictEqual(f.ls(), []);
  f.setOnline(true);
  assert.strictEqual((await f.run()).active, true);
});

test('el script de build falla claro con un hash que no coincide o sin red', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-fetch-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const good = Buffer.from('jar bueno'), id = sha512(good);
  const lock = { bundledGames: ['26.3'], games: { '26.3': [id] }, files: { [id]: { filename: 'a.jar', url: 'https://x.invalid/a.jar', slug: 'a', version: '1' } } };
  const real = global.fetch;
  t.after(() => { global.fetch = real; });
  global.fetch = async () => new Response('jar alterado');
  await assert.rejects(fetchJars({ lock, out, check: async () => {} }), /Hash incorrecto/);
  assert.deepStrictEqual(fs.readdirSync(out), []);
  global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(fetchJars({ lock, out }), /Sin conexión/);
  global.fetch = async () => new Response(good);
  await fetchJars({ lock, out, check: async () => {} });
  assert.deepStrictEqual(fs.readdirSync(out), [storeName(id)]);
  assert.strictEqual(storeName(id), C.storeName(id));
});
