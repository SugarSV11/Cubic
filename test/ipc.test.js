// Puente interfaz ↔ sistema, navegador de mods y fuentes (sin red)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers/env');

const env = setup();
const http = require('../main/http');
const modrinth = require('../main/modrinth');
const curseforge = require('../main/curseforge');
const delay = ms => new Promise(r => setTimeout(r, ms));
const RESOLVE = {
  main: { title: 'Principal', versionId: 'v1', file: { url: 'https://x/m.jar', filename: 'm.jar' }, deps: ['lib'] },
  lib: { title: 'Libreria', versionId: 'v2', file: { url: 'https://x/l.jar', filename: 'l.jar' }, deps: [] }
};
modrinth.resolve = async ({ id, version }) => { await delay(version === '1.20.1' ? 20 : 1); return version === '1.0' ? null : RESOLVE[id]; };
http.download = async (_u, dest) => fs.writeFileSync(dest, 'jar');
const instances = require('../main/instances');
require('../main/ipc').register();

test('la interfaz y el sistema declaran los mismos canales', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const used = [...preload.matchAll(/call\('([\w:]+)'/g)].map(m => m[1]);
  for (const ch of used) assert.ok(env.handlers.has(ch), `falta ${ch}`);
});

test('init y ajustes no exponen la API key', async () => {
  const d = await env.invoke('init');
  assert.deepStrictEqual(Object.keys(d).sort(), ['accounts', 'appName', 'dataDir', 'icons', 'instances', 'intro', 'platform', 'settings', 'totalRam', 'version']);
  const s = await env.invoke('settings:set', { ram: 6, curseforgeKey: ' "abc" ', animatedLogo: false, otra: 1 });
  assert.deepStrictEqual(s, { animatedLogo: false, ram: 6, showSnapshots: false, hasCurseforgeKey: true, selectedInstance: null });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(env.data, 'config.json'))).curseforgeKey, 'abc');
});

test('solo se abren enlaces https', () => {
  assert.throws(() => env.invoke('openExternal', 'file:///etc/passwd'), /Enlace no permitido/);
});

test('compatibilidad: una fila por instancia, en orden de lista', async () => {
  instances.create({ name: 'a', version: '1.20.1', loader: 'fabric' });
  instances.create({ name: 'b', version: '1.0', loader: 'fabric' });
  instances.create({ name: 'c', version: '1.21.1', loader: 'vanilla' });
  instances.create({ name: 'd', version: '1.21.1', loader: 'fabric' });
  assert.deepStrictEqual(await env.invoke('mods:compat', 'modrinth', 'main', 'mod'), [
    { id: 'a', ok: true, installed: false, blocked: false },
    { id: 'b', ok: false, installed: false, reason: 'No hay versión para Minecraft 1.0 con fabric.' },
    { id: 'c', ok: false, reason: 'Es una instancia Vanilla: no admite mods (usa Fabric o Quilt).', installed: false },
    { id: 'd', ok: true, installed: false, blocked: false }
  ]);
});

test('instalar trae dependencias, registra y no repite', async () => {
  const r = await env.invoke('mods:install', { source: 'modrinth', id: 'main', kind: 'mod', instanceId: 'd' });
  assert.deepStrictEqual(r, { installed: ['Principal', 'Libreria'], skipped: [], blocked: [], missing: [], instanceName: 'd' });
  assert.deepStrictEqual(Object.keys(instances.readInstalled('d')), ['modrinth:main', 'modrinth:lib']);
  const again = await env.invoke('mods:install', { source: 'modrinth', id: 'main', kind: 'mod', instanceId: 'd' });
  assert.deepStrictEqual(again.skipped, ['Principal']);
});

test('mensajes de CurseForge y limpieza de la key', async () => {
  assert.strictEqual(curseforge.normalizeKey(' x-api-key: "$2a$10$ab\ncd" '), '$2a$10$abcd');
  assert.strictEqual((await curseforge.testKey('')).ok, false);
});

test('las consultas a Modrinth y CurseForge omiten los parámetros vacíos', async () => {
  const seen = [];
  http.getJSON = async url => { seen.push(url); return url.includes('curseforge') ? { data: [], pagination: { totalCount: 0 } } : { hits: [], total_hits: 0 }; };
  assert.strictEqual(http.query({ a: 1, b: '', c: null, d: undefined, e: 0 }), 'a=1&e=0');
});
