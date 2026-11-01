/* Полотно: режим презентации. Маршрут по связям, как по слайдам: от выделенной карточки (или от корня)
   обход в глубину, сначала по исходящим связям, потом по входящим. Полный экран, ← → листать, Esc выход. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const { $, esc } = api;

  const css = document.createElement('style');
  css.textContent = `
body.presenting #bar, body.presenting #mmwrap, body.presenting #hint, body.presenting #keys, body.presenting .panel:not(#pr) { display: none !important; }
body.presenting .card { transition: opacity .35s var(--ease); }
body.presenting .card:not(.pcur) { opacity: .16; }
body.presenting .edge { opacity: .22; }
body.presenting .edge.pcur { opacity: 1; }
body.presenting .edge.pcur .e-line { stroke: var(--acid); }
body.presenting .edge.pcur .e-arrow { fill: var(--acid); }
body.presenting .elabel { opacity: .25; }
body.presenting .elabel.pcur { opacity: 1; border-color: var(--acid); color: var(--paper); }
body.presenting .card .port, body.presenting .card .c-rs, body.presenting .card .c-acts { display: none; }
body.presenting .card.pcur::after { opacity: 0; }
body.presenting #viewport { cursor: default; }
#pr { left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; max-width: calc(100% - 24px); }
#pr .n { font: 600 13px/1 var(--mono); color: var(--acid); white-space: nowrap; }
#pr .cap { color: var(--dim); font-size: 14px; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#pr .cap b { color: var(--paper); font-weight: 600; }
#pr .bar { position: absolute; left: 12px; right: 12px; top: 0; height: 2px; border-radius: 2px; background: var(--line); overflow: hidden; }
#pr .bar i { display: block; height: 100%; background: var(--acid); transition: width .3s var(--ease); }
`;
  document.head.appendChild(css);

  const hud = document.createElement('div');
  hud.id = 'pr'; hud.className = 'panel'; hud.hidden = true;
  const btn = (a, label, path) => '<button class="btn" data-a="' + a + '" aria-label="' + label + '" title="' + label + '"><svg class="i" viewBox="0 0 24 24">' + path + '</svg></button>';
  hud.innerHTML = '<div class="bar"><i></i></div><span class="n"></span><span class="cap"></span>'
    + btn('prev', 'Назад (←)', '<path d="m15 18-6-6 6-6"/>') + btn('next', 'Дальше (→, пробел)', '<path d="m9 18 6-6-6-6"/>') + btn('exit', 'Выйти (Esc)', '<path d="M6 6l12 12M18 6 6 18"/>');
  document.body.appendChild(hud);

  let route = [], step = -1, on = false, wasFull = false;

  // маршрут: обход в глубину по связям; несвязанные куски идут следом, каждый от своего корня
  function buildRoute(P, startId) {
    const out = new Map(), inn = new Map();
    for (const c of P.cards) { out.set(c.id, []); inn.set(c.id, []); }
    for (const e of P.edges) { if (out.has(e.from) && inn.has(e.to)) { out.get(e.from).push(e); inn.get(e.to).push(e); } }
    const byId = new Map(P.cards.map(c => [c.id, c]));
    const order = (a, b) => (a.y - b.y) || (a.x - b.x);
    const readOrder = (a, b) => (a.x - b.x) || (a.y - b.y);
    const seen = new Set(), steps = [];
    const visit = (id, via) => {
      const stack = [[id, via]];
      while (stack.length) {
        const [cid, v] = stack.pop();
        if (seen.has(cid)) continue;
        seen.add(cid); steps.push({ c: byId.get(cid), via: v });
        const outs = out.get(cid).map(e => ({ id: e.to, e, dir: 1 })).filter(x => !seen.has(x.id)).sort((x, y) => readOrder(byId.get(x.id), byId.get(y.id)));
        const ins = inn.get(cid).map(e => ({ id: e.from, e, dir: -1 })).filter(x => !seen.has(x.id)).sort((x, y) => order(byId.get(x.id), byId.get(y.id)));
        // в стек в обратном порядке, чтобы первыми шли исходящие
        for (const n of ins.concat(outs).reverse()) stack.push([n.id, n]);
      }
    };
    const roots = P.cards.filter(c => !inn.get(c.id).length && out.get(c.id).length).sort(order);
    if (startId && byId.has(startId)) visit(startId, null);
    for (const r of roots) visit(r.id, null);
    for (const c of [...P.cards].sort(order)) visit(c.id, null);
    return steps;
  }

  function clearMarks() {
    document.querySelectorAll('.pcur').forEach(el => el.classList.remove('pcur'));
  }
  function show(i) {
    if (!route.length) return;
    step = Math.max(0, Math.min(route.length - 1, i));
    const { c, via } = route[step];
    clearMarks();
    const el = api.cardEls.get(c.id); if (el) el.classList.add('pcur');
    if (via) { const o = api.edgeEls.get(via.e.id); if (o) { o.g.classList.add('pcur'); o.lab.classList.add('pcur'); } }
    // карточка крупно, но целиком: 60% ширины и 70% высоты экрана, не больше 2.2×
    const h = api.estH(c), s = Math.min(2.2, (api.vw * 0.6) / c.w, (api.vh * 0.7) / h);
    api.jump(api.vw / 2 - (c.x + c.w / 2) * s, api.vh / 2 - (c.y + h / 2) * s, s);
    $('.n', hud).textContent = (step + 1) + ' / ' + route.length;
    let cap = '<b>' + esc(c.title || api.TYPES[c.type].label) + '</b>';
    if (via) {
      const prev = api.cardMap.get(via.dir > 0 ? via.e.from : via.e.to);
      const rel = via.e.label ? ' · ' + esc(via.e.label) : '';
      cap += via.dir > 0 ? ' <span class="muted">← из «' + esc(prev ? prev.title : '') + '»' + rel + '</span>'
        : ' <span class="muted">→ ведёт к «' + esc(prev ? prev.title : '') + '»' + rel + '</span>';
    }
    $('.cap', hud).innerHTML = cap;
    $('.bar i', hud).style.width = ((step + 1) / route.length * 100) + '%';
  }
  async function setFull(v) {
    try {
      if (api.DESK) { const w = api.TAURI.window.getCurrentWindow(); if (v) wasFull = await w.isFullscreen(); if (!wasFull) await w.setFullscreen(v); }
      else if (v && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!v && document.fullscreenElement) await document.exitFullscreen();
    } catch (_) {}
  }
  function start() {
    const P = api.P;
    if (!P.cards.length) { api.toast('Пустое полотно, показывать нечего'); return; }
    const first = api.sel.size === 1 ? [...api.sel][0] : null;
    route = buildRoute(P, first);
    on = true; api.closeMenu(); api.hideTip();
    document.body.classList.add('presenting'); hud.hidden = false;
    // WebGL-слой в презентации не нужен: держим обычные карточки
    api.presenting = true; api.fire('lod', api.lod);
    api.setSel([]);
    setFull(true);
    show(0);
  }
  function stop() {
    if (!on) return;
    on = false; api.presenting = false;
    document.body.classList.remove('presenting'); hud.hidden = true; clearMarks();
    setFull(false);
    const cur = route[step]; route = [];
    api.fire('lod', api.lod);
    if (cur) api.setSel([cur.c.id]);
  }
  hud.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'prev') show(step - 1); else if (b.dataset.a === 'next') show(step + 1); else stop();
  });
  // в презентации клавиши холста не работают
  addEventListener('keydown', e => {
    if (!on) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown') show(step + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') show(step - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(route.length - 1);
    else if (k === 'Escape') stop();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  // клик по карточке в презентации — перейти к ней
  api.viewport.addEventListener('click', e => {
    if (!on) return;
    const el = e.target.closest && e.target.closest('.card'); if (!el) return;
    const i = route.findIndex(r => r.c.id === el.dataset.id); if (i >= 0 && i !== step) show(i);
  });
  api.viewport.addEventListener('pointerdown', e => { if (on && !e.target.closest('video,audio,.c-yt,a')) e.stopPropagation(); }, true);
  api.viewport.addEventListener('dblclick', e => { if (on) e.stopPropagation(); }, true);
  document.addEventListener('fullscreenchange', () => { if (on && !api.DESK && !document.fullscreenElement) stop(); });
  // полный экран включается не сразу: когда окно поменяло размер, ставим слайд по центру заново
  let rt = 0;
  addEventListener('resize', () => { if (!on) return; clearTimeout(rt); rt = setTimeout(() => show(step), 60); });

  api.addTool({ id: 'presentBtn', tip: 'Презентация по связям (P)', on: start,
    icon: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8M10 8l4 2-4 2z"/></svg>' });
  api.addKey('Презентация по связям', '<kbd>P</kbd> · <kbd>←</kbd><kbd>→</kbd> · <kbd>Esc</kbd>');
  addEventListener('keydown', e => {
    if (on || e.ctrlKey || e.metaKey || e.altKey || api.isEditing() || api.dlgOpen()) return;
    if (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'з') { e.preventDefault(); start(); }
  });
  api.present = { start, stop, buildRoute };
});
