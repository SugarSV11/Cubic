// Canal para mandar mensajes del proceso principal a la interfaz
let win = null;
const setWindow = w => { win = w; };
const getWindow = () => win;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const status = (text, progress = null) => send('status', { text, progress });
const log = text => send('log', String(text));
module.exports = { setWindow, getWindow, send, status, log };
