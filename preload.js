// Puente seguro: la interfaz solo puede llamar a lo que se expone aquí
const { contextBridge, ipcRenderer } = require('electron');

// "Error invoking remote method 'x': Error: mensaje"  →  "mensaje"
const clean = e => new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a).catch(e => { throw clean(e); });

const EVENTS = new Set(['status', 'log', 'game-closed', 'maximized', 'install-progress']);

contextBridge.exposeInMainWorld('api', {
  win: action => ipcRenderer.send('win', action),
  init: () => call('init'),
  setSettings: s => call('settings:set', s),
  versions: snapshots => call('versions', snapshots),
  openExternal: url => call('openExternal', url),

  accounts: {
    list: () => call('accounts:list'),
    addMicrosoft: () => call('accounts:addMicrosoft'),
    addOffline: name => call('accounts:addOffline', name),
    remove: id => call('accounts:remove', id),
    select: id => call('accounts:select', id)
  },
  instances: {
    list: () => call('instances:list'),
    create: d => call('instances:create', d),
    update: (id, d) => call('instances:update', id, d),
    duplicate: id => call('instances:duplicate', id),
    remove: id => call('instances:remove', id),
    files: (id, kind) => call('instances:files', id, kind),
    toggle: (id, kind, file) => call('instances:toggle', id, kind, file),
    removeFile: (id, kind, file) => call('instances:removeFile', id, kind, file),
    open: (id, sub) => call('instances:open', id, sub)
  },
  game: {
    launch: d => call('game:launch', d),
    stop: () => call('game:stop')
  },
  mods: {
    categories: (source, kind) => call('mods:categories', source, kind),
    search: q => call('mods:search', q),
    detail: (source, id, kind) => call('mods:detail', source, id, kind),
    compat: (source, id, kind) => call('mods:compat', source, id, kind),
    install: d => call('mods:install', d)
  },
  curseforge: {
    test: key => call('curseforge:test', key)
  },
  on: (ch, cb) => {
    if (!EVENTS.has(ch)) throw new Error('Evento no permitido');
    const fn = (_e, d) => cb(d);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  }
});
