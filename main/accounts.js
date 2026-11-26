// Cuentas: Microsoft (msmc) y offline
const crypto = require('crypto');
const { Auth } = require('msmc');
const store = require('./store');
const { getWindow } = require('./bus');

const sessions = new Map(); // id -> objeto Minecraft de msmc (token en memoria)

// UUID offline: igual que Java: UUID.nameUUIDFromBytes("OfflinePlayer:<nombre>") (MD5, versión 3)
function offlineUUID(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function friendlyAuthError(e) {
  const code = typeof e === 'string' ? e : e?.message || '';
  const map = {
    'error.gui.closed': 'Cerraste la ventana de inicio de sesión.',
    'error.auth.xsts.userNotFound': 'Esa cuenta de Microsoft no tiene perfil de Xbox. Créalo en xbox.com e inténtalo de nuevo.',
    'error.auth.xsts.bannedCountry': 'Xbox Live no está disponible en tu país.',
    'error.auth.xsts.child': 'Las cuentas de menores necesitan que un adulto las agregue a una Familia de Microsoft.',
    'error.auth.xsts.child.SK': 'Las cuentas de menores necesitan que un adulto las agregue a una Familia de Microsoft.',
    'error.auth.minecraft.profile': 'Esta cuenta no tiene Minecraft Java Edition comprado.',
    'error.auth.minecraft.entitlements': 'Esta cuenta no tiene Minecraft Java Edition comprado.'
  };
  return map[code] || (code.startsWith('error.') ? `No se pudo iniciar sesión (${code}).` : code || 'No se pudo iniciar sesión.');
}

const pub = a => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, expired: !!a.expired });

function list() {
  const accounts = store.getAccounts();
  let sel = store.config.selectedAccount;
  if (!accounts.find(a => a.id === sel)) sel = accounts[0]?.id || null;
  return { accounts: accounts.map(pub), selected: sel };
}

async function addMicrosoft() {
  let xbox, mc;
  try {
    const auth = new Auth('select_account');
    xbox = await auth.launch('electron', { width: 500, height: 650, resizable: false, title: 'Iniciar sesión con Microsoft', parent: getWindow(), modal: true });
    mc = await xbox.getMinecraft();
    if (!mc.profile) throw 'error.auth.minecraft.profile';
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
  const accounts = store.getAccounts();
  const id = `ms-${mc.profile.id}`;
  const acc = { id, type: 'microsoft', name: mc.profile.name, uuid: mc.profile.id, refresh: xbox.save() };
  const i = accounts.findIndex(a => a.id === id);
  if (i >= 0) accounts[i] = acc; else accounts.push(acc);
  sessions.set(id, mc);
  store.config.selectedAccount = id;
  store.saveConfig();
  store.saveAccounts();
  return list();
}

function addOffline(name) {
  name = String(name || '').trim();
  const accounts = store.getAccounts();
  if (!accounts.some(a => a.type === 'microsoft')) {
    throw new Error('Para crear cuentas offline primero agrega una cuenta de Microsoft con Minecraft comprado.');
  }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('El nombre debe tener de 3 a 16 caracteres: letras, números o guion bajo.');
  }
  const id = `off-${name.toLowerCase()}`;
  if (accounts.some(a => a.id === id)) throw new Error('Ya existe una cuenta offline con ese nombre.');
  accounts.push({ id, type: 'offline', name, uuid: offlineUUID(name) });
  store.config.selectedAccount = id;
  store.saveConfig();
  store.saveAccounts();
  return list();
}

function remove(id) {
  const accounts = store.getAccounts();
  const i = accounts.findIndex(a => a.id === id);
  if (i < 0) return list();
  accounts.splice(i, 1);
  sessions.delete(id);
  // si ya no queda ninguna cuenta Microsoft, las offline dejan de ser válidas
  if (!accounts.some(a => a.type === 'microsoft')) accounts.length = 0;
  if (store.config.selectedAccount === id) store.config.selectedAccount = null;
  store.saveConfig();
  store.saveAccounts();
  return list();
}

function select(id) {
  if (!store.getAccounts().some(a => a.id === id)) throw new Error('Cuenta no encontrada');
  store.config.selectedAccount = id;
  store.saveConfig();
  return list();
}

// Devuelve el objeto de autenticación que entiende MCLC (refrescando el token si hace falta)
async function getAuth(id) {
  const acc = store.getAccounts().find(a => a.id === id);
  if (!acc) throw new Error('Elige una cuenta para jugar');
  if (acc.type === 'offline') {
    return { access_token: acc.uuid.replace(/-/g, ''), client_token: acc.uuid.replace(/-/g, ''), uuid: acc.uuid, name: acc.name, user_properties: '{}', meta: { type: 'mojang', demo: false } };
  }
  let mc = sessions.get(id);
  if (!mc) {
    try {
      const xbox = await new Auth('none').refresh(acc.refresh);
      mc = await xbox.getMinecraft();
      acc.refresh = xbox.save();
      acc.expired = false;
      store.saveAccounts();
      sessions.set(id, mc);
    } catch (e) {
      const offline = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(e?.code) || /fetch failed/i.test(e?.message || '');
      if (offline) throw new Error('No hay conexión con los servidores de Microsoft.');
      acc.expired = true;
      store.saveAccounts();
      throw new Error('La sesión de esta cuenta caducó. Ve a Cuentas y vuelve a iniciar sesión.');
    }
  } else if (!mc.validate()) {
    try { await mc.refresh(); } catch { sessions.delete(id); return getAuth(id); }
  }
  return mc.mclc();
}

module.exports = { list, addMicrosoft, addOffline, remove, select, getAuth, offlineUUID };
