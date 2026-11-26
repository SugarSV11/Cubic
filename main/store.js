// Lectura/escritura de JSON (config y cuentas)
const fs = require('fs');
const path = require('path');
const P = require('./paths');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file); // escritura atómica: nunca queda un archivo a medias
}

const DEFAULTS = {
  ram: 4,                 // RAM por defecto para instancias nuevas
  showSnapshots: false,
  curseforgeKey: '',
  animatedLogo: true,     // intro animada (mod incluido); cada instancia puede cambiarlo
  selectedInstance: null,
  selectedAccount: null
};
const config = { ...DEFAULTS, ...readJSON(P.CONFIG, {}) };
const saveConfig = () => writeJSON(P.CONFIG, config, 0o600); // contiene la API key

// accounts.json: [{ id, type: 'microsoft'|'offline', name, uuid, refresh? }]
let accounts = readJSON(P.ACCOUNTS, []);
const saveAccounts = () => writeJSON(P.ACCOUNTS, accounts, 0o600); // contiene refresh tokens
const getAccounts = () => accounts;

module.exports = { readJSON, writeJSON, config, saveConfig, getAccounts, saveAccounts };
