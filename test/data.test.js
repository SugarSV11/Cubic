// Rutas de datos, ajustes, cuentas e instancias: formato en disco y comportamiento
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers/env');

const env = setup();
const DATA = env.data;
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ ram: 6, propio: 'se conserva' }));

const P = require('../main/paths');
const store = require('../main/store');
const instances = require('../main/instances');
const accounts = require('../main/accounts');

const read = f => fs.readFileSync(f, 'utf8');
const mode = f => fs.statSync(f).mode & 0o777;

test('rutas de datos del usuario', () => {
  assert.deepStrictEqual({ ...P }, {
    DATA, SHARED: path.join(DATA, 'shared'), INSTANCES: path.join(DATA, 'instances'), JAVA: path.join(DATA, 'java'),
    HORIZON: path.join(DATA, 'horizon'), CONFIG: path.join(DATA, 'config.json'), ACCOUNTS: path.join(DATA, 'accounts.json')
  });
});

test('ajustes: valores por defecto, claves propias y permisos', () => {
  assert.strictEqual(store.config.ram, 6);
  assert.strictEqual(store.config.animatedLogo, true);
  assert.strictEqual(store.config.showSnapshots, false);
  store.saveConfig();
  assert.strictEqual(JSON.parse(read(P.CONFIG)).propio, 'se conserva');
  assert.ok(read(P.CONFIG).startsWith('{\n  "ram": 6,'));
  if (process.platform !== 'win32') assert.strictEqual(mode(P.CONFIG), 0o600);
  assert.ok(!fs.existsSync(`${P.CONFIG}.tmp`));
});

test('readJSON devuelve el valor por defecto si el archivo falta o está roto', () => {
  const f = path.join(env.root, 'roto.json');
  assert.strictEqual(store.readJSON(f, 7), 7);
  fs.writeFileSync(f, '{');
  assert.strictEqual(store.readJSON(f, 8), 8);
});

