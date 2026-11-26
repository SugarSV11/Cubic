// Lanzar una instancia con una cuenta
const fs = require('fs');
const path = require('path');
const { Client } = require('minecraft-launcher-core');
const { SHARED } = require('./paths');
const { getJSON } = require('./http');
const { ensureJava } = require('./java');
const { status, log, send } = require('./bus');
const accounts = require('./accounts');
const instances = require('./instances');
const horizon = require('./horizon');
const logo = require('./animated-logo');
const store = require('./store');

let busy = false;
let proc = null;
let running = null; // instancia que se está preparando o jugando
const isBusy = () => busy || horizon.isInstalling();
const runningId = () => (busy ? running : null);

let manifestCache = null;
async function getManifest() {
  if (!manifestCache) manifestCache = await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return manifestCache;
}

async function versions(snapshots) {
  const m = await getManifest();
  return {
    latest: m.latest.release,
    list: m.versions.filter(v => v.type === 'release' || (snapshots && v.type === 'snapshot')).map(v => ({ id: v.id, type: v.type }))
  };
}

// Fabric y Quilt publican un "perfil" de versión que MCLC sabe leer como versión custom
const PROFILES = {
  fabric: { name: 'Fabric', base: 'https://meta.fabricmc.net/v2/versions/loader', pickStable: l => l.loader.stable },
  quilt: { name: 'Quilt', base: 'https://meta.quiltmc.org/v3/versions/loader', pickStable: l => !/beta|alpha|rc/i.test(l.loader.version) }
};
async function prepareProfile(kind, mc) {
  const P = PROFILES[kind];
  const loaders = await getJSON(`${P.base}/${encodeURIComponent(mc)}`);
  if (!loaders.length) throw new Error(`${P.name} todavía no soporta Minecraft ${mc}`);
  // Quilt entrega la lista desordenada: se ordena de la más nueva a la más vieja antes de elegir
  loaders.sort((a, b) => b.loader.version.localeCompare(a.loader.version, undefined, { numeric: true }));
  const loader = (loaders.find(P.pickStable) || loaders[0]).loader.version;
  const profile = await getJSON(`${P.base}/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`);
  const vdir = path.join(SHARED, 'versions', profile.id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}

// Con qué se arranca: el loader de la instancia, o Fabric si es Vanilla con la intro animada
async function chooseProfile(inst) {
  // la intro animada nunca impide jugar: si algo falla, se arranca sin ella
  status('Preparando la intro animada…');
  const intro = await logo.trySync(inst.id, { download: true });

  if (inst.loader !== 'vanilla') {
    status(`Preparando ${PROFILES[inst.loader].name}…`);
    return { loader: inst.loader, custom: await prepareProfile(inst.loader, inst.version) };
  }
  if (intro.active) {
    // la instancia sigue siendo vanilla; solo este arranque usa Fabric Loader
    status('Preparando Fabric para la intro animada…');
    try { return { loader: 'fabric', custom: await prepareProfile('fabric', inst.version) }; }
    catch (e) { log(`[Cubic] Sin intro animada: no se pudo preparar Fabric (${e.message}). Se juega en Vanilla.`); }
  }
  return { loader: 'vanilla' };
}

// el juego terminó: se libera el botón Jugar y se avisa a la interfaz
function finishGame(code) {
  busy = false; proc = null;
  send('game-closed', code);
  status('Listo', null);
}

async function launch({ instanceId, accountId }) {
  if (busy) throw new Error('El juego ya está abierto o descargándose');
  busy = true;
  running = instanceId;
  try {
    const inst = instances.get(instanceId);
    if (inst.loader === 'horizon') return await launchHorizon(inst, accountId);
    status('Comprobando cuenta…');
    const authorization = await accounts.getAuth(accountId);
    store.config.selectedInstance = instanceId;
    store.config.selectedAccount = accountId;
    store.saveConfig();

    status('Leyendo versión…');
    const m = await getManifest();
    const entry = m.versions.find(v => v.id === inst.version);
    if (!entry) throw new Error(`La versión ${inst.version} ya no existe en el manifest de Mojang`);
    const vjson = await getJSON(entry.url);
    const javaPath = await ensureJava(vjson.javaVersion?.majorVersion || 8);

    const { loader, custom } = await chooseProfile(inst);

    const dir = instances.dirOf(instanceId);
    const launcher = new Client();
    const opts = {
      authorization,
      root: SHARED, // librerías, assets y versiones compartidas entre instancias
      javaPath,
      version: { number: inst.version, type: entry.type, ...(custom ? { custom } : {}) },
      memory: { max: `${inst.ram}G`, min: `${Math.max(1, Math.floor(inst.ram / 2))}G` },
      overrides: { detached: false, gameDirectory: dir, cwd: dir }
    };

    const names = {
      assets: 'Descargando assets', natives: 'Descargando natives', classes: 'Descargando librerías',
      'classes-custom': `Descargando librerías de ${PROFILES[loader]?.name || ''}`,
      'classes-maven-custom': 'Descargando librerías', 'version-jar': 'Descargando Minecraft'
    };
    launcher.on('progress', p => status(`${names[p.type] || 'Descargando'}…`, p.total ? p.task / p.total : null));
    launcher.on('debug', log);
    launcher.on('data', d => {
      log(d);
      if (/Setting user|LWJGL/.test(String(d))) status('¡Minecraft abierto!', 1);
    });
    launcher.on('close', finishGame);

    status('Lanzando Minecraft…');
    proc = await launcher.launch(opts);
    if (!proc) throw new Error('No se pudo lanzar el juego (revisa los logs)');
    status('Minecraft abriéndose…', 1);
    return true;
  } catch (e) {
    busy = false; proc = null;
    status('Listo', null);
    log(`[Cubic] Error: ${e?.stack || e}`);
    throw e;
  }
}

// Horizon es un programa propio: no usa MCLC ni Java para jugar. Su carpeta de datos es la de la instancia.
async function launchHorizon(inst, accountId) {
  status('Comprobando cuenta…');
  store.config.selectedInstance = inst.id;
  store.config.selectedAccount = accountId;
  store.saveConfig();
  proc = await horizon.start({
    home: instances.dirOf(inst.id),
    accountId,
    onProgress: status,
    onClose: finishGame
  });
  if (busy) status('¡Minecraft abierto!', 1);
  return true;
}

function stop() { if (proc) proc.kill(); }
// al cerrar el launcher: se detiene también la preparación de Horizon
function shutdown() { stop(); horizon.abort(); }

module.exports = { launch, stop, shutdown, isBusy, runningId, versions };
