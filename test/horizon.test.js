const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const C = require('../main/horizon-core');

const tmp = t => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-hz-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const asset = name => ({ name, digest: `sha256:${'a'.repeat(64)}` });

test('ruta de versiones y de recursos', () => {
  assert.strictEqual(C.versionDir('/d/horizon', 'nightly-2026-10-28-0c02067'), path.join('/d/horizon', 'versions', 'nightly-2026-10-28-0c02067'));
  assert.strictEqual(C.resourcesDir('/v'), path.join('/v', '.local', 'horizon-client', '26.3'));
  for (const bad of ['..', '../x', 'a/b', '', '.oculta']) assert.throws(() => C.versionDir('/d', bad), /no válido/);
});

test('solo cuenta como instalada la versión con .installed', t => {
  const base = tmp(t);
  assert.strictEqual(C.installedVersion(base), null);
  const dir = C.versionDir(base, 'v1.0.0');
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(C.installedVersion(base), null);
  fs.writeFileSync(path.join(dir, '.installed'), '');
  assert.strictEqual(C.installedVersion(base), 'v1.0.0');
});

test('elige la build del juego, no la del launcher', () => {
  const list = [
    { tag_name: 'launcher@2.0.0', published_at: '2026-11-20', assets: [asset('horizon-launcher-linux-x86_64.tar.gz')] },
    { tag_name: 'v0.3.0', published_at: '2026-10-01', assets: [asset('horizon-linux-x86_64.tar.gz')] },
    { tag_name: 'nightly', prerelease: true, published_at: '2026-11-18', name: 'Nightly 2026-11-18 · 0c02067', assets: [asset('horizon-linux-x86_64.tar.gz'), asset('horizon-windows-x64.zip')] }
  ];
  assert.strictEqual(C.pickRelease(list, 'linux', 'x64').tag, 'nightly-2026-11-18-0c02067');
  assert.strictEqual(C.pickRelease(list, 'win32', 'arm64').asset.name, 'horizon-windows-x64.zip');
  assert.throws(() => C.pickRelease(list, 'linux', 'arm64'), /no publica versión para este sistema/);
  assert.throws(() => C.pickRelease(list, 'darwin', 'arm64'), /no trae un archivo/);
});

test('comando de lanzamiento: cuenta offline', () => {
  const env = { PATH: '/usr/bin', HORIZON_ACCOUNT_SESSIONS: 'x', HORIZON_SESSION_FILE: 'y', LIBGL_ALWAYS_SOFTWARE: '1', ELECTRON_RUN_AS_NODE: '1' };
  const c = C.buildLaunchCommand({ vdir: '/v', home: '/inst', name: 'Alex', env, platform: 'linux' });
  assert.strictEqual(c.command, path.join('/v', 'horizon-client'));
  assert.strictEqual(c.cwd, '/inst');
  assert.deepStrictEqual(c.args, ['--resources', C.resourcesDir('/v'), '--name', 'Alex']);
  assert.strictEqual(c.env.HORIZON_HOME, '/inst');
  assert.match(c.env.PIPEWIRE_PROPS, /application\.name = "Horizon"/);
  for (const k of ['HORIZON_ACCOUNT_SESSIONS', 'HORIZON_SESSION_FILE', 'LIBGL_ALWAYS_SOFTWARE', 'ELECTRON_RUN_AS_NODE']) assert.ok(!(k in c.env), k);
});

test('comando de lanzamiento: cuenta Microsoft, Windows y AppImage', () => {
  const env = { APPDIR: '/tmp/.mount_x', LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib:/opt/lib', PIPEWIRE_PROPS: 'mío' };
  const c = C.buildLaunchCommand({ vdir: '/v', home: '/inst', sessionFile: '/inst/sessions/s.json', name: 'Alex', env, platform: 'win32' });
  assert.ok(c.command.endsWith('horizon-client.exe'));
  assert.deepStrictEqual(c.args.slice(2), ['--session-file', '/inst/sessions/s.json']);
  assert.strictEqual(c.env.LD_LIBRARY_PATH, '/opt/lib');
  assert.strictEqual(c.env.PIPEWIRE_PROPS, 'mío');
});

test('archivo de sesión: formato de Horizon y solo legible por el usuario', t => {
  const home = tmp(t);
  const file = C.writeSessionFile(home, { name: 'Alex', uuid: 'abc', access_token: 'tok', meta: { xuid: '9' } });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Alex', uuid: 'abc', access_token: 'tok', user_type: 'msa', xuid: '9' });
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('comprueba el checksum del jar y rechaza otra versión', async t => {
  const dir = tmp(t);
  const jar = path.join(dir, 'versions', '26.3', '26.3.jar');
  const sha1 = crypto.createHash('sha1').update('bueno').digest('hex');
  assert.strictEqual((await C.inspectMinecraftDir(dir, sha1)).reason, 'missing-jar');
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  fs.writeFileSync(jar, 'otra versión');
  assert.strictEqual((await C.inspectMinecraftDir(dir, sha1)).reason, 'wrong-jar');
  fs.writeFileSync(jar, 'bueno');
  assert.strictEqual((await C.inspectMinecraftDir(dir, sha1)).reason, 'incomplete');
  for (const d of ['libraries', 'assets/indexes', 'assets/objects']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'versions', '26.3', '26.3.json'), '{}');
  assert.strictEqual((await C.inspectMinecraftDir(dir, sha1)).ok, true);
});

test('al preparador solo se le pasan las opciones que declara', () => {
  const base = { root: '/v', serverJar: '/s.jar', minecraftDir: '/mc', javaHome: '/j' };
  assert.deepStrictEqual(C.prepareArgs(base), ['--root', '/v', '--prepare', '--server-jar', '/s.jar', '--minecraft-dir', '/mc']);
  assert.deepStrictEqual(C.prepareArgs({ ...base, options: ['--java-home', '--complete', '--progress'] }).slice(7), ['--java-home', '/j', '--complete', '--progress', 'json']);
});
