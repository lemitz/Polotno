/* Полотно: только десктоп — бэкапы (история с откатом) и автообновление. */
(window.PolotnoExt = window.PolotnoExt || []).push(function (api) {
  'use strict';
  if (!api.DESK) return;
  const { invoke, toast, ask, esc, $ } = api;

  const css = document.createElement('style');
  css.textContent = `
#bk { top: 58px; right: 12px; width: 440px; max-width: calc(100% - 24px); max-height: calc(100% - 230px); display: flex; flex-direction: column; }
#bk .hd { padding: 16px 18px 10px; display: grid; gap: 8px; border-bottom: 1px solid var(--line); }
#bk .ls { overflow: auto; padding: 6px; }
#bk .bi { border-radius: 10px; }
#bk .bi > button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 10px; text-align: left; color: var(--dim); }
#bk .bi > button:hover { background: rgba(245,245,240,.06); color: var(--paper); }
#bk .bi.open { background: rgba(245,245,240,.04); }
#bk .bi .t { font-weight: 600; color: var(--paper); }
#bk .bi .r { font: 500 12px/1 var(--mono); color: var(--mute); margin-left: auto; white-space: nowrap; }
#bk .bp { display: none; padding: 0 10px 10px 10px; }
#bk .bi.open .bp { display: grid; gap: 4px; }
#bk .pr { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; font-size: 13px; color: var(--dim); }
#bk .pr:hover { background: rgba(245,245,240,.05); }
#bk .pr .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bk .pr .c { font: 500 12px/1 var(--mono); color: var(--mute); }
#bk .row2 { display: flex; gap: 8px; flex-wrap: wrap; }
#bk .hb { height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--line-2); color: var(--dim); font-weight: 500; font-size: 13px; }
#bk .hb:hover { border-color: var(--acid); color: var(--acid); }
#bk .hb.primary { background: var(--acid); border-color: var(--acid); color: var(--ink); font-weight: 700; }
#upd { position: fixed; z-index: 92; right: 12px; bottom: 164px; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; border-radius: 12px; background: var(--paper); color: var(--ink); font-weight: 500; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
#upd[hidden] { display: none; }
#upd button { font-weight: 700; padding: 6px 10px; border-radius: 8px; background: var(--ink); color: var(--acid); }
#upd button.x { background: none; color: var(--ink); opacity: .6; padding: 6px 8px; }
#keys .upd { margin-top: 10px; }
`;
  document.head.appendChild(css);

  /* ---------- бэкапы ---------- */
  const REASON = { start: 'при запуске', auto: 'автоматически', manual: 'вручную', 'before-restore': 'перед откатом' };
  const fmt = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const panel = document.createElement('div');
  panel.id = 'bk'; panel.className = 'panel'; panel.hidden = true;
  panel.innerHTML = '<div class="hd"><h4>Бэкапы <button class="c-act" style="opacity:1" data-x aria-label="Закрыть">' + api.ICON.x + '</button></h4>'
    + '<div class="muted">Снимки всех полотен: при запуске и каждые 10 минут, если что-то менялось. Хранятся последние 40 и по одному на день за месяц.</div>'
    + '<div class="row2"><button class="hb" data-now>Сделать снимок сейчас</button></div></div><div class="ls"></div>';
  document.body.appendChild(panel);
  const list = $('.ls', panel);

  async function refresh() {
    list.innerHTML = '<div class="muted" style="padding:10px">Читаю…</div>';
    let items = [];
    try { items = await invoke('backup_list'); } catch (e) { list.innerHTML = '<div class="muted" style="padding:10px">' + esc(e) + '</div>'; return; }
    if (!items.length) { list.innerHTML = '<div class="muted" style="padding:10px">Пока пусто. Первый снимок появится через 10 минут работы или по кнопке выше.</div>'; return; }
    list.innerHTML = '';
    for (const b of items) {
      const cards = b.projects.reduce((s, p) => s + p.cards, 0);
      const el = document.createElement('div'); el.className = 'bi';
      el.innerHTML = '<button><span class="t"></span><span class="muted"></span><span class="r"></span></button><div class="bp"></div>';
      el.querySelector('.t').textContent = fmt(b.time);
      el.querySelector('.muted').textContent = REASON[b.reason] || b.reason;
      el.querySelector('.r').textContent = b.projects.length + ' пол. · ' + cards + ' карт.';
      const bp = el.querySelector('.bp');
      for (const p of b.projects) {
        const r = document.createElement('div'); r.className = 'pr';
        r.innerHTML = '<span class="n"></span><span class="c"></span><button class="hb">Вернуть копией</button>';
        r.querySelector('.n').textContent = p.name; r.querySelector('.c').textContent = p.cards + ' карт.';
        r.querySelector('button').addEventListener('click', () => restoreCopy(b, p));
        bp.appendChild(r);
      }
      const all = document.createElement('div'); all.className = 'row2'; all.style.marginTop = '6px';
      all.innerHTML = '<button class="hb">Откатить всё к этому снимку</button>';
      all.querySelector('button').addEventListener('click', () => restoreAll(b));
      bp.appendChild(all);
      el.firstChild.addEventListener('click', () => el.classList.toggle('open'));
      list.appendChild(el);
    }
  }
  // полотно из бэкапа возвращается отдельной копией, текущее не трогаем
  async function restoreCopy(b, meta) {
    try {
      const raw = await invoke('backup_project', { bid: b.id, pid: meta.id });
      const p = api.normalize(JSON.parse(raw));
      p.id = api.genId(); p.name = meta.name + ' (' + fmt(b.time) + ')';
      await invoke('project_save', { id: p.id, data: JSON.stringify(p, api.stripPriv) });
      api.S.projects.push(p);
      await api.openProject(p.id); api.saveIndex();
      toast('Вернул копию «' + meta.name + '»');
    } catch (e) { toast('Не вышло: ' + e); }
  }
  async function restoreAll(b) {
    const r = await ask('Откатить все полотна к снимку от ' + fmt(b.time) + '? Текущее состояние сначала уйдёт в бэкап, так что откат тоже можно откатить.', ['Откатить', 'Отмена']);
    if (r !== 0) return;
    await api.persist();
    try { await invoke('backup_restore', { bid: b.id }); panel.hidden = true; } catch (e) { toast('Не вышло: ' + e); }
  }
  const toggle = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refresh(); };
  panel.querySelector('[data-x]').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('[data-now]').addEventListener('click', async () => {
    await api.persist();
    try { await invoke('backup_now'); toast('Снимок готов'); refresh(); } catch (e) { toast('Не вышло: ' + e); }
  });
  api.addTool({ id: 'histBtn', where: 'r', tip: 'Бэкапы (Ctrl+H)',
    icon: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>', on: toggle });
  api.addKey('Бэкапы и откат', '<kbd>Ctrl+H</kbd>');
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h' && !api.dlgOpen()) { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && !panel.hidden && !api.isEditing()) panel.hidden = true;
  });

  /* ---------- автообновление ---------- */
  const bar = document.createElement('div'); bar.id = 'upd'; bar.hidden = true;
  document.body.appendChild(bar);
  let installed = false;
  async function check(manual) {
    if (!installed) {
      if (manual) toast('Портативная версия не обновляется сама: новая лежит на GitHub в Releases');
      return;
    }
    let info = null;
    try { info = await invoke('update_check'); } catch (e) { if (manual) toast('Не проверилось: ' + e); return; }
    if (!info) { if (manual) toast('У тебя свежая версия'); return; }
    bar.innerHTML = '<span></span><button data-go>Обновить</button><button class="x" data-x aria-label="Позже">' + api.ICON.x + '</button>';
    bar.firstChild.textContent = 'Вышла версия ' + info.version + ' (у тебя ' + info.current + ')';
    bar.hidden = false;
    bar.querySelector('[data-x]').onclick = () => { bar.hidden = true; };
    bar.querySelector('[data-go]').onclick = async () => {
      bar.firstChild.textContent = 'Скачиваю ' + info.version + '…'; bar.querySelector('[data-go]').disabled = true;
      await api.persist();
      // установщик сам закроет и перезапустит приложение
      try { await invoke('update_install'); } catch (e) { bar.firstChild.textContent = 'Не обновилось: ' + e; }
    };
  }
  const foot = $('#keys .foot');
  if (foot) {
    const b = document.createElement('button'); b.className = 'c-btn upd'; b.textContent = 'Проверить обновления';
    b.addEventListener('click', () => check(true)); foot.after(b);
  }
  (async () => {
    try { installed = await invoke('is_installed'); } catch (_) {}
    // проверяет только главное окно и только установленная версия
    if (installed && api.TAURI.window.getCurrentWindow().label === 'main') setTimeout(() => check(false), 8000);
  })();
});
