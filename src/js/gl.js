/* Полотно: WebGL2-рендер для огромных полотен. На дальних масштабах (far, xfar, dot), когда карточек много,
   DOM-слои карточек, связей и подписей выключаются, и всё рисует GPU: карточки инстансами (скругления через SDF),
   связи — кривые Безье прямо в вершинном шейдере, названия — из атласа текстур. Вблизи работает обычный DOM.
   Рамки групп остаются в DOM: их мало, а ярлычки должны оставаться живыми. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  const cv = document.getElementById('gl');
  const gl = cv && cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, depth: false, stencil: false });
  if (!gl) { console.warn('WebGL2 недоступен: дальние масштабы рисует DOM'); return; }

  let threshold = 150; // с какого числа карточек включать GPU
  let active = false, lost = false;

  /* ---------- цвета (как в CSS) ---------- */
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const TF = { text: '#2d2f2a', markdown: '#302e28', link: '#292f2e', image: '#292d31', video: '#302a2a', audio: '#2d2b31', youtube: '#312b27', file: '#2b2b2a', pdf: '#302f29' };
  const colTC = {}, colTF = {};
  for (const t in api.TYPES) { colTC[t] = hex(api.TCOL[t] || '#A3A99A'); colTF[t] = hex(TF[t] || '#2d2f2a'); }
  const ACID = hex('#B7FF00'), PAPER = hex('#F5F5F0');
  // уровни детализации: скругление, полоса сверху, толщина рамки выделения (в единицах мира)
  const LOD = { far: { r: 18, stripe: 6, ring: 8, solid: false }, xfar: { r: 30, stripe: 14, ring: 18, solid: false }, dot: { r: 40, stripe: 0, ring: 36, solid: true } };

  /* ---------- шейдеры ---------- */
  function prog(vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  const HEAD = '#version 300 es\nprecision highp float;\nuniform vec3 u_view; uniform vec2 u_res;\nvec4 toClip(vec2 w){ vec2 s = w * u_view.x + u_view.yz; vec2 c = s / u_res * 2.0 - 1.0; return vec4(c.x, -c.y, 0.0, 1.0); }\n';
  let R, E, T, X;
  function build() {
    // карточки
    R = prog(HEAD + `
layout(location=0) in vec2 a_corner; layout(location=1) in vec4 a_rect; layout(location=2) in vec4 a_fill; layout(location=3) in vec4 a_stripe; layout(location=4) in vec4 a_par;
out vec2 v_local; out vec2 v_size; flat out vec4 v_fill; flat out vec4 v_stripe; flat out vec4 v_par;
void main(){ float m = a_par.z + 2.0 / u_view.x; vec2 local = a_corner * (a_rect.zw + 2.0 * m) - m;
  gl_Position = toClip(a_rect.xy + local); v_local = local; v_size = a_rect.zw; v_fill = a_fill; v_stripe = a_stripe; v_par = a_par; }`,
    `#version 300 es
precision highp float; uniform vec3 u_view; uniform vec3 u_ring;
in vec2 v_local; in vec2 v_size; flat in vec4 v_fill; flat in vec4 v_stripe; flat in vec4 v_par; out vec4 o;
float sdr(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){ vec2 h = v_size * 0.5; float r = min(v_par.x, min(h.x, h.y)); float d = sdr(v_local - h, h, r); float aa = 1.0 / u_view.x;
  float inside = clamp(0.5 - d / aa, 0.0, 1.0); vec4 col = v_local.y < v_par.y ? v_stripe : v_fill; float a = col.a * inside; vec3 rgb = col.rgb * a;
  if (v_par.z > 0.0 && v_par.w > 0.0) { float k = v_par.z; float ring = clamp(0.5 - (abs(d - k * 0.5) - k * 0.5) / aa, 0.0, 1.0) * v_par.w; rgb = mix(rgb, u_ring, ring); a = mix(a, 1.0, ring); }
  o = vec4(rgb, a); }`);
    // связи: кубическая Безье в шейдере, толщина в пикселях экрана
    E = prog(HEAD + `
layout(location=0) in vec2 a_tv; layout(location=1) in vec4 a_p01; layout(location=2) in vec4 a_p23; layout(location=3) in vec4 a_col; layout(location=4) in float a_w;
out vec4 v_col; out float v_side; out float v_w;
void main(){ float t = a_tv.x, m = 1.0 - t; vec2 p0 = a_p01.xy, p1 = a_p01.zw, p2 = a_p23.xy, p3 = a_p23.zw;
  vec2 b = m*m*m*p0 + 3.0*m*m*t*p1 + 3.0*m*t*t*p2 + t*t*t*p3;
  vec2 d = 3.0*m*m*(p1 - p0) + 6.0*m*t*(p2 - p1) + 3.0*t*t*(p3 - p2); if (dot(d, d) < 1e-6) d = p3 - p0; if (dot(d, d) < 1e-6) d = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(-d.y, d.x)); float hw = (a_w * 0.5 + 1.0) / u_view.x;
  gl_Position = toClip(b + n * a_tv.y * hw); v_col = a_col; v_side = a_tv.y; v_w = a_w; }`,
    `#version 300 es
precision highp float; in vec4 v_col; in float v_side; in float v_w; out vec4 o;
void main(){ float px = abs(v_side) * (v_w * 0.5 + 1.0); float a = v_col.a * clamp(v_w * 0.5 + 0.5 - px, 0.0, 1.0); o = vec4(v_col.rgb * a, a); }`);
    // треугольники (наконечники связей)
    T = prog(HEAD + `
layout(location=0) in vec2 a_pos; layout(location=1) in vec4 a_col; out vec4 v_col;
void main(){ gl_Position = toClip(a_pos); v_col = a_col; }`,
    `#version 300 es
precision highp float; in vec4 v_col; out vec4 o; void main(){ o = vec4(v_col.rgb * v_col.a, v_col.a); }`);
    // текст из атласа
    X = prog(HEAD + `
layout(location=0) in vec2 a_corner; layout(location=1) in vec4 a_rect; layout(location=2) in vec4 a_uv;
out vec2 v_uv; void main(){ gl_Position = toClip(a_rect.xy + a_corner * a_rect.zw); v_uv = mix(a_uv.xy, a_uv.zw, a_corner); }`,
    `#version 300 es
precision highp float; uniform sampler2D u_tex; in vec2 v_uv; out vec4 o; void main(){ o = texture(u_tex, v_uv); }`);
  }

  /* ---------- буферы ---------- */
  let quadBuf, stripBuf, rectBuf, edgeBuf, triBuf, textBuf, vaoR, vaoE, vaoT, vaoX;
  const N_SEG = 24;
  function setupBuffers() {
    quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const strip = []; for (let i = 0; i <= N_SEG; i++) strip.push(i / N_SEG, -1, i / N_SEG, 1);
    stripBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, stripBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
    rectBuf = gl.createBuffer(); edgeBuf = gl.createBuffer(); triBuf = gl.createBuffer(); textBuf = gl.createBuffer();
    const inst = (vao, buf, layout, stride) => { // layout: [[loc, size, offsetFloats]]
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [loc, size, off] of layout) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, 1); }
    };
    const base = (vao, buf, size) => { gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, size, gl.FLOAT, false, 0, 0); };
    vaoR = gl.createVertexArray(); base(vaoR, quadBuf, 2); inst(vaoR, rectBuf, [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12]], 16);
    vaoE = gl.createVertexArray(); base(vaoE, stripBuf, 2); inst(vaoE, edgeBuf, [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 1, 12]], 13);
    vaoX = gl.createVertexArray(); base(vaoX, quadBuf, 2); inst(vaoX, textBuf, [[1, 4, 0], [2, 4, 4]], 8);
    vaoT = gl.createVertexArray(); gl.bindVertexArray(vaoT); gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
  }
  // растущие массивы, чтобы не выделять память каждый кадр
  const arr = {};
  const grow = (name, n) => { if (!arr[name] || arr[name].length < n) arr[name] = new Float32Array(Math.max(n, 1024) * 1.5 | 0); return arr[name]; };

  /* ---------- атлас названий ---------- */
  const PAGE = 2048, MAXP = 4;
  let pages = [], slots = new Map(), flushed = false;
  const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d');
  function newPage() {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PAGE, PAGE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const p = { tex, shelves: [], bottom: 0 }; pages.push(p); return p;
  }
  function flush() { for (const p of pages) gl.deleteTexture(p.tex); pages = []; slots.clear(); }
  function alloc(w, h) {
    w += 2; h += 2;
    if (w > PAGE || h > PAGE) return null;
    for (let i = 0; i <= pages.length; i++) {
      const p = pages[i] || (pages.length < MAXP ? newPage() : null); if (!p) break;
      for (const s of p.shelves) if (h <= s.h && h >= s.h * 0.7 && s.x + w <= PAGE) { const r = { p, x: s.x, y: s.y }; s.x += w; return r; }
      if (p.bottom + h <= PAGE) { const s = { y: p.bottom, h, x: w }; p.shelves.push(s); p.bottom += h; return { p, x: 0, y: s.y }; }
    }
    return null;
  }
  // перенос строк как у .c-far: -webkit-line-clamp 3 с многоточием
  function wrapLines(text, maxW, maxLines) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (sctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line) out.push(line);
      line = word;
      while (sctx.measureText(line).width > maxW && line.length > 1) {
        let i = line.length - 1; while (i > 1 && sctx.measureText(line.slice(0, i)).width > maxW) i--;
        out.push(line.slice(0, i)); line = line.slice(i);
      }
    }
    if (line) out.push(line);
    if (out.length > maxLines) {
      out.length = maxLines;
      let l = out[maxLines - 1] + '…';
      while (sctx.measureText(l).width > maxW && l.length > 1) l = l.slice(0, -2) + '…';
      out[maxLines - 1] = l;
    }
    return out;
  }
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  function slotFor(kind, c) {
    const title = c.title || api.TYPES[c.type].label;
    const key = kind + '|' + c.w + '|' + title;
    let s = slots.get(key); if (s) return s;
    return { key, title, pending: true };
  }
  function renderSlot(kind, c, want) {
    const far = kind === 'far';
    const k = (far ? 0.5 : 0.32) * dpr();
    const fs = far ? 38 : 70, lh = fs * 1.12, pad = far ? 2 : 18;
    sctx.font = '600 ' + fs + 'px Inter, "Segoe UI", sans-serif';
    const maxW = far ? Math.max(40, c.w - 32) : 440;
    const lines = far ? wrapLines(want.title, maxW, 3) : wrapLines(want.title, maxW, 1);
    const bw = maxW + pad * 2, bh = lines.length * lh + pad * 2;
    const pw = Math.ceil(bw * k), ph = Math.ceil(bh * k);
    let at = alloc(pw, ph);
    if (!at && !flushed) { flush(); flushed = true; at = alloc(pw, ph); }
    if (!at) return null;
    scratch.width = pw; scratch.height = ph;
    sctx.setTransform(k, 0, 0, k, 0, 0);
    sctx.font = '600 ' + fs + 'px Inter, "Segoe UI", sans-serif';
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle'; sctx.fillStyle = '#F5F5F0';
    if (!far) { sctx.shadowColor = '#212121'; }
    for (let i = 0; i < lines.length; i++) {
      const y = pad + lh * (i + 0.5);
      if (!far) { sctx.shadowBlur = 14 * k; sctx.fillText(lines[i], bw / 2, y); sctx.shadowBlur = 3 * k; }
      sctx.fillText(lines[i], bw / 2, y);
    }
    gl.bindTexture(gl.TEXTURE_2D, at.p.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, at.x + 1, at.y + 1, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    const s = { page: at.p, u0: (at.x + 1) / PAGE, v0: (at.y + 1) / PAGE, u1: (at.x + 1 + pw) / PAGE, v1: (at.y + 1 + ph) / PAGE, bw, bh };
    slots.set(want.key, s);
    return s;
  }

  /* ---------- кадр ---------- */
  let W = 0, H = 0;
  const stats = { cards: 0, edges: 0, texts: 0, ms: 0 };
  function draw() {
    if (lost) return;
    const t0 = performance.now();
    const P = api.P, v = api.view, s = v.s, lod = api.lod, L = LOD[lod] || LOD.far;
    const d = dpr(), cw = Math.round(api.vw * d), ch = Math.round(api.vh * d);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    W = api.vw; H = api.vh;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const m = 300 / s, l = -v.x / s - m, t = -v.y / s - m, r = l + W / s + 2 * m, b = t + H / s + 2 * m;
    const sel = api.sel, hits = api.searchHits || new Set();
    const setView = pr => { gl.useProgram(pr.p); gl.uniform3f(pr.u.u_view, s, v.x, v.y); gl.uniform2f(pr.u.u_res, W, H); };

    // связи
    const iv = api.inv, hl = new Set();
    for (const id of sel) { const set = api.incident.get(id); if (set) for (const e of set) hl.add(e.id); }
    const eb = grow('e', P.edges.length * 13), tb = grow('t', P.edges.length * 18);
    let ne = 0, nt = 0;
    for (const e of P.edges) {
      const a = api.cardMap.get(e.from), c2 = api.cardMap.get(e.to); if (!a || !c2) continue;
      const k = api.edgeCurve(a, c2, iv);
      const x0 = Math.min(k.p0[0], k.p3[0], k.c1[0], k.c2[0]), x1 = Math.max(k.p0[0], k.p3[0], k.c1[0], k.c2[0]);
      const y0 = Math.min(k.p0[1], k.p3[1], k.c1[1], k.c2[1]), y1 = Math.max(k.p0[1], k.p3[1], k.c1[1], k.c2[1]);
      if (x1 < l || x0 > r || y1 < t || y0 > b) continue;
      const isSel = api.selEdge === e.id, isHl = hl.has(e.id);
      const col = isSel ? [ACID[0], ACID[1], ACID[2], 1] : isHl ? [ACID[0], ACID[1], ACID[2], 0.7] : [PAPER[0], PAPER[1], PAPER[2], 0.34];
      const o = ne * 13;
      eb[o] = k.p0[0]; eb[o + 1] = k.p0[1]; eb[o + 2] = k.c1[0]; eb[o + 3] = k.c1[1]; eb[o + 4] = k.c2[0]; eb[o + 5] = k.c2[1]; eb[o + 6] = k.pe[0]; eb[o + 7] = k.pe[1];
      eb[o + 8] = col[0]; eb[o + 9] = col[1]; eb[o + 10] = col[2]; eb[o + 11] = col[3]; eb[o + 12] = isSel ? 3 : 2;
      ne++;
      if (lod !== 'dot') {
        const ux = -k.nb[0], uy = -k.nb[1], hw = k.al * 0.45, ac = isSel || isHl ? col : [PAPER[0], PAPER[1], PAPER[2], 0.55];
        const pts = [k.p3[0], k.p3[1], k.pe[0] - uy * hw, k.pe[1] + ux * hw, k.pe[0] + uy * hw, k.pe[1] - ux * hw];
        for (let i = 0; i < 3; i++) { const q = nt * 6; tb[q] = pts[i * 2]; tb[q + 1] = pts[i * 2 + 1]; tb[q + 2] = ac[0]; tb[q + 3] = ac[1]; tb[q + 4] = ac[2]; tb[q + 5] = ac[3]; nt++; }
      }
    }
    if (ne) {
      setView(E); gl.bindVertexArray(vaoE); gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf); gl.bufferData(gl.ARRAY_BUFFER, eb.subarray(0, ne * 13), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (N_SEG + 1) * 2, ne);
    }
    if (nt) {
      setView(T); gl.bindVertexArray(vaoT); gl.bindBuffer(gl.ARRAY_BUFFER, triBuf); gl.bufferData(gl.ARRAY_BUFFER, tb.subarray(0, nt * 6), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, nt);
    }

    // карточки
    const rb = grow('r', P.cards.length * 16);
    const vis = [];
    let nr = 0;
    for (const c of P.cards) {
      const h = api.estH(c);
      if (c.x > r || c.x + c.w < l || c.y > b || c.y + h < t) continue;
      vis.push(c);
      const tc = colTC[c.type] || colTC.text, tf = colTF[c.type] || colTF.text, fill = L.solid ? tc : tf;
      const ringA = sel.has(c.id) ? 1 : hits.has(c.id) ? 0.55 : 0;
      const o = nr * 16;
      rb[o] = c.x; rb[o + 1] = c.y; rb[o + 2] = c.w; rb[o + 3] = h;
      rb[o + 4] = fill[0]; rb[o + 5] = fill[1]; rb[o + 6] = fill[2]; rb[o + 7] = 1;
      rb[o + 8] = tc[0]; rb[o + 9] = tc[1]; rb[o + 10] = tc[2]; rb[o + 11] = 1;
      rb[o + 12] = L.r; rb[o + 13] = L.stripe; rb[o + 14] = L.ring; rb[o + 15] = ringA;
      nr++;
    }
    if (nr) {
      setView(R); gl.uniform3f(R.u.u_ring, ACID[0], ACID[1], ACID[2]);
      gl.bindVertexArray(vaoR); gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf); gl.bufferData(gl.ARRAY_BUFFER, rb.subarray(0, nr * 16), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nr);
    }

    // названия: новые текстуры рисуем в пределах бюджета кадра, остальные дорисуются в следующих кадрах
    let nx = 0, more = false;
    flushed = false;
    if (lod !== 'dot' && vis.length) {
      const kind = lod === 'far' ? 'far' : 'xfar';
      const byPage = new Map();
      const budget = t0 + 6;
      for (const c of vis) {
        let sl = slotFor(kind, c);
        if (sl.pending) { if (performance.now() > budget) { more = true; continue; } sl = renderSlot(kind, c, sl); if (!sl) continue; }
        if (flushed && !slots.has(kind + '|' + c.w + '|' + (c.title || api.TYPES[c.type].label))) continue;
        const h = api.estH(c), cx = c.x + c.w / 2, cy = c.y + h / 2;
        let list = byPage.get(sl.page); if (!list) byPage.set(sl.page, list = []);
        list.push(cx - sl.bw / 2, cy - sl.bh / 2, sl.bw, sl.bh, sl.u0, sl.v0, sl.u1, sl.v1);
      }
      setView(X); gl.uniform1i(X.u.u_tex, 0); gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(vaoX);
      for (const [page, list] of byPage) {
        if (!pages.includes(page)) continue; // атлас сбросили посреди кадра
        gl.bindTexture(gl.TEXTURE_2D, page.tex);
        gl.bindBuffer(gl.ARRAY_BUFFER, textBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length / 8); nx += list.length / 8;
      }
    }
    gl.bindVertexArray(null);
    stats.cards = nr; stats.edges = ne; stats.texts = nx; stats.ms = performance.now() - t0;
    if (more) api.needDraw();
  }

  /* ---------- попадание курсором (вместо DOM) ---------- */
  function hit(sx, sy) {
    const P = api.P, w = api.toWorld(sx, sy);
    for (let i = P.cards.length - 1; i >= 0; i--) {
      const c = P.cards[i];
      if (w.x >= c.x && w.x <= c.x + c.w && w.y >= c.y && w.y <= c.y + api.estH(c)) return c;
    }
    return null;
  }

  /* ---------- включение ---------- */
  function want() { const P = api.P; return !lost && !api.presenting && api.lod !== 'full' && !!P && P.cards.length >= threshold; }
  function update() {
    const w = want();
    if (w !== active) { active = w; api.viewport.classList.toggle('gl-on', w); api.hideTip(); if (!w) gl.clear(gl.COLOR_BUFFER_BIT); }
    if (active) api.needDraw();
  }
  try { build(); setupBuffers(); } catch (e) { console.error('WebGL не собрался:', e); return; }
  api.glHit = hit;
  api.on('draw', () => { if (active) draw(); });
  api.on('lod', update);
  api.on('render', update);
  api.on('project', () => { flush(); update(); });
  api.on('change', update);
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; pages = []; slots.clear(); update(); });
  cv.addEventListener('webglcontextrestored', () => { lost = false; try { build(); setupBuffers(); } catch (_) { lost = true; } update(); });
  update();
  api.gl = {
    get active() { return active; },
    get threshold() { return threshold; },
    set threshold(n) { threshold = Math.max(0, n | 0); update(); },
    stats, flush
  };
});
