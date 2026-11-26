// Flujo completo (instalar, preparar y lanzar) con una release y unos binarios de mentira.
// No prueba el Horizon real: solo la orquestación de Cubic.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { execFileSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-flow-'));
const sha = (algo, data) => crypto.createHash(algo).update(data).digest('hex');

// Electron y msmc no se cargan en las pruebas
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => path.join(root, 'data') } };
  if (req === 'msmc') return { Auth: class {} };
  return load.call(this, req, ...rest);
};
os.homedir = () => path.join(root, 'home');

const script = (file, body) => fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });

test('instala, prepara y lanza una instancia Horizon', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // build falsa
  const pkg = path.join(root, 'pkg', 'horizon-linux-x86_64');
  fs.mkdirSync(pkg, { recursive: true });
  script(path.join(pkg, 'horizon-client'), 'echo "args: $*"; echo "home: $HORIZON_HOME"; echo "fallo de prueba" >&2; exit 1');
  script(path.join(pkg, 'horizon-prepare'), [
    'if [ "$1" = "--launch-api" ]; then echo \'{"options":[{"name":"--java-home"},{"name":"--complete"},{"name":"--progress"}]}\'; exit 0; fi',
    'echo \'{"fraction": 0.5}\'; mkdir -p "$2/.local/horizon-client/26.3"; echo "$*" >> "$2/calls.txt"'
  ].join('\n'));
  const jar = 'jar-26.3', server = 'server-26.3';
  fs.writeFileSync(path.join(pkg, 'research-lock.json'), JSON.stringify({ minecraft: { version: '26.3', client_sha1: sha('sha1', jar), server_sha1: sha('sha1', server), java_major: 25 } }));
  const archive = path.join(root, 'build.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'pkg'), 'horizon-linux-x86_64']);

  const P = require('../main/paths');
  // Minecraft "oficial", server.jar y JDK ya presentes
  const mc = path.join(root, 'home', '.minecraft');
  for (const d of ['versions/26.3', 'libraries', 'assets/indexes', 'assets/objects']) fs.mkdirSync(path.join(mc, d), { recursive: true });
  fs.writeFileSync(path.join(mc, 'versions/26.3/26.3.jar'), jar);
  fs.writeFileSync(path.join(mc, 'versions/26.3/26.3.json'), '{}');
  fs.mkdirSync(path.join(P.HORIZON, 'server-jars'), { recursive: true });
  fs.writeFileSync(path.join(P.HORIZON, 'server-jars', '26.3.jar'), server);
  fs.mkdirSync(path.join(P.JAVA, '25-jdk', 'jdk', 'bin'), { recursive: true });
  script(path.join(P.JAVA, '25-jdk', 'jdk', 'bin', 'java'), 'exit 0');

  const http = require('../main/http');
  let downloads = 0;
  http.getJSON = async () => [{ tag_name: 'nightly', prerelease: true, name: 'Nightly 2026-11-18 · abc123', assets: [{ name: 'horizon-linux-x86_64.tar.gz', browser_download_url: 'https://x', digest: `sha256:${sha('sha256', fs.readFileSync(archive))}` }] }];
  http.download = async (_url, dest) => { downloads++; fs.copyFileSync(archive, dest); return dest; };

  const store = require('../main/store');
  const accounts = require('../main/accounts');
  const horizon = require('../main/horizon');

  await t.test('sin cuenta Microsoft no instala nada', async () => {
    await assert.rejects(horizon.ensureInstalled(), /Microsoft/);
    assert.strictEqual(downloads, 0);
  });
  store.getAccounts().push({ id: 'ms-1', type: 'microsoft', name: 'Dueño' }, { id: 'off-alex', type: 'offline', name: 'Alex', uuid: accounts.offlineUUID('Alex') });

  await t.test('instala una sola vez y deja las marcas', async () => {
    const [tag] = await Promise.all([horizon.ensureInstalled(), horizon.ensureInstalled()]);
    await horizon.ensureInstalled();
    assert.strictEqual(tag, 'nightly-2026-11-18-abc123');
    const vdir = path.join(P.HORIZON, 'versions', tag);
    assert.ok(fs.existsSync(path.join(vdir, '.installed')));
    assert.ok(fs.existsSync(path.join(vdir, '.local/horizon-client/26.3/.cubic-prepared')));
    assert.strictEqual(downloads, 1);
    assert.match(fs.readFileSync(path.join(vdir, 'calls.txt'), 'utf8'), /--prepare --server-jar .* --minecraft-dir .* --java-home .* --complete --progress json/);
    assert.strictEqual(horizon.getState().ready, true);
  });

  await t.test('si el juego se cierra al instante, el error trae el log', async () => {
    await assert.rejects(horizon.start({ home: path.join(root, 'inst'), accountId: 'off-alex', onClose: () => {} }), /código 1.*fallo de prueba/);
  });
});
