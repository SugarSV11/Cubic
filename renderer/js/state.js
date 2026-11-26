// Estado global de la interfaz + pequeño sistema de eventos
export const state = {
  accounts: [], selectedAccount: null,
  instances: [], settings: {}, totalRam: 8, icons: [],
  platform: '', version: '', dataDir: '',
  busy: false,      // preparando / descargando
  playing: false,   // Minecraft abierto
  progress: { text: 'Listo', progress: null },
  logs: []
};

const subs = new Map();
export const on = (type, fn) => { (subs.get(type) || subs.set(type, new Set()).get(type)).add(fn); return () => subs.get(type).delete(fn); };
export const emit = (type, data) => subs.get(type)?.forEach(fn => fn(data));

export const selectedInstance = () => state.instances.find(i => i.id === state.settings.selectedInstance) || state.instances[0] || null;
export const selectedAccount = () => state.accounts.find(a => a.id === state.selectedAccount) || state.accounts[0] || null;

export async function refreshInstances() { state.instances = await window.api.instances.list(); emit('instances'); }
export function applyAccounts(r) { state.accounts = r.accounts; state.selectedAccount = r.selected; emit('accounts'); }
export const hasMicrosoft = () => state.accounts.some(a => a.type === 'microsoft');

export const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };
