/* Полотно: подсказки неочевидных связей на эвристиках, без нейросетей.
   Сходство текстов (TF-IDF по основам слов, русский и английский), общие #теги,
   упоминание названия другой карточки, добавлены почти одновременно, одна группа. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const { $, esc } = api;

  const css = document.createElement('style');
  css.textContent = `
#sg { top: 58px; right: 12px; width: 400px; max-width: calc(100% - 24px); max-height: calc(100% - 230px); display: flex; flex-direction: column; }
#sg .hd { padding: 16px 18px 10px; display: grid; gap: 6px; border-bottom: 1px solid var(--line); }
#sg .ls { overflow: auto; padding: 6px; display: grid; gap: 4px; }
#sg .sg { padding: 10px 10px 10px 12px; border-radius: 10px; display: grid; gap: 6px; }
#sg .sg:hover { background: rgba(245,245,240,.05); }
#sg .sg .tt { display: flex; align-items: center; gap: 8px; }
#sg .sg .tt b { font-weight: 600; color: var(--paper); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
#sg .sg .tt b:hover { color: var(--acid); }
#sg .sg .pair { font-size: 13px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sg .sg .why { font-size: 12px; color: var(--mute); line-height: 1.45; }
#sg .sg .why em { color: var(--dim); font-style: normal; }
#sg .meter { width: 46px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; flex: none; }
#sg .meter i { display: block; height: 100%; background: var(--acid); }
#sg .acts { display: flex; gap: 6px; }
#sg .acts button { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line-2); color: var(--dim); font-size: 12px; font-weight: 500; }
#sg .acts button:hover { border-color: var(--acid); color: var(--acid); }
#sg .acts button.primary { background: var(--acid); border-color: var(--acid); color: var(--ink); font-weight: 700; }
`;
  document.head.appendChild(css);

  const panel = document.createElement('div');
  panel.id = 'sg'; panel.className = 'panel'; panel.hidden = true;
  panel.innerHTML = '<div class="hd"><h4>Возможные связи <button class="c-act" style="opacity:1" data-x aria-label="Закрыть">' + api.ICON.x + '</button></h4><div class="muted" data-sub></div></div><div class="ls"></div>';
  document.body.appendChild(panel);
  const list = $('.ls', panel), sub = $('[data-sub]', panel);

  /* ---------- текст → основы слов ---------- */
  const STOP = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это эта эти весь вся всё свой своя очень просто нужно нужен нужна сразу тоже также либо пока вместо ещё '
    + 'the a an and or but if then of to in on at by for with from as is are was were be been it its this that these those not no yes do does did can could will would should into over under about than so such you your we our they their he she his her i me my').split(/\s+/));
  const RU_END = ['иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ешь', 'ете', 'ите', 'ает', 'яет', 'ует', 'ют', 'ут', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей', 'ом', 'ем', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ия', 'ие', 'ию', 'ии', 'ть', 'ти', 'ет', 'ит', 'ся', 'сь', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й'];
  function stem(w) {
    if (/^[a-z0-9]+$/.test(w)) return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/, '').slice(0, 8);
    for (const e of RU_END) if (w.length - e.length >= 3 && w.endsWith(e)) { w = w.slice(0, -e.length); break; }
    return w.slice(0, 7);
  }
  const words = s => String(s || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) || [];
  const tags = s => new Set((String(s || '').toLowerCase().match(/#[\p{L}\p{N}_-]+/gu) || []));
  function textOf(c) {
    const t = [c.title, c.title];
    if (c.type === 'text' || c.type === 'markdown') t.push(c.content);
    if (c.type === 'link') { t.push(c.preview && c.preview.title, c.preview && c.preview.description); try { t.push(new URL(c.content).hostname.replace(/^www\./, '').split('.')[0]); } catch (_) {} }
    if (c.filename) t.push(c.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    return t.filter(Boolean).join(' ');
  }

  /* ---------- модель полотна: векторы TF-IDF ---------- */
  function model(P) {
    const docs = new Map(), df = new Map();
    for (const c of P.cards) {
      const tf = new Map(), surface = new Map();
      for (const w of words(textOf(c))) {
        if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
        const s = stem(w); tf.set(s, (tf.get(s) || 0) + 1);
        if (!surface.has(s)) surface.set(s, w);
      }
      for (const s of tf.keys()) df.set(s, (df.get(s) || 0) + 1);
      docs.set(c.id, { c, tf, surface, tags: tags(c.title + ' ' + (c.type === 'text' || c.type === 'markdown' ? c.content : '')) });
    }
    const N = P.cards.length || 1;
    for (const d of docs.values()) {
      const v = new Map(); let n2 = 0;
      for (const [s, f] of d.tf) { const w = (1 + Math.log(f)) * Math.log(1 + N / df.get(s)); v.set(s, w); n2 += w * w; }
      d.vec = v; d.norm = Math.sqrt(n2) || 1;
    }
    // обратный индекс: кандидаты только среди карточек с общими основами или тегами
    const inv = new Map();
    for (const d of docs.values()) for (const s of d.vec.keys()) { if (df.get(s) > Math.max(3, N * 0.3)) continue; (inv.get(s) || inv.set(s, []).get(s)).push(d); }
    return { docs, inv, df };
  }
  const titleKey = c => String(c.title || '').toLowerCase().replace(/ё/g, 'е').trim();
  function score(a, b) {
    let dot = 0; const common = [];
    for (const [s, w] of a.vec) { const w2 = b.vec.get(s); if (w2) { dot += w * w2; common.push([w * w2, a.surface.get(s)]); } }
    const cos = dot / (a.norm * b.norm);
    const why = []; let sc = cos;
    if (common.length) why.push('общие слова: <em>' + common.sort((x, y) => y[0] - x[0]).slice(0, 4).map(x => esc(x[1])).join(', ') + '</em>');
    const shared = [...a.tags].filter(t => b.tags.has(t));
    if (shared.length) { sc += 0.3 * shared.length; why.push('теги ' + shared.map(esc).join(' ')); }
    const ta = titleKey(a.c), tb = titleKey(b.c);
    const tx = c => String((c.type === 'text' || c.type === 'markdown') ? c.content : '').toLowerCase().replace(/ё/g, 'е');
    if (tb.length >= 4 && tx(a.c).includes(tb)) { sc += 0.45; why.push('упоминает «' + esc(b.c.title) + '»'); }
    else if (ta.length >= 4 && tx(b.c).includes(ta)) { sc += 0.45; why.push('«' + esc(b.c.title) + '» упоминает эту'); }
    if (a.c.created && b.c.created && Math.abs(a.c.created - b.c.created) < 15 * 60 * 1000) { sc += 0.08; why.push('добавлены почти одновременно'); }
    if (a.c.group && a.c.group === b.c.group) { sc += 0.05; why.push('в одной группе'); }
    return { sc, why };
  }
  const pairKey = (x, y) => x < y ? x + '|' + y : y + '|' + x;
  function linked(P) { const s = new Set(); for (const e of P.edges) s.add(pairKey(e.from, e.to)); return s; }
  const dismissed = P => new Set(P.dismissedLinks || []);
  const MIN = 0.12;

  function forCard(P, M, id) {
    const a = M.docs.get(id); if (!a) return [];
    const L = linked(P), D = dismissed(P), cand = new Set();
    for (const s of a.vec.keys()) for (const d of M.inv.get(s) || []) cand.add(d);
    // упоминания и теги ловим даже без общих слов
    for (const d of M.docs.values()) if (d !== a && ((titleKey(d.c).length >= 4 && (a.c.content || '').toLowerCase().includes(titleKey(d.c))) || [...a.tags].some(t => d.tags.has(t)))) cand.add(d);
    const out = [];
    for (const b of cand) {
      if (b === a || L.has(pairKey(a.c.id, b.c.id)) || D.has(pairKey(a.c.id, b.c.id))) continue;
      const r = score(a, b); if (r.sc >= MIN) out.push({ a: a.c, b: b.c, ...r });
    }
    return out.sort((x, y) => y.sc - x.sc).slice(0, 12);
  }
  function top(P, M) {
    const L = linked(P), D = dismissed(P), seen = new Set(), out = [];
    for (const a of M.docs.values()) {
      const cand = new Set();
      for (const s of a.vec.keys()) for (const d of M.inv.get(s) || []) cand.add(d);
      for (const b of cand) {
        if (b === a) continue;
        const k = pairKey(a.c.id, b.c.id); if (seen.has(k) || L.has(k) || D.has(k)) continue; seen.add(k);
        const r = score(a, b); if (r.sc >= MIN) out.push({ a: a.c, b: b.c, ...r });
      }
    }
    return out.sort((x, y) => y.sc - x.sc).slice(0, 20);
  }

  let M = null, Mfor = null;
  function render() {
    if (panel.hidden) return;
    const P = api.P;
    if (!M || Mfor !== P) { M = model(P); Mfor = P; }
    const one = api.sel.size === 1 ? api.cardMap.get([...api.sel][0]) : null;
    const items = one ? forCard(P, M, one.id) : top(P, M);
    sub.innerHTML = one ? 'Для карточки «' + esc(one.title || 'Без названия') + '». Выдели другую, чтобы сменить.' : 'Лучшие пары на всём полотне. Выдели карточку, чтобы искать для неё.';
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<div class="muted" style="padding:12px">' + (one ? 'Ничего похожего: у карточки мало текста или всё уже связано.' : 'Явных пар нет. Чем больше текста в карточках, тем лучше подсказки.') + '</div>'; return; }
    const max = items[0].sc;
    for (const it of items) {
      const el = document.createElement('div'); el.className = 'sg';
      el.innerHTML = '<div class="tt"><b></b><span class="meter"><i style="width:' + Math.round(Math.min(1, it.sc / Math.max(max, 0.5)) * 100) + '%"></i></span></div>'
        + (one ? '' : '<div class="pair"></div>') + '<div class="why">' + it.why.join(' · ') + '</div>'
        + '<div class="acts"><button class="primary" data-a="ab"></button><button data-a="ba"></button><button data-a="no" title="Больше не предлагать эту пару">Не то</button></div>';
      $('b', el).textContent = one ? (it.b.title || 'Без названия') : (it.a.title || '…') + ' ↔ ' + (it.b.title || '…');
      if (!one) $('.pair', el).textContent = api.TYPES[it.a.type].label + ' и ' + api.TYPES[it.b.type].label;
      $('[data-a="ab"]', el).textContent = one ? 'Связать →' : 'Связать';
      $('[data-a="ba"]', el).textContent = '←';
      $('[data-a="ba"]', el).title = 'Связь в обратную сторону';
      $('b', el).addEventListener('click', () => { const c = api.cardMap.get(it.b.id); if (c) { api.flyTo(c); flash(c.id); } });
      el.addEventListener('mouseenter', () => flash(it.b.id));
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        if (b.dataset.a === 'ab') api.addEdge(it.a.id, it.b.id, false);
        else if (b.dataset.a === 'ba') api.addEdge(it.b.id, it.a.id, false);
        else { (P.dismissedLinks = P.dismissedLinks || []).push(pairKey(it.a.id, it.b.id)); api.touch(); }
        if (one) api.setSel([one.id]);
        render();
      });
      list.appendChild(el);
    }
  }
  function flash(id) { const el = api.cardEls.get(id); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  const toggle = () => { panel.hidden = !panel.hidden; M = null; render(); };
  $('[data-x]', panel).addEventListener('click', () => { panel.hidden = true; });
  let t = 0;
  api.on('select', () => { clearTimeout(t); t = setTimeout(render, 60); });
  api.on('change', () => { M = null; clearTimeout(t); t = setTimeout(render, 300); });
  api.on('project', () => { M = null; render(); });

  api.addTool({ id: 'suggestBtn', tip: 'Подсказать связи (L)', on: toggle,
    icon: '<svg class="i" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>' });
  api.addKey('Подсказать связи', '<kbd>L</kbd>');
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || api.isEditing() || api.dlgOpen() || api.presenting) return;
    if (e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 'д') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
  api.suggest = { model, forCard: (id) => forCard(api.P, model(api.P), id), top: () => top(api.P, model(api.P)), stem };
});
