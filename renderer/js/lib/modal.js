import { h } from './dom.js';
import { icons } from './icons.js';

// Abre un modal. content: nodo. Devuelve { close, el }.
export function openModal({ title, content, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Diálogo' },
    h('div', { class: 'modal-head' },
      h('h3', {}, title || ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close(), html: icons.x })),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('div', { class: 'modal-actions' }, actions.map(a =>
      h('button', { class: `btn ${a.kind || ''}`, onclick: async e => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true; // bloqueado mientras trabaja: evita dobles envíos
        let r;
        try { r = await a.onClick?.(btn); } catch (err) { r = false; throw err; }
        finally { if (r === false) btn.disabled = false; }
        if (r !== false) close();
      } }, a.label))) : null);
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } }, box);
  root.append(back);
  requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('in')));
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in');
    setTimeout(() => back.remove(), 300);
    prevFocus?.focus?.();
    onClose?.();
  }
  box.querySelector('input,select,button.btn.primary')?.focus();
  return { close, el: box };
}

export function confirmDialog({ title, message, confirmLabel = 'Aceptar', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    openModal({
      title, content: h('p', { class: 'muted' }, message),
      actions: [
        { label: 'Cancelar', onClick: () => finish(false) },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => finish(true) }
      ],
      onClose: () => finish(false)
    });
  });
}
