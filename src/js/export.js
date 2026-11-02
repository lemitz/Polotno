/* Полотно: экспорт. PNG и SVG всего полотна или выделенного (группа = её карточки), Markdown для Obsidian.
   SVG собирается сам по себе (шрифты и картинки внутри), PNG — это тот же SVG, растеризованный на canvas,
   поэтому оба выглядят одинаково и холст не «пачкается» чужими картинками. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const { esc } = api;
  const C = { ink: '#212121', ink2: '#292929', paper: '#F5F5F0', acid: '#B7FF00', line: 'rgba(245,245,240,.11)', dim: 'rgba(245,245,240,.74)', mute: 'rgba(245,245,240,.52)' };
  const SANS = "Inter, 'Segoe UI', sans-serif", MONO = "'JetBrains Mono Variable', Consolas, monospace";

  /* ---------- шрифты внутрь SVG ---------- */
  const FONTS = [
    ['Inter', 'fonts/inter-latin-wght-normal.woff2', 'U+0000-00FF,U+2000-206F,U+20AC,U+2122'],
    ['Inter', 'fonts/inter-cyrillic-wght-normal.woff2', 'U+0400-045F,U+0490-0491,U+2116'],
    ['JetBrains Mono Variable', 'fonts/jetbrains-mono-latin-wght-normal.woff2', 'U+0000-00FF,U+2000-206F'],
    ['JetBrains Mono Variable', 'fonts/jetbrains-mono-cyrillic-wght-normal.woff2', 'U+0400-045F']
  ];
  let fontCss = null;
  async function fontFaces() {
    if (fontCss != null) return fontCss;
    const parts = [];
    for (const [fam, url, range] of FONTS) {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        parts.push("@font-face{font-family:'" + fam + "';font-weight:100 900;src:url(data:font/woff2;base64," + b64(new Uint8Array(buf)) + ") format('woff2');unicode-range:" + range + ';}');
      } catch (_) {}
    }
    return (fontCss = parts.join(''));
  }
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

  /* ---------- картинки как data: URL ---------- */
  const imgCache = new Map();
  async function dataUrl(v) {
    if (!v) return null;
    if (imgCache.has(v)) return imgCache.get(v);
    let out = null;
    try {
      if (api.isAtt(v)) out = await api.invoke('att_read_b64', { file: api.attFile(v) });
      else if (v.indexOf('data:') === 0) out = v;
      else { const r = await fetch(v); if (r.ok) { const bl = await r.blob(); out = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); }); } }
    } catch (_) { out = null; }
    imgCache.set(v, out);
    return out;
  }
  function imgSize(url) {
    return new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth || 1, i.naturalHeight || 1]); i.onerror = () => res([16, 9]); i.src = url; });
  }

  /* ---------- текст: перенос по ширине как в карточке ---------- */
  const mctx = document.createElement('canvas').getContext('2d');
  function wrap(text, font, maxW, maxLines) {
    mctx.font = font;
    const out = [];
    for (const para of String(text || '').split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const tryL = line + word;
        if (mctx.measureText(tryL).width <= maxW || !line.trim()) {
          if (mctx.measureText(tryL).width > maxW) {
            // одно слово шире строки: режем по буквам
            let part = '';
            for (const ch of tryL) { if (mctx.measureText(part + ch).width > maxW) { out.push(part); part = ''; } part += ch; }
            line = part;
          } else line = tryL;
        } else { out.push(line.trimEnd()); line = word.trimStart(); }
      }
      out.push(line.trimEnd());
    }
    if (maxLines && out.length > maxLines) {
      const cut = out.slice(0, maxLines);
      let last = cut[maxLines - 1] + '…';
      while (mctx.measureText(last).width > maxW && last.length > 1) last = last.slice(0, -2) + '…';
      cut[maxLines - 1] = last;
      return cut;
    }
    return out;
  }
  const plainMd = s => String(s || '').replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, '')).replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^>\s?/gm, '').replace(/^\s*[-*+]\s+/gm, '• ');
  const tspans = (lines, x, y0, lh) => lines.map((l, i) => '<tspan x="' + x + '" y="' + (y0 + i * lh).toFixed(1) + '">' + esc(l) + '</tspan>').join('');

  /* ---------- сцена → SVG ---------- */
  async function buildSVG(cards) {
    const P = api.P, ids = new Set(cards.map(c => c.id));
    const edges = P.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    const groups = [];
    for (const g of P.groups || []) {
      const ms = (api.gMembers.get(g.id) || []).filter(c => ids.has(c.id)); if (!ms.length) continue;
      const b = api.bounds(ms);
      groups.push({ g, n: ms.length, r: { x: b.x0 - api.GPAD, y: b.y0 - api.GPAD, w: b.x1 - b.x0 + 2 * api.GPAD, h: b.y1 - b.y0 + 2 * api.GPAD } });
    }
    let { x0, y0, x1, y1 } = api.bounds(cards);
    for (const { r } of groups) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y - 46); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const curves = edges.map(e => ({ e, k: api.edgeCurve(api.cardMap.get(e.from), api.cardMap.get(e.to), 1) }));
    for (const { k } of curves) for (const p of [k.c1, k.c2]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const PAD = 56; x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
    const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
    const out = [];
    const defs = ['<style>' + await fontFaces() + '</style>',
      '<pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse" x="' + (-x0 % 32) + '" y="' + (-y0 % 32) + '"><circle cx="16" cy="16" r="1.3" fill="rgba(245,245,240,.13)"/></pattern>'];
    out.push('<rect width="' + W + '" height="' + H + '" fill="' + C.ink + '"/><rect width="' + W + '" height="' + H + '" fill="url(#dots)"/>');
    out.push('<g transform="translate(' + (-x0) + ' ' + (-y0) + ')">');
    // группы
    for (const { g, n, r } of groups) {
      out.push('<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="16" fill="rgba(183,255,0,.035)" stroke="rgba(183,255,0,.34)" stroke-width="2" stroke-dasharray="8 6"/>');
      const title = g.title || 'Группа';
      mctx.font = '600 14px ' + SANS; const tw = Math.min(320, mctx.measureText(title).width);
      mctx.font = '500 12px ' + MONO; const nw = mctx.measureText(String(n)).width;
      const bw = 12 + tw + 8 + nw + 12;
      out.push('<rect x="' + r.x + '" y="' + (r.y - 38) + '" width="' + bw.toFixed(1) + '" height="30" rx="9" fill="#343a22" stroke="rgba(183,255,0,.4)"/>'
        + '<text x="' + (r.x + 12) + '" y="' + (r.y - 18) + '" font-family="' + SANS + '" font-size="14" font-weight="600" fill="' + C.paper + '">' + esc(wrap(title, '600 14px ' + SANS, 320, 1)[0]) + '</text>'
        + '<text x="' + (r.x + 12 + tw + 8).toFixed(1) + '" y="' + (r.y - 19) + '" font-family="' + MONO + '" font-size="12" font-weight="500" fill="rgba(183,255,0,.8)">' + n + '</text>');
    }
    // связи
    for (const { k } of curves) {
      out.push('<path d="M' + k.p0 + 'C' + k.c1 + ' ' + k.c2 + ' ' + k.pe + '" fill="none" stroke="rgba(245,245,240,.34)" stroke-width="2" stroke-linecap="round"/>');
      const ux = -k.nb[0], uy = -k.nb[1], hw = k.al * 0.45;
      out.push('<path d="M' + k.p3 + 'L' + (k.pe[0] - uy * hw) + ' ' + (k.pe[1] + ux * hw) + 'L' + (k.pe[0] + uy * hw) + ' ' + (k.pe[1] - ux * hw) + 'Z" fill="rgba(245,245,240,.55)"/>');
    }
    // карточки
    for (const c of cards) out.push(await cardSVG(c, defs));
    // подписи связей поверх
    for (const { e, k } of curves) {
      if (!e.label) continue;
      const t = 0.5, m = 1 - t, mx = m * m * m * k.p0[0] + 3 * m * m * t * k.c1[0] + 3 * m * t * t * k.c2[0] + t * t * t * k.pe[0], my = m * m * m * k.p0[1] + 3 * m * m * t * k.c1[1] + 3 * m * t * t * k.c2[1] + t * t * t * k.pe[1];
      const label = wrap(e.label, '500 12px ' + SANS, 240, 1)[0]; mctx.font = '500 12px ' + SANS;
      const w = mctx.measureText(label).width + 20;
      out.push('<rect x="' + (mx - w / 2).toFixed(1) + '" y="' + (my - 11).toFixed(1) + '" width="' + w.toFixed(1) + '" height="22" rx="11" fill="' + C.ink + '" stroke="rgba(245,245,240,.2)"/>'
        + '<text x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '" text-anchor="middle" font-family="' + SANS + '" font-size="12" font-weight="500" fill="' + C.dim + '">' + esc(label) + '</text>');
    }
    out.push('</g>');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs>' + defs.join('') + '</defs>' + out.join('') + '</svg>';
    return { svg, W, H };
  }
  let clipN = 0;
  async function cardSVG(c, defs) {
    const x = c.x, y = c.y, w = c.w, h = api.estH(c), tc = api.TCOL[c.type], iw = w - 28, bx = x + 14;
    const parts = [];
    const cid = 'cl' + (++clipN);
    defs.push('<clipPath id="' + cid + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12"/></clipPath>');
    parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="' + C.ink2 + '" stroke="' + C.line + '"/>');
    parts.push('<g clip-path="url(#' + cid + ')">');
    // тип
    parts.push('<rect x="' + bx + '" y="' + (y + 19) + '" width="8" height="8" rx="3" fill="' + tc + '"/><text x="' + (bx + 15) + '" y="' + (y + 27.5) + '" font-family="' + MONO + '" font-size="12" font-weight="500" letter-spacing=".72" fill="' + tc + '">' + esc(api.TYPES[c.type].label.toUpperCase()) + '</text>');
    // заголовок
    const tl = c.title ? wrap(c.title, '600 16px ' + SANS, iw, 4) : [];
    let cy = y + 42;
    if (tl.length) { parts.push('<text font-family="' + SANS + '" font-size="16" font-weight="600" fill="' + C.paper + '">' + tspans(tl, bx, cy + 15, 20.8) + '</text>'); cy += tl.length * 20.8; }
    cy += 8;
    const room = y + h - 14 - cy;
    const box = (url, bh, extra) => url ? '<image x="' + bx + '" y="' + cy.toFixed(1) + '" width="' + iw + '" height="' + bh.toFixed(1) + '" preserveAspectRatio="xMidYMid slice" href="' + url + '"' + (extra || '') + '/>' : '';
    const roundClip = (bh) => { const id = 'ci' + (++clipN); defs.push('<clipPath id="' + id + '"><rect x="' + bx + '" y="' + cy.toFixed(1) + '" width="' + iw + '" height="' + bh.toFixed(1) + '" rx="8"/></clipPath>'); return ' clip-path="url(#' + id + ')"'; };
    const textBody = (txt, size, lh, color) => {
      const lines = wrap(txt, '400 ' + size + 'px ' + SANS, iw, Math.max(1, Math.floor(room / lh)));
      return lines.length ? '<text font-family="' + SANS + '" font-size="' + size + '" fill="' + color + '">' + tspans(lines, bx, cy + size * 1.02, lh) + '</text>' : '';
    };
    const pill = (label, sub) => '<rect x="' + bx + '" y="' + cy.toFixed(1) + '" width="' + iw + '" height="40" rx="10" fill="rgba(245,245,240,.05)" stroke="' + C.line + '"/>'
      + '<text x="' + (bx + 12) + '" y="' + (cy + 25).toFixed(1) + '" font-family="' + MONO + '" font-size="12" fill="' + C.dim + '">' + esc(wrap(label + (sub ? ' · ' + sub : ''), '400 12px ' + MONO, iw - 24, 1)[0]) + '</text>';
    switch (c.type) {
      case 'text': parts.push(textBody(c.content, 14, 21.7, C.dim)); break;
      case 'markdown': parts.push(textBody(plainMd(c.content), 14, 22.4, C.dim)); break;
      case 'image': case 'pdf': {
        const url = await dataUrl(c.type === 'pdf' ? c.thumb : c.content);
        if (url) { const [nw, nh] = await imgSize(url); const bh = Math.min(room, iw * nh / nw); parts.push(box(url, bh, roundClip(bh))); if (c.type === 'pdf' && c.pages) parts.push('<rect x="' + (bx + iw - 64) + '" y="' + (cy + bh - 30).toFixed(1) + '" width="56" height="22" rx="6" fill="rgba(33,33,33,.85)"/><text x="' + (bx + iw - 36) + '" y="' + (cy + bh - 15).toFixed(1) + '" text-anchor="middle" font-family="' + MONO + '" font-size="12" fill="' + C.paper + '">' + (parseInt(c.pages, 10) || 0) + ' стр.</text>'); }
        else parts.push(pill(c.filename || api.TYPES[c.type].label));
        break;
      }
      case 'youtube': {
        const url = await dataUrl('https://i.ytimg.com/vi/' + encodeURIComponent(c.content) + '/hqdefault.jpg');
        const bh = Math.min(room, iw * 9 / 16);
        parts.push(url ? box(url, bh, roundClip(bh)) : '<rect x="' + bx + '" y="' + cy.toFixed(1) + '" width="' + iw + '" height="' + bh.toFixed(1) + '" rx="8" fill="#111"/>');
        const px = bx + iw / 2, py = cy + bh / 2;
        parts.push('<rect x="' + (px - 28) + '" y="' + (py - 20).toFixed(1) + '" width="56" height="40" rx="12" fill="' + C.acid + '"/><path d="M' + (px - 6) + ' ' + (py - 9).toFixed(1) + 'L' + (px + 10) + ' ' + py.toFixed(1) + 'L' + (px - 6) + ' ' + (py + 9).toFixed(1) + 'Z" fill="' + C.ink + '"/>');
        break;
      }
      case 'link': {
        const pv = c.preview;
        if (!pv) { parts.push(pill(c.content)); break; }
        const url = await dataUrl(pv.image);
        let yy = cy;
        if (url) { const bh = Math.min(room * 0.6, iw / 1.91); parts.push(box(url, bh, roundClip(bh))); yy += bh + 10; }
        let host = ''; try { host = new URL(c.content).hostname.replace(/^www\./, ''); } catch (_) {}
        parts.push('<text x="' + bx + '" y="' + (yy + 12).toFixed(1) + '" font-family="' + MONO + '" font-size="12" fill="' + C.mute + '">' + esc(pv.site || host) + '</text>');
        const t2 = wrap(pv.title || c.content, '600 14px ' + SANS, iw, 2);
        parts.push('<text font-family="' + SANS + '" font-size="14" font-weight="600" fill="' + C.paper + '">' + tspans(t2, bx, yy + 32, 19) + '</text>');
        if (pv.description) { const d = wrap(pv.description, '400 13px ' + SANS, iw, Math.max(0, Math.min(3, Math.floor((y + h - 14 - (yy + 32 + t2.length * 19)) / 19)))); if (d.length) parts.push('<text font-family="' + SANS + '" font-size="13" fill="' + C.dim + '">' + tspans(d, bx, yy + 34 + t2.length * 19, 19) + '</text>'); }
        break;
      }
      default: parts.push(pill(c.filename || api.TYPES[c.type].label, api.fmtSize(c.size)));
    }
    parts.push('</g>');
    return parts.join('');
  }

  /* ---------- сохранение ---------- */
  const day = () => new Date().toISOString().slice(0, 10);
  const slug = s => String(s || 'polotno').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'polotno';
  async function saveAs(name, ext, filterName, write, browserBlob) {
    if (api.DESK) {
      const path = await api.invoke('plugin:dialog|save', { options: { title: 'Экспорт', defaultPath: name + '.' + ext, filters: [{ name: filterName, extensions: [ext] }] } });
      if (!path) return null;
      await write(path);
      api.toast('Сохранено: ' + api.baseName(path));
      return path;
    }
    const blob = await browserBlob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    api.toast('Скачано: ' + a.download);
    return a.download;
  }
  function pickCards(onlySel) {
    const P = api.P;
    const cs = onlySel ? P.cards.filter(c => api.sel.has(c.id)) : P.cards.slice();
    if (!cs.length) { api.toast(onlySel ? 'Сначала выдели карточки или группу' : 'Полотно пустое'); return null; }
    return cs;
  }
  async function exportSVG(onlySel) {
    const cs = pickCards(onlySel); if (!cs) return;
    api.setStatus('busy', 'собираю SVG…');
    try {
      const { svg } = await buildSVG(cs);
      await saveAs(slug(api.P.name) + (onlySel ? '-выделение' : ''), 'svg', 'SVG', path => api.invoke('write_text', { path, data: svg }), () => new Blob([svg], { type: 'image/svg+xml' }));
    } catch (e) { api.toast('SVG не собрался: ' + e); }
    api.setStatus('', 'сохранено');
  }
  async function renderPNG(cs) {
    const { svg, W, H } = await buildSVG(cs);
    // 2× для чёткости, но в пределах того, что переварит canvas
    const k = Math.max(0.25, Math.min(2, 16000 / Math.max(W, H), Math.sqrt(160e6 / (W * H))));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('SVG не отрисовался')); i.src = url; });
      const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('PNG не собрался'))), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
  async function exportPNG(onlySel) {
    const cs = pickCards(onlySel); if (!cs) return;
    api.setStatus('busy', 'рисую PNG…');
    try {
      const blob = await renderPNG(cs);
      await saveAs(slug(api.P.name) + (onlySel ? '-выделение' : ''), 'png', 'PNG',
        async path => { const u8 = new Uint8Array(await blob.arrayBuffer()); await api.invoke('write_base64', { path, data: b64(u8) }); }, async () => blob);
    } catch (e) { api.toast('PNG не собрался: ' + e); }
    api.setStatus('', 'сохранено');
  }

  /* ---------- Markdown для Obsidian ---------- */
  async function exportMD() {
    const P = api.P;
    if (!P.cards.length) { api.toast('Полотно пустое'); return; }
    const name = slug(P.name), filesDir = name + '_files';
    const copies = [];
    const byPos = (a, b) => (a.y - b.y) || (a.x - b.x);
    const title = c => (c.title || api.TYPES[c.type].label).replace(/[[\]|#^]/g, ' ').trim();
    const link = async (v, fname) => {
      if (api.isAtt(v)) { if (!api.DESK) return ''; const f = (fname || api.attFile(v)).replace(/[\\/:*?"<>|]+/g, '_'); const unique = api.attFile(v).slice(0, 6) + '-' + f; copies.push([api.attFile(v), unique]); return encodeURI(filesDir + '/' + unique); }
      return v || '';
    };
    const lines = ['# ' + P.name, '', '_Экспорт из Полотна, ' + new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + '_', ''];
    const groups = (P.groups || []).map(g => ({ g, ms: (api.gMembers.get(g.id) || []).slice().sort(byPos) })).filter(x => x.ms.length).sort((a, b) => byPos(a.ms[0], b.ms[0]));
    const loose = P.cards.filter(c => !c.group || !api.gById(c.group)).sort(byPos);
    const sections = groups.map(x => [x.g.title || 'Группа', x.ms]);
    if (loose.length) sections.push([groups.length ? 'Без группы' : '', loose]);
    for (const [head, cards] of sections) {
      if (head) lines.push('## ' + head, '');
      for (const c of cards) {
        lines.push((head ? '### ' : '## ') + title(c), '');
        switch (c.type) {
          case 'text': if (c.content) lines.push(c.content, ''); break;
          case 'markdown': if (c.content) lines.push(c.content.replace(/^(#{1,6})\s/gm, (m, h) => '#'.repeat(Math.min(6, h.length + 3)) + ' '), ''); break;
          case 'link': lines.push('[' + ((c.preview && c.preview.title) || c.content) + '](' + c.content + ')', ''); if (c.preview && c.preview.description) lines.push('> ' + c.preview.description, ''); break;
          case 'youtube': lines.push('[YouTube](https://youtu.be/' + c.content + ')', ''); break;
          case 'image': { const u = await link(c.content, c.filename); if (u) lines.push('![' + title(c) + '](' + u + ')', ''); break; }
          default: { const u = await link(c.content, c.filename); lines.push(u ? '[' + (c.filename || title(c)) + '](' + u + ')' : (c.filename || ''), ''); }
        }
        const outs = P.edges.filter(e => e.from === c.id).map(e => [api.cardMap.get(e.to), e.label]).filter(x => x[0]);
        const ins = P.edges.filter(e => e.to === c.id).map(e => [api.cardMap.get(e.from), e.label]).filter(x => x[0]);
        const fmt = (arrow, [o, l]) => arrow + ' [[#' + title(o) + '|' + title(o) + ']]' + (l ? ' — ' + l : '');
        if (outs.length || ins.length) lines.push('**Связи:** ' + outs.map(x => fmt('→', x)).concat(ins.map(x => fmt('←', x))).join(' · '), '');
      }
    }
    const md = lines.join('\n').replace(/\n{3,}/g, '\n\n');
    await saveAs(name, 'md', 'Markdown', async path => {
      await api.invoke('write_text', { path, data: md });
      const dir = path.replace(/[\\/][^\\/]+$/, '');
      for (const [file, as] of copies) await api.invoke('att_export', { file, path: dir + '\\' + filesDir + '\\' + as }).catch(() => {});
    }, async () => new Blob([md], { type: 'text/markdown' }));
  }

  /* ---------- меню ---------- */
  const I = {
    file: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    img: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    vec: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20 12 4l8 16"/><circle cx="12" cy="4" r="1.6"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="20" r="1.6"/></svg>',
    md: '<svg class="i" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6M16 9v6m-2-2 2 2 2-2"/></svg>'
  };
  api.exportMenu = () => {
    const has = api.sel.size > 0;
    api.menu(document.getElementById('exportBtn'), [
      { lab: 'Сохранить' },
      { label: api.DESK ? 'Файл .polotno' : 'JSON', icon: I.file, key: 'Ctrl+S', on: () => api.doExport() },
      ...(api.DESK ? [{ label: 'JSON для kobyla.by', icon: I.file, on: () => api.doExport({ site: true }) }] : []),
      { sep: true }, { lab: 'Картинка' },
      { label: 'PNG: всё полотно', icon: I.img, on: () => exportPNG(false) },
      { label: 'PNG: выделенное', icon: I.img, disabled: !has, on: () => exportPNG(true) },
      { label: 'SVG: всё полотно', icon: I.vec, on: () => exportSVG(false) },
      { label: 'SVG: выделенное', icon: I.vec, disabled: !has, on: () => exportSVG(true) },
      { sep: true },
      { label: 'Markdown (Obsidian)', icon: I.md, on: exportMD }
    ]);
  };
  const eb = document.getElementById('exportBtn'); eb.dataset.tip = 'Экспорт: файл, PNG, SVG, Markdown';
  api.export = { buildSVG, renderPNG, exportPNG, exportSVG, exportMD };
});
