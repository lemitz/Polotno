/* Полотно: поиск по холсту (Ctrl+F). Карточки, подписи связей, названия групп; по желанию во всех полотнах. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const { $, esc } = api;

  const css = document.createElement('style');
  css.textContent = `
#sr { top: 58px; left: 50%; transform: translateX(-50%); width: 560px; max-width: calc(100% - 24px); padding: 10px; display: grid; gap: 8px; }
#sr .top { display: flex; gap: 8px; align-items: center; }
#sr .cnt { font: 500 12px/1 var(--mono); color: var(--mute); white-space: nowrap; min-width: 64px; text-align: right; }
#sr .res { max-height: min(52vh, 460px); overflow: auto; display: grid; gap: 2px; }
#sr .res:empty { display: none; }
#sr .it { display: grid; grid-template-columns: 10px 1fr auto; gap: 4px 10px; align-items: baseline; padding: 8px 10px; border-radius: 9px; cursor: pointer; }
#sr .it:hover, #sr .it.on { background: rgba(245,245,240,.07); }
#sr .it.on { box-shadow: inset 2px 0 0 var(--acid); }
#sr .it i { width: 8px; height: 8px; border-radius: 3px; align-self: center; }
#sr .it b { font-weight: 600; color: var(--paper); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sr .it .k { font: 500 11px/1 var(--mono); letter-spacing: .05em; text-transform: uppercase; color: var(--mute); }
#sr .it .s { grid-column: 2 / 4; font-size: 13px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sr .grp { padding: 8px 10px 4px; font: 500 12px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--mute); }
#sr .opt { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dim); cursor: pointer; user-select: none; }
#sr .opt input { accent-color: #B7FF00; }
`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'sr'; box.className = 'panel'; box.hidden = true;
  box.innerHTML = '<div class="top"><input class="pin" placeholder="Искать на полотне" spellcheck="false"><span class="cnt"></span>'
    + '<button class="c-act" style="opacity:1" data-x aria-label="Закрыть">' + api.ICON.x + '</button></div>'
    + '<label class="opt"><input type="checkbox"> во всех полотнах</label><div class="res"></div>';
  document.body.appendChild(box);
  const inp = $('input.pin', box), cnt = $('.cnt', box), res = $('.res', box), all = $('.opt input', box);

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const cardText = c => [c.title, c.type === 'text' || c.type === 'markdown' ? c.content : '', c.type === 'link' ? c.content : '', c.filename,
    c.preview && c.preview.title, c.preview && c.preview.description].filter(Boolean).join('\n');
  function snippet(text, q) {
    const t = String(text || '').replace(/\s+/g, ' '), i = q ? norm(t).indexOf(q) : -1;
    if (i < 0) return esc(t.slice(0, 120));
    const a = Math.max(0, i - 40), part = t.slice(a, i + q.length + 80);
    const j = i - a;
    return (a ? '…' : '') + esc(part.slice(0, j)) + '<mark>' + esc(part.slice(j, j + q.length)) + '</mark>' + esc(part.slice(j + q.length));
  }
  function searchProject(p, q) {
    const out = [];
    for (const c of p.cards) {
      const t = cardText(c);
      if (norm(t).includes(q)) out.push({ kind: 'card', p, c, title: c.title || api.TYPES[c.type].label, color: api.TCOL[c.type], label: api.TYPES[c.type].label,
        snip: norm(c.title).includes(q) ? snippet(c.type === 'text' || c.type === 'markdown' ? c.content : c.filename || c.content, '') : snippet(t, q), score: norm(c.title).includes(q) ? 0 : 1 });
    }
    for (const e of p.edges) if (e.label && norm(e.label).includes(q)) {
      const a = p.cards.find(c => c.id === e.from), b = p.cards.find(c => c.id === e.to);
      out.push({ kind: 'edge', p, e, title: e.label, color: '#F5F5F0', label: 'Связь', snip: esc((a ? a.title : '?') + ' → ' + (b ? b.title : '?')), score: 2 });
    }
    for (const g of p.groups || []) if (g.title && norm(g.title).includes(q)) out.push({ kind: 'group', p, g, title: g.title, color: '#B7FF00', label: 'Группа', snip: '', score: 0.5 });
    return out.sort((x, y) => x.score - y.score);
  }

  let hits = [], cur = -1, loadedAll = false;
  async function run() {
    const q = norm(inp.value.trim());
    for (const id of [...hitIds]) { const el = api.cardEls.get(id); if (el) el.classList.remove('hit'); }
    hitIds.clear();
    if (!q) { hits = []; cur = -1; res.innerHTML = ''; cnt.textContent = ''; return; }
    if (all.checked && !loadedAll) { await api.fullWorkspace(); loadedAll = true; }
    const P = api.P;
    hits = searchProject(P, q);
    const other = [];
    if (all.checked) for (const p of api.S.projects) if (p.id !== P.id) other.push(...searchProject(p, q));
    for (const h of hits) if (h.kind === 'card') { hitIds.add(h.c.id); const el = api.cardEls.get(h.c.id); if (el) el.classList.add('hit'); }
    const list = hits.concat(other).slice(0, 80);
    cnt.textContent = hits.length + (other.length ? ' + ' + other.length : '');
    res.innerHTML = '';
    let lastP = P.id;
    list.forEach((h, i) => {
      if (h.p.id !== lastP) { lastP = h.p.id; const g = document.createElement('div'); g.className = 'grp'; g.textContent = h.p.name; res.appendChild(g); }
      const it = document.createElement('div'); it.className = 'it'; it.dataset.i = i;
      it.innerHTML = '<i style="background:' + h.color + '"></i><b></b><span class="k"></span>' + (h.snip ? '<span class="s">' + h.snip + '</span>' : '');
      it.querySelector('b').textContent = h.title; it.querySelector('.k').textContent = h.label;
      it.addEventListener('click', () => go(i));
      res.appendChild(it);
    });
    shown = list; cur = list.length ? 0 : -1; gone = -1; mark();
    api.needDraw();
  }
  let shown = [], gone = -1;
  const hitIds = new Set();
  api.searchHits = hitIds;
  function mark() {
    res.querySelectorAll('.it').forEach(el => el.classList.toggle('on', +el.dataset.i === cur));
    const el = res.querySelector('.it.on'); if (el) el.scrollIntoView({ block: 'nearest' });
  }
  async function go(i) {
    const h = shown[i]; if (!h) return;
    cur = i; mark();
    if (h.p.id !== api.P.id) { if (!(await api.openProject(h.p.id))) return; await run(); }
    const P = api.P;
    if (h.kind === 'card') { const c = P.cards.find(x => x.id === h.c.id); if (c) { api.setSel([c.id]); api.flyTo(c); flash(c.id); } }
    else if (h.kind === 'edge') { const e = P.edges.find(x => x.id === h.e.id); const a = e && api.cardMap.get(e.from); if (a) { api.setSel([], e.id); api.flyTo(a); } }
    else if (h.kind === 'group') { const ms = api.gMembers.get(h.g.id) || []; if (ms.length) { api.setSel(ms.map(m => m.id), null, h.g.id); api.fit(ms); } }
  }
  function flash(id) { const el = api.cardEls.get(id); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  let t = 0;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 90); });
  all.addEventListener('change', run);
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { cur = (cur + 1) % shown.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { cur = (cur - 1 + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Enter') {
      // первый Enter к текущему результату, следующие — к следующему (Shift — к предыдущему)
      e.preventDefault(); if (!shown.length) return;
      if (gone === cur) cur = (cur + (e.shiftKey ? -1 : 1) + shown.length) % shown.length;
      gone = cur; go(cur);
    }
  });
  $('[data-x]', box).addEventListener('click', close);
  function open() { box.hidden = false; inp.focus(); inp.select(); if (inp.value) run(); }
  function close() {
    box.hidden = true;
    for (const id of hitIds) { const el = api.cardEls.get(id); if (el) el.classList.remove('hit'); }
    hitIds.clear(); api.needDraw();
  }
  api.on('render', () => { if (!box.hidden && inp.value) run(); });
  api.on('change', () => { loadedAll = false; });

  api.addTool({ id: 'searchBtn', tip: 'Поиск (Ctrl+F)', on: () => (box.hidden ? open() : close()),
    icon: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>' });
  api.addKey('Поиск по полотну', '<kbd>Ctrl+F</kbd>');
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !api.dlgOpen()) { e.preventDefault(); open(); }
  }, true);
  api.search = { open, close };
});
