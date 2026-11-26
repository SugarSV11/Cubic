// Todas las funciones que la interfaz puede pedirle al proceso principal
const { ipcMain, shell, app } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const bus = require('./bus');
const store = require('./store');
const P = require('./paths');
const accounts = require('./accounts');
const instances = require('./instances');
const launcher = require('./launcher');
const horizon = require('./horizon');
const logo = require('./animated-logo');

const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));

function register() {
  ipcMain.on('win', (_e, action) => {
    const win = bus.getWindow();
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });

  // cada instancia viaja con el estado de su intro animada
  const view = i => ({ ...i, intro: logo.describe(i) });
  const listInstances = () => instances.list().map(view);
  // los jars de una instancia abierta no se tocan; se ajustará en el siguiente arranque
  const syncIntro = (id, opts) => (launcher.runningId() === id ? Promise.resolve() : logo.trySync(id, opts));
  // migración suave de las instancias que ya existían (sin red)
  const migrated = logo.syncAll();

  handle('init', async () => ({
    accounts: accounts.list(),
    instances: (await migrated, listInstances()),
    intro: logo.info(),
    settings: publicSettings(),
    totalRam: Math.floor(os.totalmem() / 1024 ** 3),
    icons: instances.ICONS,
    dataDir: P.DATA,
    platform: process.platform,
    version: app.getVersion(),
    appName: app.getName()
  }));

  // ----- ajustes -----
  handle('settings:set', async s => {
    for (const k of ['ram', 'showSnapshots', 'curseforgeKey', 'selectedInstance']) if (k in s) store.config[k] = s[k];
    if ('animatedLogo' in s) store.config.animatedLogo = s.animatedLogo === true;
    if ('curseforgeKey' in s) store.config.curseforgeKey = require('./curseforge').normalizeKey(s.curseforgeKey);
    store.saveConfig();
    if ('animatedLogo' in s) await logo.syncAll(launcher.runningId());
    return publicSettings();
  });

  // ----- cuentas -----
  handle('accounts:list', () => accounts.list());
  handle('accounts:addMicrosoft', () => accounts.addMicrosoft());
  handle('accounts:addOffline', name => accounts.addOffline(name));
  handle('accounts:remove', id => accounts.remove(id));
  handle('accounts:select', id => accounts.select(id));

  // ----- versiones -----
  handle('versions', snapshots => launcher.versions(snapshots));

  // ----- instancias -----
  handle('instances:list', () => listInstances());
  // al crear (o convertir) una instancia Horizon se instala todo en segundo plano
  // y en las demás se copia la intro animada compatible
  const prepare = async inst => {
    if (inst.loader === 'horizon') horizon.ensureInstalled().catch(() => { /* el error queda en el estado */ });
    await syncIntro(inst.id);
    syncIntro(inst.id, { download: true }); // versiones no incluidas: se bajan en segundo plano
    return view(instances.get(inst.id));
  };
  handle('instances:create', d => prepare(instances.create(d)));
  handle('instances:update', (id, d) => prepare(instances.update(id, d)));
  handle('instances:intro', async (id, value) => {
    if (launcher.runningId() === id) throw new Error('No se puede cambiar mientras Minecraft está abierto.');
    logo.setOverride(id, value);
    await logo.sync(id, { download: true });
    return view(instances.get(id));
  });
  handle('instances:duplicate', id => instances.duplicate(id));
  handle('instances:remove', id => {
    if (launcher.runningId() === id) throw new Error('No puedes borrar la instancia mientras Minecraft está abierto.');
    return instances.remove(id);
  });
  handle('instances:files', (id, kind) => instances.files(id, kind));
  // tocar un mod a mano se respeta: la sincronización toma nota enseguida
  handle('instances:toggle', async (id, kind, file) => { instances.toggle(id, kind, file); if (kind === 'mods') await syncIntro(id); });
  handle('instances:removeFile', async (id, kind, file) => { instances.removeFile(id, kind, file); if (kind === 'mods') await syncIntro(id); });
  handle('instances:open', async (id, sub) => {
    const dir = sub ? instances.kindDir(id, sub) : instances.dirOf(id);
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });

  // ----- Horizon -----
  handle('horizon:state', () => horizon.getState());
  handle('horizon:install', d => { horizon.ensureInstalled({ download: !!d?.download }).catch(() => {}); return horizon.getState(); });

  // ----- jugar -----
  handle('game:launch', d => launcher.launch(d));
  handle('game:stop', () => launcher.stop());

  // ----- enlaces externos (solo https) -----
  handle('openExternal', url => {
    if (!/^https:\/\//i.test(String(url))) throw new Error('Enlace no permitido');
    return shell.openExternal(url);
  });

  handle('licenses:open', async () => {
    const err = await shell.openPath(logo.licensesDir());
    if (err) throw new Error(err);
  });

  require('./mods-ipc').register(handle);
}

const publicSettings = () => {
  const { ram, showSnapshots, curseforgeKey, selectedInstance, animatedLogo } = store.config;
  return { animatedLogo, ram, showSnapshots, hasCurseforgeKey: !!curseforgeKey, selectedInstance };
};

module.exports = { register };