test('cuentas: offline exige Microsoft, UUID de Java y archivo privado', () => {
  assert.throws(() => accounts.addOffline('Alex'), /primero agrega una cuenta de Microsoft/);
  store.getAccounts().push({ id: 'ms-1', type: 'microsoft', name: 'Dueña', uuid: 'u', refresh: 'secreto' });
  assert.throws(() => accounts.addOffline('a b'), /3 a 16 caracteres/);
  const r = accounts.addOffline('Notch');
  assert.strictEqual(r.accounts[1].uuid, 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.ok(!('refresh' in r.accounts[0]), 'el token no sale a la interfaz');
  assert.throws(() => accounts.addOffline('Notch'), /Ya existe/);
  if (process.platform !== 'win32') assert.strictEqual(mode(P.ACCOUNTS), 0o600);
  assert.deepStrictEqual(accounts.remove('ms-1').accounts, []);
});

test('instancias: crear escribe exactamente el mismo instance.json', t => {
  t.mock.method(Date, 'now', () => 1000);
  const i = instances.create({ name: '', version: '1.21.1', loader: 'fabric', ram: '1', icon: '🌲' });
  assert.strictEqual(i.name, '1.21.1 Fabric');
  assert.strictEqual(read(path.join(P.INSTANCES, i.id, 'instance.json')),
    '{\n  "name": "1.21.1 Fabric",\n  "version": "1.21.1",\n  "loader": "fabric",\n  "ram": 2,\n  "icon": "tree",\n  "created": 1000\n}');
  assert.deepStrictEqual(fs.readdirSync(instances.dirOf(i.id)).sort(), ['config', 'instance.json', 'mods', 'resourcepacks', 'saves', 'shaderpacks']);
  assert.strictEqual(instances.create({ version: '1.21.1', loader: 'fabric' }).id, '1.21.1 Fabric (2)');
});

test('instancias: errores de validación y rutas', () => {
  assert.throws(() => instances.create({ loader: 'fabric' }), /Elige una versión/);
  assert.throws(() => instances.create({ version: '1', loader: 'forge' }), /Loader no soportado/);
  assert.throws(() => instances.create({ version: '1.21.1', loader: 'horizon' }), /solo funciona con la versión 26\.3/);
  assert.throws(() => instances.create({ version: '1', loader: 'vanilla', name: '???' }), /caracteres no permitidos/);
  for (const bad of ['', '..', '../x', 'a/b', '.x']) assert.throws(() => instances.dirOf(bad), /Instancia inválida/);
  assert.throws(() => instances.get('no existe'), /no encontrada/);
});

test('instancias: lista ordenada, valores por defecto y carpetas ajenas ignoradas', () => {
  fs.mkdirSync(path.join(P.INSTANCES, 'sin json'));
  fs.mkdirSync(path.join(P.INSTANCES, 'Antigua'));
  fs.writeFileSync(path.join(P.INSTANCES, 'Antigua', 'instance.json'), JSON.stringify({ name: 'Antigua', version: '1.8.9', icon: '💎' }));
  const l = instances.list();
  assert.deepStrictEqual(l.map(i => i.id), ['1.21.1 Fabric', '1.21.1 Fabric (2)', 'Antigua']);
  assert.deepStrictEqual(l[2], { loader: 'vanilla', ram: 4, name: 'Antigua', version: '1.8.9', icon: 'gem', id: 'Antigua' });
});

test('instancias: editar, duplicar y borrar', () => {
  instances.patch('Antigua', { logo: false });
  const u = instances.update('Antigua', { ram: 8, loader: 'quilt' });
  assert.deepStrictEqual([u.ram, u.loader, u.logo], [8, 'quilt', false]);
  assert.ok(!('id' in JSON.parse(read(path.join(P.INSTANCES, 'Antigua', 'instance.json')))));
  fs.mkdirSync(path.join(instances.dirOf('Antigua'), 'saves', 'mundo'), { recursive: true });
  const d = instances.duplicate('Antigua');
  assert.strictEqual(d.id, 'Antigua (copia)');
  assert.ok(fs.existsSync(path.join(instances.dirOf(d.id), 'saves', 'mundo')));
  store.config.selectedInstance = d.id;
  instances.remove(d.id);
  assert.strictEqual(store.config.selectedInstance, null);
  assert.ok(!fs.existsSync(path.join(P.INSTANCES, d.id)));
});

test('archivos de la instancia y registro de instalados', () => {
  const mods = path.join(instances.dirOf('Antigua'), 'mods');
  fs.mkdirSync(mods, { recursive: true });
  for (const f of ['b.jar', 'a.jar.disabled', 'c.part']) fs.writeFileSync(path.join(mods, f), 'xx');
  instances.markInstalled('Antigua', 'modrinth:1', { title: 'Zeta', file: 'b.jar', source: 'modrinth', kind: 'mods' });
  assert.deepStrictEqual(instances.files('Antigua', 'mods'), [
    { bundled: false, file: 'a.jar.disabled', name: 'a', enabled: false, size: 2, isDir: false, source: null, projectKey: null },
    { bundled: false, file: 'b.jar', name: 'Zeta', enabled: true, size: 2, isDir: false, source: 'modrinth', projectKey: 'modrinth:1' }
  ]);
  instances.toggle('Antigua', 'mods', 'b.jar');
  assert.ok(fs.existsSync(path.join(mods, 'b.jar.disabled')));
  assert.ok(instances.readInstalled('Antigua')['modrinth:1']);
  instances.removeFile('Antigua', 'mods', 'b.jar.disabled');
  assert.deepStrictEqual(instances.readInstalled('Antigua'), {});
  assert.throws(() => instances.files('Antigua', 'saves'), /Tipo inválido/);
  assert.throws(() => instances.removeFile('Antigua', 'mods', '../x'), /Nombre de archivo inválido/);
});
