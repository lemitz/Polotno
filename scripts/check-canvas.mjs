#!/usr/bin/env node
// Проверка полотна для Полотна: формат, раскладка, читаемость на всех масштабах, связи.
// node scripts/check-canvas.mjs file.polotno [--json]
// Понимает .polotno (zip или JSON) и .json. Без зависимостей, Node 18+.
// Код выхода: 0 — ошибок нет (предупреждения могут быть), 1 — есть ошибки, 2 — файл не читается.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const TYPES = ['text', 'markdown', 'link', 'image', 'video', 'audio', 'youtube', 'file', 'pdf'];
const ID = /^[\w-]{1,64}$/;
const GPAD = 28;                 // отступ рамки группы от карточек
const TAB = 46;                  // ярлычок группы над рамкой (30 + 8 отступ + запас)
const GAP = 24;                  // минимальный зазор между карточками
const GROUP_GAP = 48;            // минимальный зазор между рамками групп (с ярлычком)

/* ---------- чтение ---------- */
function unzip(buf) {
  // центральный каталог: ищем конец (EOCD) с конца файла
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('битый zip');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28), start = off + 30 + lnlen + lelen;
    files[name] = { method, data: buf.subarray(start, start + csize) };
    p += 46 + nlen + elen + clen;
  }
  return files;
}
function load(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = unzip(buf), ws = files['workspace.json'];
    if (!ws) throw new Error('в архиве нет workspace.json');
    const json = ws.method === 8 ? inflateRawSync(ws.data).toString('utf8') : ws.data.toString('utf8');
    return { data: JSON.parse(json), atts: new Set(Object.keys(files).filter(f => f.startsWith('attachments/')).map(f => f.slice(12))), zip: true };
  }
  return { data: JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')), atts: new Set(), zip: false };
}

