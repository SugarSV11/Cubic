import { h, clear } from '../lib/dom.js';
import { icons } from '../lib/icons.js';
import { toastError } from '../lib/toast.js';
import { avatar, ic, instTile } from '../lib/ui.js';
import { state, on, emit, selectedInstance, selectedAccount, LOADER_NAMES } from '../state.js';
import { openInstanceEditor } from './instances.js';

const go = (id, params) => window.dispatchEvent(new CustomEvent('sugar:go', { detail: { id, params } }));

export function render(root) {
  const offs = [];
  const hero = h('section', { class: 'hero card' });
  const progressText = h('span', { class: 'prog-text' });
  const progressFill = h('div', { class: 'prog-fill' });
  const logBox = h('pre', { class: 'log-box' });
  const logPanel = h('div', { class: 'log-panel' }, h('div', {}, logBox));
  let logsOpen = false;

  const paintProgress = () => {
    const { text, progress } = state.progress;
    const pct = progress != null ? Math.round(progress * 100) : null;
    progressText.textContent = pct != null && pct < 100 ? `${text} ${pct}%` : text;
    const indet = progress == null && state.busy && !state.playing;
    progressFill.classList.toggle('indeterminate', indet);
    progressFill.style.setProperty('--p', progress != null ? String(progress) : '0');
  };
  const paintLogs = () => { logBox.textContent = state.logs.slice(-400).join('\n'); logBox.scrollTop = logBox.scrollHeight; };

  function paint() {
    const inst = selectedInstance();
    const acc = selectedAccount();
    clear(hero);

    if (!inst) {
      hero.append(h('div', { class: 'hero-empty' },
        instTile('cube'),
        h('h2', {}, 'Crea tu primera instancia'),
        h('p', { class: 'muted' }, 'Una instancia es una copia de Minecraft con su propia versión, mods y mundos.'),
        h('button', { class: 'btn primary lg', onclick: () => openInstanceEditor(null, () => paint()) }, ic('plus'), 'Nueva instancia')));
      return;
    }

    const select = h('select', { class: 'select', 'aria-label': 'Instancia', ...(state.busy ? { disabled: true } : {}),
      onchange: async e => { state.settings = await api.setSettings({ selectedInstance: e.target.value }); paint(); } },
      state.instances.map(i => h('option', { value: i.id, ...(i.id === inst.id ? { selected: true } : {}) }, i.name)));

    const loading = state.busy && !state.playing;
    const label = state.playing ? 'JUGANDO' : state.busy ? 'PREPARANDO' : 'JUGAR';
    const playBtn = h('button', { class: `play-btn${loading ? ' busy' : ''}`, ...(state.busy ? { disabled: true } : {}), onclick: play },
      h('span', { class: 'ic', html: loading ? '' : state.playing ? '' : icons.play }), h('span', {}, label));

    hero.append(
      h('div', { class: 'hero-top' },
        h('div', { class: 'hero-inst' },
          instTile(inst.icon, true),
          h('div', {},
            h('small', { class: 'muted' }, 'Instancia'),
            select,
            h('div', { class: 'chips' },
              h('span', { class: 'chip' }, `Minecraft ${inst.version}`),
              h('span', { class: 'chip' }, LOADER_NAMES[inst.loader]),
              h('span', { class: 'chip' }, `${inst.ram} GB RAM`)))),
        h('button', { class: 'acc-chip', onclick: () => go('accounts'), title: 'Cambiar de cuenta' },
          avatar(acc, 32),
          h('div', {}, h('small', {}, 'Jugando como'), h('b', {}, acc ? acc.name : 'Sin cuenta')),
          h('span', { class: 'ic chev', html: icons.chevron }))),
      h('div', { class: 'hero-play' },
        playBtn,
        state.playing ? h('button', { class: 'btn danger lg', onclick: () => api.game.stop() }, ic('stop'), 'Detener') : null),
      h('div', { class: 'progress' },
        h('div', { class: 'prog-top' }, progressText),
        h('div', { class: 'prog-bar' }, progressFill)),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn ghost', onclick: () => api.instances.open(inst.id).catch(toastError) }, ic('folder'), 'Carpeta de la instancia'),
        h('button', { class: 'btn ghost', onclick: () => api.instances.open(inst.id, 'mods').catch(toastError) }, ic('puzzle'), 'Carpeta de mods'),
        h('button', { class: 'btn ghost', onclick: toggleLogs }, ic('terminal'), logsOpen ? 'Ocultar logs' : 'Ver logs')));
    paintProgress();
  }

  function toggleLogs() {
    logsOpen = !logsOpen;
    logPanel.classList.toggle('open', logsOpen);
    if (logsOpen) paintLogs();
    paint();
  }

  async function play() {
    const inst = selectedInstance(), acc = selectedAccount();
    if (!acc) { toastError(new Error('Primero agrega una cuenta')); return go('accounts'); }
    state.busy = true; state.logs.length = 0; paint();
    try {
      await api.game.launch({ instanceId: inst.id, accountId: acc.id });
      if (state.busy) state.playing = true; // si ya se cerró, no marcarlo como jugando
    } catch (e) { state.busy = false; toastError(e); }
    emit('game-state'); // repinta la pantalla de Inicio que esté visible ahora
  }

  offs.push(on('status', paintProgress));
  offs.push(on('log', () => { if (logsOpen) paintLogs(); }));
  offs.push(on('game-closed', paint));
  offs.push(on('game-state', paint));
  offs.push(on('instances', paint));
  offs.push(on('accounts', paint));

  root.append(
    h('div', { class: 'greeting' }, h('h1', {}, 'Inicio'), h('p', { class: 'muted' }, 'Elige una instancia y pulsa jugar.')),
    hero, logPanel);
  paint();
  return () => offs.forEach(f => f());
}
