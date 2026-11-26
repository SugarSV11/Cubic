// Cubic — punto de entrada (Electron)
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const bus = require('./main/bus');

// 1) migrar datos de la carpeta antigua ANTES de que Electron cree la nueva
const migrated = require('./main/migrate').run();
if (migrated) console.log('[Cubic] Datos migrados desde', migrated.from, '→', migrated.done.join(', '));

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 740, minWidth: 980, minHeight: 620,
    frame: false,
    title: 'Cubic',
    backgroundColor: '#0d0e11',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  bus.setWindow(win);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // la interfaz nunca navega ni abre ventanas por su cuenta
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // al cerrar con el juego abierto o descargando, preguntar antes de que la ventana desaparezca
  win.on('close', e => {
    const launcher = require('./main/launcher');
    if (!launcher.isBusy()) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Cancelar', 'Cerrar todo'], defaultId: 0, cancelId: 0,
      title: 'Cubic', message: 'Minecraft sigue abierto o descargando.',
      detail: 'Si cierras el launcher, también se cerrará el juego.'
    });
    if (r === 0) e.preventDefault(); else launcher.stop();
  });
  win.on('maximize', () => bus.send('maximized', true));
  win.on('unmaximize', () => bus.send('maximized', false));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { require('./main/ipc').register(); createWindow(); });
  app.on('window-all-closed', () => app.quit());

}