/* ---------- геометрия как в приложении ---------- */
// ширина символа Inter: заголовок 600 16px ≈ 8.9px, текст 400 14px ≈ 7.5px (кириллица чуть шире латиницы)
const lines = (text, cpl) => String(text || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / Math.max(8, cpl))), 0);
function estH(c) {
  const inner = c.w - 28;
  let h = 12 + 22 + 2 + 14 + 4;                                   // отступы, шапка с типом, рамка
  // заглавные в Inter 600 16px заметно шире строчных; перенос по словам съедает ещё ~6%
  const tw = [...String(c.title || '')].reduce((s, ch) => s + (/[A-ZА-ЯЁ]/.test(ch) ? 11.3 : /\s/.test(ch) ? 4.4 : 8.7), 0) * 1.06;
  const tl = c.title ? Math.ceil(tw / inner) : 0;
  h += 8 + Math.max(1, tl) * 20.8 + 8;
  let body;
  switch (c.type) {
    case 'text': case 'markdown': {
      const full = bodyFull(c);
      // свёрнуто: до 150px и кнопка «Развернуть»; expanded: до 460px и «Свернуть»
      body = c.customHeight ? c.customHeight - h : c.expanded ? Math.min(460, full) + 32 : Math.min(150, full) + (full > 154 ? 32 : 0);
      break;
    }
    case 'image': body = inner * 0.6; break;
    case 'video': case 'youtube': body = inner * 0.5625; break;
    case 'audio': body = 54; break;
    case 'link': body = c.preview ? (c.preview.image ? inner / 1.91 : 0) + 84 : 40 + 36; break;
    case 'pdf': body = (c.thumb ? inner * 0.75 : 120) + 36; break;
    default: body = 40 + 36;
  }
  return Math.round(h + body);
}
// полная высота текста карточки (без обрезки)
const bodyFull = c => c.type === 'markdown' ? mdHeight(c.content, c.w - 28) : lines(c.content, (c.w - 28) / 8.1) * 21.7;
// Markdown по блокам, как в CSS карточки: строка 14px × 1.6, у абзаца и списка поля 6px, у пункта 3px,
// пункт сдвинут на 22px, заголовки h1–h3 — 20/18/16px × 1.3 с полями 12/6. Соседние поля схлопываются.
function mdHeight(src, inner) {
  const blocks = []; let para = [];
  const cpl = w => w / 8.1;
  const flush = () => { if (para.length) { blocks.push({ h: lines(para.join(' '), cpl(inner)) * 22.4, mt: 6, mb: 6 }); para = []; } };
  const rows = String(src || '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i].replace(/\*\*|[*`]/g, ''); let m;
    if (/^```/.test(l)) { flush(); let n = 0; i++; while (i < rows.length && !/^```/.test(rows[i])) { n++; i++; } blocks.push({ h: n * 18.2 + 22, mt: 8, mb: 8 }); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flush(); const fs = [20, 18, 16][m[1].length - 1]; blocks.push({ h: lines(m[2], inner / (fs * 0.6)) * fs * 1.3, mt: 12, mb: 6 }); continue; }
    if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l))) {
      flush();
      const prev = blocks[blocks.length - 1], item = lines(m[2], cpl(inner - 22)) * 22.4;
      if (prev && prev.list) { prev.h += 3 + item; } else blocks.push({ h: item, mt: 6, mb: 6, list: true });
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); blocks.push({ h: lines(l.slice(1), cpl(inner - 15)) * 22.4, mt: 8, mb: 8 }); continue; }
    if (!l.trim()) { flush(); continue; }
    para.push(l.trim());
  }
  flush();
  let h = 0;
  blocks.forEach((b, i) => { h += b.h; if (i) h += Math.max(blocks[i - 1].mb, b.mt); });
  return h;
}
// кривая связи — как edgeCurve в src/index.html
function anchor(c, side, H) { const h = H(c); return side === 't' ? [c.x + c.w / 2, c.y] : side === 'b' ? [c.x + c.w / 2, c.y + h] : side === 'l' ? [c.x, c.y + h / 2] : [c.x + c.w, c.y + h / 2]; }
function curve(a, b, H) {
  const ha = H(a), hb = H(b), dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + hb / 2) - (a.y + ha / 2);
  const nx = Math.abs(dx) / ((a.w + b.w) / 2), ny = Math.abs(dy) / ((ha + hb) / 2);
  const [sa, sb] = nx >= ny ? (dx >= 0 ? ['r', 'l'] : ['l', 'r']) : (dy >= 0 ? ['b', 't'] : ['t', 'b']);
  const N = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  const p0 = anchor(a, sa, H), p3 = anchor(b, sb, H), na = N[sa], nb = N[sb];
  const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), k = Math.max(24, Math.min(220, dist * 0.32));
  const c1 = [p0[0] + na[0] * k, p0[1] + na[1] * k], c2 = [p3[0] + nb[0] * k, p3[1] + nb[1] * k];
  const pts = [];
  for (let i = 1; i < 32; i++) { const t = i / 32, m = 1 - t; pts.push([m * m * m * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p3[1]]); }
  return { pts, dist, vertical: sa === 'b' || sa === 't' };
}
const inside = (p, r, pad = 0) => p[0] > r.x - pad && p[0] < r.x + r.w + pad && p[1] > r.y - pad && p[1] < r.y + r.h + pad;

