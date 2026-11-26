import { h, clear } from '../lib/dom.js';
import { toast, toastError } from '../lib/toast.js';
import { openModal, confirmDialog } from '../lib/modal.js';
import { avatar, pageHeader, emptyState, ic } from '../lib/ui.js';
import { icons } from '../lib/icons.js';
import { state, applyAccounts, on, hasMicrosoft } from '../state.js';

export function render(root) {
  const list = h('div', { class: 'acc-list' });
  const head = h('div');

  function paint() {
    clear(head).append(pageHeader('Cuentas', 'Cambia entre tus cuentas de Microsoft y offline.',
      h('button', { class: 'btn primary', onclick: addMicrosoft }, ic('plus'), 'Cuenta Microsoft'),
      h('button', { class: 'btn', ...(hasMicrosoft() ? {} : { disabled: true, title: 'Primero agrega una cuenta de Microsoft con Minecraft comprado' }), onclick: addOffline },
        ic('plus'), 'Cuenta offline')));
    clear(list);
    if (!state.accounts.length) {
      list.append(emptyState('key', 'Aún no tienes cuentas', 'Inicia sesión con tu cuenta de Microsoft (la que tiene Minecraft Java). Después podrás crear cuentas offline.',
        h('button', { class: 'btn primary lg', onclick: addMicrosoft }, 'Iniciar sesión con Microsoft')));
      return;
    }
    state.accounts.forEach((a, i) => {
      const active = a.id === state.selectedAccount;
      list.append(h('div', { class: `acc-card card stagger${active ? ' active' : ''}`, style: { '--i': i } },
        avatar(a, 48),
        h('div', { class: 'acc-info' },
          h('b', {}, a.name),
          h('div', { class: 'chips' },
            h('span', { class: `chip ${a.type === 'microsoft' ? 'ms' : 'off'}` }, a.type === 'microsoft' ? 'Microsoft' : 'Offline'),
            a.expired ? h('span', { class: 'chip warn' }, 'Sesión caducada') : null,
            active ? h('span', { class: 'chip ok' }, ic('check'), 'En uso') : null)),
        h('div', { class: 'row gap' },
          a.expired ? h('button', { class: 'btn', onclick: addMicrosoft }, 'Reiniciar sesión') : null,
          active ? null : h('button', { class: 'btn', onclick: () => choose(a.id) }, 'Usar'),
          h('button', { class: 'icon-btn danger', title: 'Eliminar cuenta', 'aria-label': 'Eliminar cuenta', onclick: () => del(a), html: icons.trash }))));
    });
  }

  const choose = async id => { try { applyAccounts(await api.accounts.select(id)); } catch (e) { toastError(e); } };

  async function addMicrosoft(e) {
    const btn = e?.currentTarget; if (btn) btn.disabled = true;
    try {
      toast('Se abrió la ventana de Microsoft…', 'info');
      applyAccounts(await api.accounts.addMicrosoft());
      toast(`Sesión iniciada como ${state.accounts.find(a => a.id === state.selectedAccount)?.name}`);
    } catch (err) { toastError(err); }
    if (btn) btn.disabled = false;
  }

  function addOffline() {
    const input = h('input', { class: 'input', placeholder: 'Nombre (3 a 16 letras, números o _)', maxlength: 16, autocomplete: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'field-err' });
    const submit = async () => {
      err.textContent = ''; input.classList.remove('bad');
      try { applyAccounts(await api.accounts.addOffline(input.value)); toast(`Cuenta offline “${input.value.trim()}” creada`); return true; }
      catch (e) { err.textContent = e.message; input.classList.add('bad'); input.focus(); return false; }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') modal.el.querySelector('.btn.primary').click(); });
    const modal = openModal({
      title: 'Nueva cuenta offline',
      content: h('div', { class: 'form' },
        h('p', { class: 'muted' }, 'Sirve para jugar sin conexión o en servidores sin verificación. Su UUID se calcula con el mismo método que usa Mojang.'),
        h('div', { class: 'field' }, input, err)),
      actions: [{ label: 'Cancelar' }, { label: 'Crear cuenta', kind: 'primary', onClick: submit }]
    });
  }

  async function del(a) {
    const msg = a.type === 'microsoft' && state.accounts.filter(x => x.type === 'microsoft').length === 1 && state.accounts.some(x => x.type === 'offline')
      ? 'Es tu última cuenta de Microsoft: las cuentas offline también se eliminarán.' : `Se quitará “${a.name}” del launcher.`;
    if (await confirmDialog({ title: 'Eliminar cuenta', message: msg, confirmLabel: 'Eliminar', danger: true })) {
      try { applyAccounts(await api.accounts.remove(a.id)); } catch (e) { toastError(e); }
    }
  }

  root.append(head, list);
  paint();
  return on('accounts', paint);
}
