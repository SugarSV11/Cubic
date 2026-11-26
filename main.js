const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

// aparición escalonada al entrar en pantalla
const io = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .08 });
document.querySelectorAll('.reveal').forEach(el => {
  const i = [...el.parentElement.children].filter(c => c.classList.contains('reveal')).indexOf(el);
  el.style.setProperty('--d', `${Math.min(i, 4) * 90}ms`);
  io.observe(el);
});

// la captura principal empieza inclinada y se endereza al bajar
const stage = document.getElementById('stage'), hero = stage.firstElementChild;
function straighten() {
  const p = Math.min(1, Math.max(0, (innerHeight - stage.getBoundingClientRect().top) / (innerHeight * .75)));
  hero.style.setProperty('--tilt', `${(1 - p) * 16}deg`);
  hero.style.setProperty('--scale', `${.93 + p * .07}`);
}
if (!calm) { addEventListener('scroll', straighten, { passive: true }); addEventListener('resize', straighten); straighten(); }

// pestañas de la sección de mods (cambian solas hasta que se toca una)
const tabs = [...document.querySelectorAll('[role="tab"]')];
const shots = [...document.querySelectorAll('.swap img')];
const ind = document.querySelector('.tab-ind');
let cur = 0;
function show(n) {
  cur = n;
  tabs.forEach((t, i) => t.setAttribute('aria-selected', i === n));
  shots.forEach((s, i) => s.classList.toggle('on', i === n));
  ind.style.transform = `translateX(${n * 100}%)`;
}
const auto = calm ? 0 : setInterval(() => show((cur + 1) % shots.length), 5000);
tabs.forEach((t, i) => t.addEventListener('click', () => { clearInterval(auto); show(i); }));

// ampliar capturas
const zoom = document.getElementById('zoom');
document.querySelectorAll('.shot').forEach(fig => fig.addEventListener('click', () => {
  const img = fig.querySelector('img.on') || fig.querySelector('img');
  zoom.firstElementChild.src = img.src;
  zoom.firstElementChild.alt = img.alt;
  zoom.showModal();
}));
zoom.addEventListener('click', () => zoom.close());

// copiar el comando
const copy = document.querySelector('[data-copy]');
copy.addEventListener('click', async () => {
  const label = copy.querySelector('span');
  try { await navigator.clipboard.writeText(copy.dataset.copy); label.textContent = 'Copiado'; }
  catch { label.textContent = 'Selecciónalo y copia'; }
  setTimeout(() => { label.textContent = 'Copiar'; }, 1800);
});

// cubo de alambre en 3D: cubo exterior, cubo interior y partículas en órbita
const canvas = document.getElementById('cube'), ctx = canvas.getContext('2d');
let size = 0, mx = 0, my = 0, tx = 0, ty = 0, visible = true, frame = 0;
const V = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
const E = [];
V.forEach((a, i) => V.forEach((b, j) => { if (i < j && a.filter((c, k) => c !== b[k]).length === 1) E.push([i, j]); }));
const dots = Array.from({ length: 70 }, (_, i) => ({ a: i * 2.399963, r: 1.9 + (i % 7) * .13, y: Math.sin(i * 12.9898) * 1.5, s: .08 + (i % 5) * .02 }));

function resize() {
  size = canvas.clientWidth;
  const d = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.height = size * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
function project([x, y, z], ay, ax) {
  const x1 = x * Math.cos(ay) - z * Math.sin(ay), z1 = x * Math.sin(ay) + z * Math.cos(ay);
  const y1 = y * Math.cos(ax) - z1 * Math.sin(ax), z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
  const k = 5 / (5 + z2);
  return [size / 2 + x1 * k * size * .215, size / 2 + y1 * k * size * .215, z2];
}
function wire(scale, ay, ax, color, nodes) {
  const p = V.map(v => project(v.map(c => c * scale), ay, ax));
  for (const [i, j] of E) {
    ctx.strokeStyle = `rgba(${color},${.55 - (p[i][2] + p[j][2]) * .13})`;
    ctx.beginPath(); ctx.moveTo(p[i][0], p[i][1]); ctx.lineTo(p[j][0], p[j][1]); ctx.stroke();
  }
  if (nodes) for (const [x, y] of p) { ctx.fillStyle = `rgb(${color})`; ctx.fillRect(x - 2, y - 2, 4, 4); }
}
function draw(ms) {
  const t = ms / 1000;
  mx += (tx - mx) * .05; my += (ty - my) * .05;
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 1;
  for (const d of dots) {
    const a = d.a + t * d.s;
    const [x, y, z] = project([Math.cos(a) * d.r, d.y, Math.sin(a) * d.r], mx * .4, .35 + my * .3);
    ctx.fillStyle = `rgba(181,186,196,${Math.max(.05, .3 - z * .1)})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  wire(1.15, t * .22 + mx, .52 + my, '232,234,238', false);
  wire(.55, -t * .38 + mx, .52 - Math.sin(t * .3) * .25 + my, '139,92,246', true);
}
function loop(ms) { draw(ms); frame = visible && !calm ? requestAnimationFrame(loop) : 0; }
resize();
addEventListener('resize', () => { resize(); if (!frame) draw(0); });
addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - .5) * .8; ty = (e.clientY / innerHeight - .5) * .5; }, { passive: true });
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !frame) frame = requestAnimationFrame(loop); }).observe(canvas);
if (calm) draw(0);
