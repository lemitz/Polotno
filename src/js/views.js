/* Полотно: другие виды того же полотна — список, таймлайн, граф. Холст они не заменяют:
   клик по карточке в любом виде возвращает на холст к ней. Shift+1…4 переключают виды. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const { $, esc } = api;

  const css = document.createElement('style');
  css.textContent = `
#vw { position: fixed; z-index: 45; left: 0; right: 0; bottom: 0; top: 0; background: var(--ink); display: none; padding: 72px 24px 24px; }
#vw.on { display: block; }
#vw .wrap { height: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
#vw.graph .wrap { max-width: none; }
#vw .vh { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#vw .vh h3 { font: 700 22px/1.2 var(--sans); letter-spacing: -.02em; margin-right: auto; }
#vw .vh .pin { width: 280px; }
#vw .body { flex: 1; min-height: 0; overflow: auto; border-radius: 14px; border: 1px solid var(--line); background: var(--ink-2); }
#vw table { width: 100%; border-collapse: collapse; font-size: 14px; }
#vw th { position: sticky; top: 0; background: var(--ink-3); text-align: left; font: 500 12px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--mute); padding: 12px 14px; cursor: pointer; user-select: none; white-space: nowrap; }
#vw th.s::after { content: " ↓"; color: var(--acid); } #vw th.s.r::after { content: " ↑"; }
#vw td { padding: 10px 14px; border-top: 1px solid var(--line); color: var(--dim); vertical-align: top; }
#vw tr.it { cursor: pointer; } #vw tr.it:hover td { background: rgba(245,245,240,.04); color: var(--paper); }
#vw td.t { color: var(--paper); font-weight: 600; max-width: 420px; }
#vw td.t .sn { display: block; font-weight: 400; color: var(--mute); font-size: 13px; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
#vw .ty { display: inline-flex; align-items: center; gap: 7px; font: 500 12px/1 var(--mono); text-transform: uppercase; letter-spacing: .05em; }
#vw .ty i { width: 8px; height: 8px; border-radius: 3px; }
#vw .num { font: 500 13px/1 var(--mono); white-space: nowrap; }
#vw .tl { padding: 8px 24px 24px; }
#vw .day { position: sticky; top: 0; z-index: 1; padding: 16px 0 8px; background: var(--ink-2); font: 700 15px/1.2 var(--sans); color: var(--paper); }
#vw .day span { font: 500 12px/1 var(--mono); color: var(--mute); margin-left: 8px; }
#vw .ev { position: relative; display: grid; grid-template-columns: 64px 14px 1fr; gap: 10px; padding: 8px 0; cursor: pointer; border-radius: 8px; }
#vw .ev:hover { background: rgba(245,245,240,.04); }
#vw .ev .tm { font: 500 13px/1.4 var(--mono); color: var(--mute); text-align: right; }
#vw .ev .dt { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; box-shadow: 0 0 0 3px var(--ink-2); }
#vw .ev .line { position: absolute; left: 82px; top: 0; bottom: 0; width: 2px; background: var(--line); }
#vw .ev b { color: var(--paper); font-weight: 600; } #vw .ev .sn { display: block; color: var(--dim); font-size: 13px; margin-top: 2px; }
#vw canvas { display: block; width: 100%; height: 100%; cursor: grab; }
#vw .hb { height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--line-2); color: var(--dim); font-weight: 500; font-size: 13px; }
#vw .hb:hover { border-color: var(--acid); color: var(--acid); }
#vw .empty { padding: 40px; text-align: center; color: var(--mute); }
`;
  document.head.appendChild(css);

  const root = document.createElement('div'); root.id = 'vw';
  root.innerHTML = '<div class="wrap"><div class="vh"><h3></h3></div><div class="body"></div></div>';
  document.body.appendChild(root);
  const head = $('.vh', root), body = $('.body', root);

  const VIEWS = [
    { id: 'canvas', label: 'Холст', key: 'Shift+1', icon: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/></svg>' },
    { id: 'list', label: 'Список', key: 'Shift+2', icon: '<svg class="i" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>' },
    { id: 'timeline', label: 'Таймлайн', key: 'Shift+3', icon: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v18M12 7h6M12 12H6M12 17h5"/></svg>' },
    { id: 'graph', label: 'Граф', key: 'Shift+4', icon: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="m8.3 7 7.4.7M7 8.3l2.2 7.4M16.6 10l-5 6.3"/></svg>' }
  ];
  let mode = 'canvas';
  const tool = api.addTool({ id: 'viewBtn', tip: 'Вид: холст, список, таймлайн, граф', icon: VIEWS[0].icon,
    on: b => api.menu(b, [{ lab: 'Вид' }].concat(VIEWS.map(v => ({ label: v.label, icon: v.icon, key: v.key, active: mode === v.id, on: () => setMode(v.id) })))) });

  function setMode(m) {
    if (graph) { graph.stop(); graph = null; }
    mode = m;
    tool.innerHTML = VIEWS.find(v => v.id === m).icon;
    root.className = m === 'canvas' ? '' : 'on ' + m;
    if (m === 'canvas') { body.innerHTML = ''; return; }
    ({ list: renderList, timeline: renderTimeline, graph: renderGraph })[m]();
  }
  function back(c) {
    setMode('canvas');
    if (!c) return;
    const card = api.cardMap.get(c.id); if (!card) return;
    api.setSel([card.id]); api.flyTo(card);
  }
  const snippet = c => {
    const s = c.type === 'text' || c.type === 'markdown' ? c.content : c.type === 'link' ? ((c.preview && c.preview.description) || c.content) : c.filename || '';
    return String(s || '').replace(/[#*`>_]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const typeChip = c => '<span class="ty" style="color:' + api.TCOL[c.type] + '"><i style="background:' + api.TCOL[c.type] + '"></i>' + esc(api.TYPES[c.type].label) + '</span>';
  const groupName = c => { const g = c.group && api.gById(c.group); return g ? (g.title || 'Группа') : ''; };
  const deg = c => { const s = api.incident.get(c.id); let i = 0, o = 0; if (s) for (const e of s) (e.to === c.id ? i++ : o++); return [i, o]; };
  const fmtDate = t => t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const header = (title, extra) => { head.innerHTML = '<h3></h3>' + (extra || '') + '<button class="hb" data-back>Назад к холсту</button>'; $('h3', head).textContent = title; $('[data-back]', head).onclick = () => back(null); };

  /* ---------- список ---------- */
  let sortKey = 'title', sortRev = false, filter = '';
  function renderList() {
    const P = api.P;
    header(P.name + ' · список', '<input class="pin" placeholder="Фильтр" spellcheck="false">');
    const inp = $('.pin', head); inp.value = filter;
    inp.addEventListener('input', () => { filter = inp.value; draw(); });
    inp.addEventListener('keydown', e => e.stopPropagation());
    const cols = [['title', 'Название'], ['type', 'Тип'], ['group', 'Группа'], ['links', 'Связи'], ['created', 'Создано']];
    function draw() {
      const q = filter.toLowerCase().replace(/ё/g, 'е');
      const rows = P.cards.filter(c => !q || (c.title + ' ' + snippet(c)).toLowerCase().replace(/ё/g, 'е').includes(q)).map(c => ({ c, d: deg(c), g: groupName(c) }));
      const val = r => sortKey === 'title' ? (r.c.title || '').toLowerCase() : sortKey === 'type' ? r.c.type : sortKey === 'group' ? r.g.toLowerCase() : sortKey === 'links' ? r.d[0] + r.d[1] : (r.c.created || 0);
      rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortRev ? -1 : 1); });
      if (!rows.length) { body.innerHTML = '<div class="empty">' + (P.cards.length ? 'Ничего не нашлось' : 'Карточек пока нет') + '</div>'; return; }
      body.innerHTML = '<table><thead><tr>' + cols.map(([k, l]) => '<th data-k="' + k + '" class="' + (k === sortKey ? 's' + (sortRev ? ' r' : '') : '') + '">' + l + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map((r, i) => '<tr class="it" data-i="' + i + '"><td class="t">' + esc(r.c.title || 'Без названия') + '<span class="sn">' + esc(snippet(r.c)) + '</span></td><td>' + typeChip(r.c) + '</td><td>' + esc(r.g) + '</td><td class="num" title="входящих · исходящих">' + r.d[0] + ' вх · ' + r.d[1] + ' исх</td><td class="num">' + fmtDate(r.c.created) + '</td></tr>').join('')
        + '</tbody></table>';
      body.querySelectorAll('th').forEach(th => th.onclick = () => { if (sortKey === th.dataset.k) sortRev = !sortRev; else { sortKey = th.dataset.k; sortRev = sortKey === 'created' || sortKey === 'links'; } draw(); });
      body.querySelectorAll('tr.it').forEach(tr => tr.onclick = () => back(rows[+tr.dataset.i].c));
    }
    draw();
  }

  /* ---------- таймлайн ---------- */
  function renderTimeline() {
    const P = api.P;
    header(P.name + ' · таймлайн');
    const dated = P.cards.filter(c => c.created).sort((a, b) => a.created - b.created);
    const undated = P.cards.filter(c => !c.created);
    if (!P.cards.length) { body.innerHTML = '<div class="empty">Карточек пока нет</div>'; return; }
    let html = '<div class="tl">', day = '';
    const all = [];
    for (const c of dated) {
      const d = new Date(c.created), key = d.toDateString();
      if (key !== day) {
        day = key;
        const n = dated.filter(x => new Date(x.created).toDateString() === key).length;
        html += '<div class="day">' + esc(d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '<span>' + n + '</span></div>';
      }
      all.push(c);
      html += ev(c, d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), all.length - 1);
    }
    if (undated.length) {
      html += '<div class="day">Без даты<span>' + undated.length + ' · заготовки и карточки из старых версий</span></div>';
      for (const c of undated) { all.push(c); html += ev(c, '', all.length - 1); }
    }
    body.innerHTML = html + '</div>';
    body.querySelectorAll('.ev').forEach(el => el.onclick = () => back(all[+el.dataset.i]));
    function ev(c, tm, i) {
      return '<div class="ev" data-i="' + i + '"><span class="line"></span><span class="tm">' + tm + '</span><span class="dt" style="background:' + api.TCOL[c.type] + '"></span>'
        + '<span><b>' + esc(c.title || 'Без названия') + '</b> ' + typeChip(c) + '<span class="sn">' + esc(snippet(c)) + '</span></span></div>';
    }
  }

  /* ---------- граф: силовая раскладка на canvas ---------- */
  let graph = null;
  function renderGraph() {
    const P = api.P;
    header(P.name + ' · граф', '<span class="muted">тяни узлы, колесо — зум, клик — к карточке</span><button class="hb" data-apply>Разложить холст так же</button>');
    body.innerHTML = '<canvas></canvas>';
    if (!P.cards.length) { body.innerHTML = '<div class="empty">Карточек пока нет</div>'; return; }
    graph = makeGraph($('canvas', body), P);
    $('[data-apply]', head).onclick = () => graph.apply();
  }
  function makeGraph(cv, P) {
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    let W = 0, H = 0;
    const nodes = P.cards.map(c => ({ c, x: c.x + c.w / 2, y: c.y + api.estH(c) / 2, vx: 0, vy: 0, deg: 0 }));
    const byId = new Map(nodes.map(n => [n.c.id, n]));
    const links = P.edges.map(e => ({ a: byId.get(e.from), b: byId.get(e.to), e })).filter(l => l.a && l.b);
    for (const l of links) { l.a.deg++; l.b.deg++; }
    // стартуем с позиций на холсте, сжатых в облако
    const b = api.bounds(P.cards), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, sc = 600 / Math.max(1, b.x1 - b.x0, b.y1 - b.y0);
    for (const n of nodes) { n.x = (n.x - cx) * sc + (Math.random() - .5); n.y = (n.y - cy) * sc + (Math.random() - .5); }
    const R = n => 7 + Math.min(14, n.deg * 2.2);
    let alpha = 1, raf = 0, cam = { x: 0, y: 0, s: 1 }, dragN = null, panning = null, moved = false, hover = null;
    function resize() { const r = cv.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; if (!moved && nodes) fitCam(); }
    function stepSim() {
      const n = nodes.length, k = 90;
      // отталкивание: для больших графов через сетку, чтобы не O(n²)
      if (n <= 700) {
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push(nodes[i], nodes[j]);
      } else {
        const cell = 220, grid = new Map();
        for (const p of nodes) { const key = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); (grid.get(key) || grid.set(key, []).get(key)).push(p); }
        for (const p of nodes) {
          const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = grid.get((gx + dx) + ',' + (gy + dy)); if (l) for (const q of l) if (q !== p && q.c.id > p.c.id) push(p, q); }
        }
      }
      function push(p, q) {
        let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 250000) return;
        const f = (k * k) / d2 * alpha * 0.6, d = Math.sqrt(d2);
        dx /= d; dy /= d; p.vx -= dx * f; p.vy -= dy * f; q.vx += dx * f; q.vy += dy * f;
      }
      for (const l of links) {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - k) * 0.04 * alpha;
        l.a.vx += dx / d * f; l.a.vy += dy / d * f; l.b.vx -= dx / d * f; l.b.vy -= dy / d * f;
      }
      for (const p of nodes) {
        p.vx -= p.x * 0.002 * alpha; p.vy -= p.y * 0.002 * alpha;
        if (p === dragN) { p.vx = p.vy = 0; continue; }
        p.vx *= 0.6; p.vy *= 0.6; p.x += Math.max(-30, Math.min(30, p.vx)); p.y += Math.max(-30, Math.min(30, p.vy));
      }
      alpha = Math.max(0.02, alpha * 0.985);
    }
    function fitCam() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of nodes) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      cam.s = Math.min(2, (W - 120) / Math.max(1, x1 - x0), (H - 120) / Math.max(1, y1 - y0));
      cam.x = W / 2 - (x0 + x1) / 2 * cam.s; cam.y = H / 2 - (y0 + y1) / 2 * cam.s;
    }
    const sx = x => x * cam.s + cam.x, sy = y => y * cam.s + cam.y;
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#292929'; ctx.fillRect(0, 0, W, H);
      const sel = hover;
      const near = new Set(); if (sel) for (const l of links) { if (l.a === sel) near.add(l.b); if (l.b === sel) near.add(l.a); }
      for (const l of links) {
        const on = sel && (l.a === sel || l.b === sel);
        ctx.strokeStyle = on ? '#B7FF00' : 'rgba(245,245,240,.22)'; ctx.lineWidth = on ? 2 : 1.2;
        const x0 = sx(l.a.x), y0 = sy(l.a.y), x1 = sx(l.b.x), y1 = sy(l.b.y);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // наконечник у края узла
        const a = Math.atan2(y1 - y0, x1 - x0), r = R(l.b) * Math.sqrt(cam.s) + 2, ex = x1 - Math.cos(a) * r, ey = y1 - Math.sin(a) * r;
        ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - .45) * 9, ey - Math.sin(a - .45) * 9); ctx.lineTo(ex - Math.cos(a + .45) * 9, ey - Math.sin(a + .45) * 9); ctx.fill();
      }
      ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const p of nodes) {
        const x = sx(p.x), y = sy(p.y), r = R(p) * Math.sqrt(cam.s);
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
        const dim = sel && p !== sel && !near.has(p);
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = api.TCOL[p.c.type]; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        if (p === sel) { ctx.strokeStyle = '#B7FF00'; ctx.lineWidth = 3; ctx.stroke(); }
        if (cam.s > 0.45 || p === sel || near.has(p) || p.deg > 3) {
          const t = (p.c.title || api.TYPES[p.c.type].label); const s = t.length > 28 ? t.slice(0, 27) + '…' : t;
          ctx.fillStyle = p === sel ? '#F5F5F0' : 'rgba(245,245,240,.78)'; ctx.fillText(s, x, y + r + 4);
        }
        ctx.globalAlpha = 1;
      }
    }
    let ticks = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      if (alpha > 0.021 || dragN) { stepSim(); if (ticks++ < 160 && !moved) fitCam(); }
      draw();
    }
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - cam.x) / cam.s, y: (e.clientY - r.top - cam.y) / cam.s, px: e.clientX, py: e.clientY }; };
    const pick = p => { let best = null, bd = Infinity; for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y), r = R(n) / Math.sqrt(cam.s) + 4; if (d < r && d < bd) { best = n; bd = d; } } return best; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const p = at(e), n = pick(p); moved = false;
      if (n) { dragN = n; alpha = Math.max(alpha, 0.3); } else panning = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      dragStart = { x: e.clientX, y: e.clientY };
    });
    let dragStart = null;
    cv.addEventListener('pointermove', e => {
      const p = at(e);
      if (dragStart && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 3) moved = true;
      if (dragN) { dragN.x = p.x; dragN.y = p.y; }
      else if (panning) { cam.x = panning.cx + e.clientX - panning.x; cam.y = panning.cy + e.clientY - panning.y; }
      else { const n = pick(p); if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; } }
    });
    cv.addEventListener('pointerup', () => {
      if (dragN && !moved) { const c = dragN.c; dragN = null; back(c); return; }
      dragN = null; panning = null; dragStart = null;
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); moved = true;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.max(0.05, Math.min(5, cam.s * f)), k = ns / cam.s;
      cam.x = mx - (mx - cam.x) * k; cam.y = my - (my - cam.y) * k; cam.s = ns;
    }, { passive: false });
    const ro = new ResizeObserver(() => resize()); ro.observe(cv);
    resize(); loop();
    return {
      stop() { cancelAnimationFrame(raf); ro.disconnect(); },
      // перенести раскладку графа на холст (с отменой через Ctrl+Z)
      apply() {
        api.checkpoint();
        const sp = 2.6;
        for (const n of nodes) { const c = api.cardMap.get(n.c.id); if (!c) continue; c.x = Math.round(n.x * sp - c.w / 2); c.y = Math.round(n.y * sp - api.estH(c) / 2); }
        api.renderAll(); api.touch(); back(null); api.fit(null);
        api.toast('Холст разложен как граф', 'Вернуть', api.undo);
      }
    };
  }

  api.on('project', () => { if (mode !== 'canvas') setMode(mode); });
  addEventListener('keydown', e => {
    if (api.isEditing() || api.dlgOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); setMode(VIEWS[+e.code.slice(5) - 1].id); return; }
    if (e.key === 'Escape' && mode !== 'canvas') { e.preventDefault(); e.stopImmediatePropagation(); setMode('canvas'); }
  }, true);
  api.addKey('Холст / список / таймлайн / граф', '<kbd>Shift+1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd>');
  api.views = { setMode, get mode() { return mode; } };
});
