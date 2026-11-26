// Entorno de pruebas: carpeta de datos temporal y dobles de Electron, msmc y MCLC
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function setup(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-test-'));
  const handlers = new Map();
  const stubs = {
    electron: {
      app: { getPath: () => path.join(root, 'data'), getVersion: () => '1.0.0', getName: () => 'Cubic', isPackaged: false },
      ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} },
      shell: { openPath: async () => '', openExternal: async () => {} }
    },
    msmc: { Auth: class {} },
    ...overrides
  };
  const load = Module._load;
  Module._load = function (req, ...rest) { return req in stubs ? stubs[req] : load.call(this, req, ...rest); };
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  const invoke = (ch, ...args) => handlers.get(ch)(null, ...args);
  return { root, data: path.join(root, 'data'), handlers, invoke, stubs };
}

module.exports = { setup };
