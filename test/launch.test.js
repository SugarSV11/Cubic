// Qué recibe MCLC al pulsar «Jugar» y qué mensajes ve el usuario (red, Java y juego simulados)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { setup } = require('./helpers/env');

let launched = null, client = null, failLaunch = false, killed = 0;
class Client {
  constructor() { this.on_ = {}; client = this; }
  on(ev, fn) { this.on_[ev] = fn; }
  async launch(opts) { launched = opts; return failLaunch ? null : { kill() { killed++; } }; }
}
const env = setup({ 'minecraft-launcher-core': { Client } });
const http = require('../main/http');
const java = require('../main/java');
const urls = [];
http.getJSON = async url => {
  urls.push(url);
  if (url.includes('version_manifest')) return { latest: { release: '1.21.1' }, versions: [{ id: '1.21.1', type: 'release', url: 'https://v/1.21.1' }, { id: '24w01a', type: 'snapshot', url: 'https://v/s' }] };
  if (url.startsWith('https://v/')) return { javaVersion: { majorVersion: 21 } };
  if (url.endsWith('/profile/json')) return { id: url.includes('quilt') ? 'quilt-p' : 'fabric-p' };
  return [{ loader: { version: '0.9.0', stable: true } }, { loader: { version: '0.10.0', stable: true } }];
};
let javaAsked;
java.ensureJava = async v => { javaAsked = v; return '/java/bin/java'; };
const accounts = require('../main/accounts');
accounts.getAuth = async id => ({ name: id });
const logo = require('../main/animated-logo');
let intro = false;
logo.trySync = async () => ({ active: intro });
const bus = require('../main/bus');
const messages = [];
bus.setWindow({ isDestroyed: () => false, webContents: { send: (ch, d) => messages.push([ch, d]) } });
const instances = require('../main/instances');
const launcher = require('../main/launcher');
const P = require('../main/paths');

const statuses = () => messages.filter(m => m[0] === 'status').map(m => m[1].text);
const finish = () => client.on_.close(0);
async function play(loader, name, ram = 5) {
  instances.create({ name, version: '1.21.1', loader, ram });
  messages.length = 0; urls.length = 0; launched = null;
  await launcher.launch({ instanceId: name, accountId: 'acc' });
}

test('vanilla: opciones exactas que recibe MCLC y textos de progreso', async () => {
  await play('vanilla', 'V');
  const dir = path.join(P.INSTANCES, 'V');
  assert.deepStrictEqual(launched, {
    authorization: { name: 'acc' }, root: P.SHARED, javaPath: '/java/bin/java',
    version: { number: '1.21.1', type: 'release' }, memory: { max: '5G', min: '2G' },
    overrides: { detached: false, gameDirectory: dir, cwd: dir }
  });
  assert.strictEqual(javaAsked, 21);
  assert.deepStrictEqual(statuses(), ['Comprobando cuenta…', 'Leyendo versión…', 'Preparando la intro animada…', 'Lanzando Minecraft…', 'Minecraft abriéndose…']);
  assert.ok(launcher.isBusy());
  assert.strictEqual(launcher.runningId(), 'V');
  await assert.rejects(launcher.launch({ instanceId: 'V', accountId: 'acc' }), /ya está abierto/);
  client.on_.progress({ type: 'assets', task: 1, total: 4 });
  client.on_.data('Setting user: x');
  assert.deepStrictEqual(statuses().slice(-2), ['Descargando assets…', '¡Minecraft abierto!']);
  messages.length = 0;
  finish();
  assert.deepStrictEqual(messages, [['game-closed', 0], ['status', { text: 'Listo', progress: null }]]);
  assert.ok(!launcher.isBusy());
});

test('fabric y quilt usan su perfil (el loader estable más nuevo)', async () => {
  for (const [loader, name, label] of [['fabric', 'F', 'Fabric'], ['quilt', 'Q', 'Quilt']]) {
    await play(loader, name);
    assert.strictEqual(launched.version.custom, `${loader}-p`);
    assert.ok(urls.some(u => u.endsWith('/1.21.1/0.10.0/profile/json')));
    assert.ok(statuses().includes(`Preparando ${label}…`));
    client.on_.progress({ type: 'classes-custom', task: 1, total: 2 });
    assert.strictEqual(statuses().at(-1), `Descargando librerías de ${label}…`);
    finish();
  }
});

test('vanilla con intro animada arranca con Fabric', async () => {
  intro = true;
  await play('vanilla', 'I');
  intro = false;
  assert.strictEqual(launched.version.custom, 'fabric-p');
  assert.ok(statuses().includes('Preparando Fabric para la intro animada…'));
  finish();
});

test('los errores liberan el botón Jugar', async () => {
  instances.create({ name: 'E', version: '9.9', loader: 'vanilla' });
  await assert.rejects(launcher.launch({ instanceId: 'E', accountId: 'acc' }), /ya no existe en el manifest/);
  assert.ok(!launcher.isBusy());
  failLaunch = true;
  instances.create({ name: 'E2', version: '1.21.1', loader: 'vanilla' });
  await assert.rejects(launcher.launch({ instanceId: 'E2', accountId: 'acc' }), /No se pudo lanzar/);
  failLaunch = false;
  assert.ok(!launcher.isBusy());
});

test('«Detener» cierra el juego y no hace nada si no hay partida', async () => {
  await play('vanilla', 'S');
  launcher.stop();
  assert.strictEqual(killed, 1);
  finish();
  launcher.stop();
  assert.strictEqual(killed, 1);
});

test('lista de versiones con y sin snapshots', async () => {
  assert.deepStrictEqual((await launcher.versions(false)).list.map(v => v.id), ['1.21.1']);
  assert.deepStrictEqual((await launcher.versions(true)).list.map(v => v.id), ['1.21.1', '24w01a']);
});
