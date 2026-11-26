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

const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));

function register() {
  ipcMain.on('win', (_e, action) => {
    const win = bus.getWindow();
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });

  handle('init', () => ({
    accounts: accounts.list(),
    instances: instances.list(),
    settings: publicSettings(),
    totalRam: Math.floor(os.totalmem() / 1024 ** 3),
    icons: instances.ICONS,
    dataDir: P.DATA,
    platform: process.platform,
    version: app.getVersion(),
    appName: app.getName()
  }));

  // ----- ajustes -----
  handle('settings:set', s => {
    for (const k of ['ram', 'showSnapshots', 'curseforgeKey', 'selectedInstance']) if (k in s) store.config[k] = s[k];
    if ('curseforgeKey' in s) store.config.curseforgeKey = require('./curseforge').normalizeKey(s.curseforgeKey);
    store.saveConfig();
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
  handle('instances:list', () => instances.list());
  // al crear (o convertir) una instancia Horizon se instala todo en segundo plano
  const prepareIfHorizon = inst => {
    if (inst.loader === 'horizon') horizon.ensureInstalled().catch(() => { /* el error queda en el estado */ });
    return inst;
  };
  handle('instances:create', d => prepareIfHorizon(instances.create(d)));
  handle('instances:update', (id, d) => prepareIfHorizon(instances.update(id, d)));
  handle('instances:duplicate', id => instances.duplicate(id));
  handle('instances:remove', id => {
    if (launcher.runningId() === id) throw new Error('No puedes borrar la instancia mientras Minecraft está abierto.');
    return instances.remove(id);
  });
  handle('instances:files', (id, kind) => instances.files(id, kind));
  handle('instances:toggle', (id, kind, file) => instances.toggle(id, kind, file));
  handle('instances:removeFile', (id, kind, file) => instances.removeFile(id, kind, file));
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

  require('./mods-ipc').register(handle);
}

const publicSettings = () => {
  const { ram, showSnapshots, curseforgeKey, selectedInstance } = store.config;
  return { ram, showSnapshots, hasCurseforgeKey: !!curseforgeKey, selectedInstance };
};

module.exports = { register };
