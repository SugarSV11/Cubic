import { h, clear } from './lib/dom.js';
import { icons } from './lib/icons.js';
import { toast, toastError } from './lib/toast.js';
import { avatar } from './lib/ui.js';
import { state, on, emit, selectedAccount, applyAccounts } from './state.js';
import * as home from './screens/home.js';
import * as instances from './screens/instances.js';
import * as mods from './screens/mods.js';
import * as accounts from './screens/accounts.js';
import * as settings from './screens/settings.js';

const SCREENS = [
  { id: 'home', label: 'Inicio', icon: icons.home, mod: home },
  { id: 'instances', label: 'Instancias', icon: icons.layers, mod: instances },
  { id: 'mods', label: 'Mods', icon: icons.puzzle, mod: mods },
  { id: 'accounts', label: 'Cuentas', icon: icons.user, mod: accounts },
  { id: 'settings', label: 'Ajustes', icon: icons.settings, mod: settings }
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = null, cleanup = null, ticket = 0, indReady = false;

// ---------- navegación con transición (fade + desplazamiento corto) ----------
export async function go(id, params) {
  const s = SCREENS.find(x => x.id === id);
  if (!s) return;
  const mine = ++ticket;
  const old = view.querySelector('.screen');
  if (old) { old.classList.add('leaving'); await new Promise(r => setTimeout(r, 150)); }
  if (mine !== ticket) return; // el usuario ya pidió otra pantalla
  cleanup?.();
  current = id;
  clear(view);
  view.scrollTop = 0;
  const page = h('div', { class: 'screen' });
  view.append(page);
  cleanup = s.mod.render(page, params) || null;
  paintNav();
}
window.addEventListener('sugar:go', e => go(e.detail.id, e.detail.params));

// ---------- barra lateral con indicador que se desliza ----------
function buildNav() {
  clear(nav).append(h('div', { class: 'nav-ind', id: 'nav-ind' }),
    ...SCREENS.map(s => h('button', { class: 'nav-item', 'data-id': s.id, onclick: () => go(s.id) }, h('span', { class: 'ic', html: s.icon }), h('span', {}, s.label))));
}
function paintNav() {
  const ind = document.getElementById('nav-ind');
  let active = null;
  for (const b of nav.querySelectorAll('.nav-item')) { const on = b.dataset.id === current; b.classList.toggle('active', on); if (on) active = b; }
  if (!active || !ind) return;
  if (!indReady) { ind.style.transition = 'none'; }
  ind.style.setProperty('--y', `${active.offsetTop}px`);
  ind.style.setProperty('--h', `${active.offsetHeight}px`);
  if (!indReady) { ind.getBoundingClientRect(); ind.style.transition = ''; indReady = true; }
}

function renderSideAccount() {
  const box = document.getElementById('side-account');
  const acc = selectedAccount();
  clear(box).append(h('button', { class: 'side-acc', onclick: () => go('accounts'), title: 'Cambiar de cuenta' },
    avatar(acc, 32),
    h('div', { class: 'side-acc-txt' },
      h('b', {}, acc ? acc.name : 'Sin cuenta'),
      h('small', {}, acc ? (acc.type === 'microsoft' ? 'Microsoft' : 'Offline') : 'Inicia sesión'))));
}

// ---------- barra de título ----------
document.getElementById('brand-ic').innerHTML = icons.cube;
document.getElementById('w-min').innerHTML = icons.minus;
document.getElementById('w-max').innerHTML = icons.square;
document.getElementById('w-close').innerHTML = icons.x;
document.getElementById('w-min').onclick = () => api.win('min');
document.getElementById('w-max').onclick = () => api.win('max');
document.getElementById('w-close').onclick = () => api.win('close');
document.querySelector('.titlebar').addEventListener('dblclick', e => { if (!e.target.closest('button')) api.win('max'); });
api.on('maximized', m => document.body.classList.toggle('maximized', m));

// ---------- eventos del proceso principal ----------
api.on('horizon', s => { state.horizon = s; emit('horizon', s); });
api.on('status', s => { state.progress = s; emit('status', s); });
api.on('log', t => {
  for (const line of String(t).split('\n')) if (line.trim()) state.logs.push(line);
  if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
  emit('log', t);
});
api.on('game-closed', code => {
  state.busy = false; state.playing = false;
  emit('game-closed', code);
  // 143/137/130 = el usuario pulsó «Detener» o cerró el juego a la fuerza: no es un fallo
  if (code && ![143, 137, 130].includes(code)) toast(`Minecraft se cerró con un error (código ${code}). Revisa los logs.`, 'err', 7000);
});
on('accounts', renderSideAccount);

// ---------- arranque ----------
(async function boot() {
  buildNav();
  try {
    const d = await api.init();
    Object.assign(state, { intro: d.intro, instances: d.instances, settings: d.settings, totalRam: d.totalRam, icons: d.icons, platform: d.platform, version: d.version, dataDir: d.dataDir, appName: d.appName });
    document.getElementById('brand-name').textContent = d.appName || 'Cubic';
    applyAccounts(d.accounts);
    state.horizon = await api.horizon.state();
  } catch (e) { toastError(e); }
  renderSideAccount();
  go('home');
  document.fonts?.ready.then(paintNav);
})();