/* ---------- проверка ---------- */
function check(data, atts, zip) {
  const errors = [], warns = [], tips = [];
  // code — правило; однотипные замечания при выводе сворачиваются
  const E = (m, code, ref) => errors.push({ m, code, ref }), W = (m, code, ref) => warns.push({ m, code, ref }), T = (m, code, ref) => tips.push({ m, code, ref });
  if (!data || !Array.isArray(data.projects) || !data.projects.length) { E('нет массива projects: файл должен быть { version, projects: [...], currentProject }'); return { errors, warns, tips, stats: [] }; }
  if (data.version !== 'kobyla-polotno-v041') W('version не "kobyla-polotno-v041" — приложение откроет, но лучше ставить его');
  const stats = [];
  for (const p of data.projects) {
    const P = (m) => `«${p.name || p.id}»: ${m}`;
    if (!ID.test(String(p.id || ''))) E(P(`id полотна "${p.id}" — только латиница, цифры, - и _, до 64 символов (это имя файла)`));
    if (!p.name) W(P('у полотна нет name'));
    const cards = Array.isArray(p.cards) ? p.cards : [], edges = Array.isArray(p.edges) ? p.edges : [], groups = Array.isArray(p.groups) ? p.groups : [];
    if (!cards.length) { W(P('полотно пустое')); continue; }
    const byId = new Map();
    for (const c of cards) {
      const C = (m) => P(`карточка ${c.id}: ${m}`);
      if (!c.id || byId.has(c.id)) { E(C('нет id или id повторяется')); continue; }
      byId.set(c.id, c);
      if (!TYPES.includes(c.type)) E(C(`неизвестный type "${c.type}" (бывают: ${TYPES.join(', ')})`));
      if (typeof c.x !== 'number' || typeof c.y !== 'number') E(C('нет числовых x и y'));
      if (typeof c.w !== 'number') W(C('нет w — будет ширина по умолчанию для типа'));
      else if (c.w < 200 || c.w > 1200) E(C(`w=${c.w}: приложение зажмёт ширину в 200…1200`));
      if (c.type === 'youtube' && !/^[\w-]{6,}$/.test(String(c.content))) E(C('youtube: content — это id ролика (dQw4w9WgXcQ), не ссылка'));
      if (c.type === 'link' && !/^https?:\/\//.test(String(c.content))) E(C('link: content должен быть http(s)-ссылкой'));
      for (const k of ['content', 'thumb']) {
        const v = String(c[k] || '');
        if (v.startsWith('att:') && !atts.has(v.slice(4))) E(C(`${k} ссылается на вложение ${v}, а его нет${zip ? ' в архиве' : ': att: работает только внутри zip-файла .polotno, в JSON клади data: URL'}`));
      }
      if (['image', 'video', 'audio', 'pdf', 'file'].includes(c.type) && !c.content) W(C(`${c.type} без содержимого — покажется пустышкой`));
      if (c.type === 'text' || c.type === 'markdown') {
        const len = String(c.content || '').length;
        if (len > 1200) W(C(`текст ${len} символов: карточка покажет ~300 и кнопку «Развернуть». Полотно — не документ: разбей на несколько карточек-мыслей`), 'longtext');
        else if (!c.customHeight) {
          const full = bodyFull(c), cap = c.expanded ? 460 : 154;
          if (full > cap) T(C(`текст ≈${Math.round(full)}px выше ${cap}px: ${c.expanded ? 'появится прокрутка' : 'обрежется под «Развернуть»'}. Сократи, расширь карточку${c.expanded ? '' : ' или поставь expanded: true, если текст важно видеть целиком'}`), 'clamp');
        }
        if (c.type === 'text' && /(^|\n)(#{1,3} |\s*[-*] |\d+\. )/.test(String(c.content || ''))) T(C('в тексте разметка (заголовки, списки) — сделай type: "markdown"'), 'md');
      }
      // читаемость издалека
      const title = String(c.title || '');
      if (!title) W(C('без заголовка — издалека будет видно только тип'), 'notitle');
      else {
        const farCpl = Math.floor((c.w - 32) / 21), longest = Math.max(...title.split(/\s+/).map(s => s.length));
        if (longest > farCpl) W(C(`издалека слово из ${longest} букв не влезет в строку (при w=${c.w} влезает ${farCpl}) и разорвётся посередине — расширь карточку или замени слово`), 'word');
        if (title.length > farCpl * 3) W(C(`заголовок ${title.length} символов: издалека видно ~${farCpl * 3}, остальное — «…». Сократи до сути`), 'longtitle');
        if (/^[A-ZА-ЯЁ0-9 /+]{4,}\s*[·:|—-]/.test(title)) W(C(`заголовок начинается с метки «${title.split(/[·:|—]/)[0].trim()}»: на дальнем зуме видно только её, и все такие карточки выглядят одинаково. Метку — в #тег или в группу, а в начало — суть`), 'prefix');
      }
    }
    // связи
    const seenPairs = new Set(), labels = new Map();
    for (const e of edges) {
      if (!byId.has(e.from) || !byId.has(e.to)) { E(P(`связь ${e.id || '?'} ведёт к несуществующей карточке (${e.from} → ${e.to})`)); continue; }
      if (e.from === e.to) E(P(`связь ${e.id} из карточки в саму себя`));
      const k = e.from + '>' + e.to; if (seenPairs.has(k)) E(P(`связь ${e.from} → ${e.to} повторяется`)); seenPairs.add(k);
      if (e.label) { labels.set(e.label, (labels.get(e.label) || 0) + 1); if (e.label.length > 32) W(P(`подпись связи «${e.label}» длинная (${e.label.length}): до ~30 символов, глагол-причина`)); }
    }
    for (const [l, n] of labels) if (n >= 4 && n > edges.length * 0.2) W(P(`подпись «${l}» повторяется ${n} раз — это шум, а не смысл. Подпиши по-разному (что именно вызывает что) или оставь пустой`));
    // группы
    const gIds = new Set(groups.map(g => g.id));
    for (const c of cards) if (c.group && !gIds.has(c.group)) E(P(`карточка ${c.id} в группе ${c.group}, которой нет в groups`));
    const H = c => (c.customHeight || estH(c));
    const rect = c => ({ x: c.x, y: c.y, w: c.w, h: H(c) });
    const gRects = groups.map(g => {
      const ms = cards.filter(c => c.group === g.id); if (!ms.length) { W(P(`группа «${g.title}» пустая`)); return null; }
      const x0 = Math.min(...ms.map(c => c.x)), y0 = Math.min(...ms.map(c => c.y)), x1 = Math.max(...ms.map(c => c.x + c.w)), y1 = Math.max(...ms.map(c => c.y + H(c)));
      if (!g.title) W(P('у группы нет title — ярлычок будет «Группа»'));
      else if (g.title.length > 28) W(P(`название группы «${g.title}» длинное: ярлычок обрежется (~28 символов)`));
      return { g, ms, r: { x: x0 - GPAD, y: y0 - GPAD, w: x1 - x0 + 2 * GPAD, h: y1 - y0 + 2 * GPAD } };
    }).filter(Boolean);
    // наложения карточек
    let overl = 0;
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = rect(cards[i]), b = rect(cards[j]);
      if (a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP) { overl++; E(P(`карточки ${cards[i].id} и ${cards[j].id} налезают друг на друга или ближе ${GAP}px (высота оценена: ${a.h} и ${b.h})`), 'overlap', `${cards[i].id} × ${cards[j].id}`); }
    }
    // карточки чужих групп внутри рамки, рамки групп налезают
    for (const G of gRects) for (const c of cards) if (c.group !== G.g.id && rectOverlap(rect(c), G.r, 0)) E(P(`карточка ${c.id} (не из группы) попадает в рамку группы «${G.g.title}» — рамка строится по карточкам группы`));
    for (let i = 0; i < gRects.length; i++) for (let j = i + 1; j < gRects.length; j++) {
      const a = withTab(gRects[i].r), b = withTab(gRects[j].r);
      if (rectOverlap(a, b, GROUP_GAP)) W(P(`рамки групп «${gRects[i].g.title}» и «${gRects[j].g.title}» ближе ${GROUP_GAP}px (с ярлычком) — тесно или налезают`));
    }
    // связи через чужие карточки и рамки, длинные связи
    let through = 0, crossG = 0, longE = 0;
    const span = Math.max(...cards.map(c => c.x + c.w)) - Math.min(...cards.map(c => c.x));
    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) continue;
      const cv = curve(a, b, H);
      const hitCard = cards.find(c => c !== a && c !== b && cv.pts.some(p => inside(p, rect(c), -6)));
      if (hitCard) { through++; W(P(`связь ${e.from} → ${e.to} проходит сквозь карточку ${hitCard.id}`), 'through', `${e.from} → ${e.to}`); }
      const hitG = gRects.find(G => !G.ms.includes(a) && !G.ms.includes(b) && cv.pts.some(p => inside(p, G.r, -4)));
      if (hitG) { crossG++; W(P(`связь ${e.from} → ${e.to} пересекает чужую группу «${hitG.g.title}»`), 'crossgroup', `${e.from} → ${e.to}`); }
      if (cv.dist > Math.max(1400, span * 0.45)) longE++;
      // подпись рисуется в середине связи ПОД карточками: если зазор уже подписи, её не видно
      if (e.label) {
        const need = e.label.length * 6.8 + 26;
        if (cv.dist < need) W(P(`подпись «${e.label}» (${Math.round(need)}px) не влезает между ${e.from} и ${e.to} (зазор ${Math.round(cv.dist)}px) и спрячется под карточками — раздвинь карточки или сократи подпись`), 'labelgap', `${e.from} → ${e.to}`);
      }
    }
    if (longE > Math.max(2, edges.length * 0.15)) W(P(`${longE} связей тянутся через полхолста: пучки длинных линий — признак того, что связанные карточки стоят далеко. Ставь причину рядом со следствием`));
    // структура
    const inDeg = new Map(cards.map(c => [c.id, 0])), outDeg = new Map(cards.map(c => [c.id, 0]));
    for (const e of edges) if (byId.has(e.from) && byId.has(e.to)) { outDeg.set(e.from, outDeg.get(e.from) + 1); inDeg.set(e.to, inDeg.get(e.to) + 1); }
    const isolated = cards.filter(c => !inDeg.get(c.id) && !outDeg.get(c.id));
    if (isolated.length > Math.max(1, cards.length * 0.2)) W(P(`${isolated.length} карточек без связей — Полотно держится на причинах, а не на списках`));
    const roots = cards.filter(c => !inDeg.get(c.id) && outDeg.get(c.id));
    if (!roots.length && edges.length) T(P('нет корня (карточки без входящих связей): презентация начнётся с левой верхней'));
    const hubs = cards.filter(c => outDeg.get(c.id) + inDeg.get(c.id) > 8);
    if (hubs.length) T(P(`узлы с 9+ связями (${hubs.map(c => c.id).join(', ')}) — проверь, не «ко всему подряд» ли они`));
    if (!cards.some(c => c.created)) T(P('ни у одной карточки нет created (мс с 1970) — таймлайн покажет всё «без даты»'));
    const types = new Set(cards.map(c => c.type)); if (cards.length > 12 && types.size === 1 && types.has('text')) T(P('все карточки — text: длинные структурные тексты лучше в markdown, источники — в link, схемы и фото — в image'));
    if (cards.length > 15 && !groups.length) T(P('ни одной группы: на 15+ карточках группы дают структуру и ярлычки, видные издалека'));
    if (!cards.some(c => /#[\p{L}\p{N}_-]+/u.test((c.title || '') + ' ' + (c.content || '')))) T(P('нет #тегов — по ним работают поиск и подсказки связей (L)'));
    stats.push({ name: p.name, cards: cards.length, edges: edges.length, groups: groups.length, types: [...types].join(',') });
  }
  return { errors, warns, tips, stats };
}
function rectOverlap(a, b, gap) { return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap; }
function withTab(r) { return { x: r.x, y: r.y - TAB, w: r.w, h: r.h + TAB }; }

/* ---------- запуск ---------- */
const file = process.argv[2];
if (!file) { console.error('node scripts/check-canvas.mjs file.polotno [--json]'); process.exit(2); }
let loaded;
try { loaded = load(file); } catch (e) { console.error('не читается: ' + e.message); process.exit(2); }
const r = check(loaded.data, loaded.atts, loaded.zip);
if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
else {
  for (const s of r.stats) console.log(`${s.name}: ${s.cards} карточек, ${s.edges} связей, ${s.groups} групп; типы: ${s.types}`);
  // однотипные замечания сворачиваем: первое целиком, остальные — списком карточек
  const sec = (title, list, mark) => {
    if (!list.length) return;
    console.log(`\n${title} (${list.length})`);
    const byCode = new Map();
    for (const x of list) { const k = x.code || x.m; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(x); }
    for (const items of byCode.values()) {
      console.log(`  ${mark} ${items[0].m}`);
      if (items.length > 1) {
        const ids = items.slice(1).map(x => x.ref || (x.m.match(/карточка (\S+?):/) || [])[1]).filter(Boolean);
        console.log(`    …и ещё ${items.length - 1} так же${ids.length ? ': ' + ids.slice(0, 14).join(', ') + (ids.length > 14 ? ', …' : '') : ''}`);
      }
    }
  };
  sec('ОШИБКИ', r.errors, '✗'); sec('ПРЕДУПРЕЖДЕНИЯ', r.warns, '!'); sec('СОВЕТЫ', r.tips, '·');
  console.log(r.errors.length ? '\nЕсть ошибки — исправь перед сдачей.' : r.warns.length ? '\nОшибок нет, но предупреждения стоит разобрать.' : '\nЧисто.');
}
process.exit(r.errors.length ? 1 : 0);
