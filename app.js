(() => {
  'use strict';

  // ---------- config ----------
  const SUPABASE_URL = 'https://zjhihjhrbmasfshjalxc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_W3x_7QAjOtT0cfEy9cwpqg__oaXJx7k'; // publishable: safe in the browser
  const EMOJIS = ['🦊', '🐸', '🐼', '🦁', '🐙', '🦄', '🐯', '🐵', '🐧', '🦉', '🐨', '🐹', '🐮', '🐷', '👽', '🤖', '👻', '🌵'];
  const MAX_OPINION = 300;

  const params = new URLSearchParams(location.search);
  const SLOT = (params.get('slot') || '').replace(/[^a-z0-9]/gi, ''); // test helper: several players in one browser

  // ---------- storage ----------
  const key = (k) => 'uo_' + k + (SLOT ? '_' + SLOT : '');
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(key(k)); } catch { /* private mode */ } }
  };

  // ---------- i18n ----------
  function detectLang() {
    const saved = store.get('lang');
    if (saved && I18N[saved]) return saved;
    for (const l of navigator.languages || [navigator.language || 'en']) {
      const s = (l || '').slice(0, 2).toLowerCase();
      if (I18N[s]) return s;
    }
    return 'en';
  }
  function t(k, vars) {
    const dict = I18N[S.lang] || I18N.en;
    let s = dict[k] != null ? dict[k] : I18N.en[k];
    if (typeof s === 'string' && vars) s = s.replace(/\{(\w+)\}/g, (_, v) => (vars[v] != null ? vars[v] : ''));
    return s;
  }
  function errText(code) {
    const e = (I18N[S.lang] || I18N.en).err;
    return e[code] || e.UNKNOWN;
  }
  function applyLang() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = I18N[S.lang].dir;
    document.title = t('app_name');
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(s || '');
  const slipCls = (text, extra = '') => 'slip' + (isArabic(text) ? ' arabic' : '') + (extra ? ' ' + extra : '');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function setHTML(el, html) {
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + t('and') + names[names.length - 1];
  }
  function vibrate(p) {
    try {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate && navigator.vibrate(p);
    } catch { /* ignore */ }
  }
  function joinUrl(code) { return location.origin + location.pathname + '?r=' + code; }

  // ---------- state ----------
  const S = {
    lang: 'en',
    screen: 'home',          // home | name | room
    mode: 'create',          // create | join
    joinCode: '',
    emoji: null,
    session: store.get('session'), // { code, token, playerId }
    state: null,
    viewKey: '',
    draft: '',
    editing: null,
    pendingVote: null,
    busy: false,
    online: true
  };
  S.lang = detectLang();

  // ---------- backend ----------
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  async function rpc(fn, args) {
    let res;
    try { res = await sb.rpc(fn, args); } catch (err) { const e = new Error('NETWORK'); e.code = 'NETWORK'; throw e; }
    const { data, error } = res;
    if (error) {
      const msg = String(error.message || '');
      let code = /^[A-Z_]+$/.test(msg) ? msg : (/fetch|network|load failed|timeout/i.test(msg) ? 'NETWORK' : 'UNKNOWN');
      if (code === 'UNKNOWN') console.warn('rpc error', fn, error);
      const e = new Error(code); e.code = code; throw e;
    }
    return data;
  }

  // ---------- toast / modal / connection ----------
  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  function setConn(ok) {
    S.online = ok;
    const el = $('#conn');
    el.textContent = t('reconnecting');
    el.hidden = ok;
  }
  function modal(html) {
    const m = $('#modal');
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    m.hidden = false;
    const first = m.querySelector('button');
    if (first) first.focus();
    return m;
  }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
  function confirmBox(text, yes, danger) {
    return new Promise((resolve) => {
      const m = modal(
        '<p style="font-size:18px;font-weight:600">' + esc(text) + '</p>' +
        '<div class="row" style="margin-top:18px">' +
        '<button class="btn secondary" data-m="no">' + esc(t('cancel')) + '</button>' +
        '<button class="btn' + (danger ? ' danger' : '') + '" data-m="yes">' + esc(yes || t('confirm')) + '</button>' +
        '</div>');
      m.onclick = (e) => {
        const b = e.target.closest('[data-m]');
        if (!b && e.target !== m) return;
        m.onclick = null;
        closeModal();
        resolve(!!b && b.dataset.m === 'yes');
      };
    });
  }
  function showRules() {
    const m = modal(
      '<h2>' + esc(t('how_to_play')) + '</h2><ol>' +
      t('rules').map((r) => '<li>' + esc(r) + '</li>').join('') + '</ol>' +
      '<button class="btn" data-m="ok">' + esc(t('got_it')) + '</button>');
    m.onclick = (e) => { if (e.target.closest('[data-m]') || e.target === m) { m.onclick = null; closeModal(); } };
  }

  // ---------- shared pieces ----------
  function langSwitch() {
    return '<div class="langs" role="group" aria-label="Language">' +
      [['en', 'EN'], ['fr', 'FR'], ['ar', 'عربي']].map(([l, label]) =>
        '<button data-action="lang" data-v="' + l + '" aria-pressed="' + (S.lang === l) + '" lang="' + l + '">' + label + '</button>').join('') +
      '</div>';
  }
  function topbar(left) { return '<header class="topbar">' + (left || '') + langSwitch() + '</header>'; }
  function face(p) { return '<span class="face" aria-hidden="true">' + esc(p.emoji) + '</span>'; }

  // ---------- render root ----------
  const app = $('#app');
  function render() {
    applyLang();
    if (S.screen === 'room') { S.viewKey = ''; renderRoom(); return; }
    if (S.screen === 'name') return renderName();
    return renderHome();
  }

  // ---------- home ----------
  function renderHome() {
    const samples = t('samples');
    app.innerHTML =
      topbar('') +
      '<section class="hero">' +
        '<h1>' + esc(t('app_name')) + '</h1>' +
        '<p>' + esc(t('tagline')) + '</p>' +
      '</section>' +
      '<div class="fan" aria-hidden="true">' + samples.map((s) => '<div class="' + slipCls(s) + '"><span dir="auto">' + esc(s) + '</span></div>').join('') + '</div>' +
      '<div class="stack">' +
        '<button class="btn" data-action="go-create">' + esc(t('create')) + '</button>' +
        '<div class="panel stack" style="--gap:12px">' +
          '<label class="field"><span>' + esc(t('code_label')) + '</span>' +
          '<input id="code" type="text" class="code-input" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="4" placeholder="ABCD" value="' + esc(S.joinCode) + '"></label>' +
          '<button class="btn secondary" data-action="go-join" id="joinBtn"' + (S.joinCode.length === 4 ? '' : ' disabled') + '>' + esc(t('join')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="footer-actions" style="text-align:center"><button class="link" data-action="rules">' + esc(t('how_to_play')) + '</button></div>';
  }

  // ---------- name / emoji ----------
  function renderName() {
    if (!S.emoji) S.emoji = store.get('emoji') || pick(EMOJIS);
    const title = S.mode === 'create' ? t('create') : t('room', { code: S.joinCode });
    app.innerHTML =
      topbar('<button class="icon-btn" data-action="back" aria-label="' + esc(t('back')) + '">' + (I18N[S.lang].dir === 'rtl' ? '→' : '←') + '</button>') +
      '<div class="stack" style="--gap:22px">' +
        '<h2 style="font-size:30px">' + esc(title) + '</h2>' +
        '<label class="field"><span>' + esc(t('your_name')) + '</span>' +
          '<input id="name" type="text" maxlength="20" autocomplete="nickname" placeholder="' + esc(t('name_ph')) + '" value="' + esc(store.get('name', '')) + '"></label>' +
        '<div><span class="small muted" style="display:block;font-weight:600;margin-bottom:8px">' + esc(t('pick_emoji')) + '</span>' +
          '<div class="emojis">' + EMOJIS.map((e) => '<button data-action="emoji" data-v="' + e + '" aria-pressed="' + (S.emoji === e) + '">' + e + '</button>').join('') + '</div></div>' +
        '<button class="btn" data-action="submit-name">' + esc(S.mode === 'create' ? t('create_btn') : t('join_btn')) + '</button>' +
      '</div>';
    const input = $('#name');
    if (!input.value) input.focus();
  }

  async function submitName(btn) {
    const name = ($('#name').value || '').trim();
    if (!name) { toast(errText('BAD_NAME'), true); $('#name').focus(); return; }
    store.set('name', name);
    store.set('emoji', S.emoji);
    await act(btn, async () => {
      const res = S.mode === 'create'
        ? await rpc('create_room', { p_name: name, p_emoji: S.emoji })
        : await rpc('join_room', { p_code: S.joinCode, p_name: name, p_emoji: S.emoji });
      S.session = { code: res.code, token: res.token, playerId: res.player_id };
      store.set('session', S.session);
      enterRoom();
    }, false);
  }

  // ---------- room lifecycle ----------
  let channel = null, pollTimer = null, rtStatus = '', refreshTimer = null;
  let inflight = false, again = false;

  function enterRoom() {
    S.screen = 'room';
    S.viewKey = '';
    S.state = null;
    app.innerHTML = topbar('') + '<p class="muted" style="margin-top:40px;text-align:center">…</p>';
    const q = '?r=' + S.session.code + (SLOT ? '&slot=' + SLOT : '');
    history.replaceState(null, '', location.pathname + q);
    subscribe();
    schedulePoll();
    refresh();
    keepAwake();
  }

  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    channel = sb.channel('room-' + S.session.code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_signals', filter: 'code=eq.' + S.session.code }, () => refreshSoon())
      .subscribe((status) => { rtStatus = status; if (status === 'SUBSCRIBED') refreshSoon(); });
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const every = rtStatus === 'SUBSCRIBED' ? 6000 : 2500;
    pollTimer = setTimeout(() => {
      if (S.screen === 'room' && document.visibilityState === 'visible') refresh();
      schedulePoll();
    }, every);
  }
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 60); }

  async function refresh() {
    if (!S.session || S.screen !== 'room') return;
    if (inflight) { again = true; return; }
    inflight = true;
    try {
      const st = await rpc('get_state', { p_code: S.session.code, p_token: S.session.token });
      setConn(true);
      const prevPhase = S.state && S.state.room.phase;
      const prevRound = S.state && S.state.room.round;
      S.state = st;
      if (st.room.phase === 'voting' && (st.room.round !== prevRound || prevPhase !== 'voting')) vibrate(25);
      if (st.room.phase === 'result' && prevPhase === 'voting') vibrate([30, 60, 30]);
      renderRoom();
    } catch (e) {
      if (e.code === 'NOT_IN_ROOM' || e.code === 'ROOM_NOT_FOUND') { toast(errText(e.code), true); leaveLocal(); }
      else if (e.code === 'NETWORK') setConn(false);
    } finally {
      inflight = false;
      if (again) { again = false; refresh(); }
    }
  }

  function leaveLocal() {
    store.del('session');
    S.session = null; S.state = null; S.screen = 'home'; S.viewKey = ''; S.editing = null; S.draft = '';
    if (channel) { sb.removeChannel(channel); channel = null; }
    clearTimeout(pollTimer);
    releaseWake();
    history.replaceState(null, '', location.pathname + (SLOT ? '?slot=' + SLOT : ''));
    setConn(true);
    render();
  }

  // Keep phones awake during a game (supported on recent iOS and Android browsers)
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } } catch { wakeLock = null; }
  }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.screen === 'room') { refresh(); keepAwake(); }
  });
  window.addEventListener('online', () => { if (S.screen === 'room') refresh(); });

  // Runs an action with the button disabled; refreshes the room afterwards
  async function act(btn, fn, doRefresh = true) {
    if (S.busy) return;
    S.busy = true;
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(errText(e.code), true);
      if (e.code === 'NOT_IN_ROOM' || e.code === 'ROOM_NOT_FOUND') leaveLocal();
    } finally {
      S.busy = false;
      if (btn && btn.isConnected) btn.disabled = false;
      if (doRefresh) refresh();
    }
  }

  // ---------- room views ----------
  function byId(st) { const m = {}; st.players.forEach((p) => { m[p.id] = p; }); return m; }
  function nameOf(st, id) { const p = byId(st)[id]; return p ? p.name : '?'; }
  function hostName(st) { return nameOf(st, st.room.host_id); }
  function isHost(st) { return st.room.host_id === st.me.id; }

  function renderRoom() {
    const st = S.state;
    if (!st) return;
    const r = st.room;
    const vkey = [r.phase, r.game_no, r.round, r.stage, S.lang].join('|');
    const isNew = vkey !== S.viewKey;
    S.viewKey = vkey;
    if (isNew) S.pendingVote = null;
    if (r.phase === 'lobby') return renderLobby(st, isNew);
    if (r.phase === 'voting') return renderVoting(st, isNew);
    if (r.phase === 'result') return renderResult(st, isNew);
    return renderFinished(st, isNew);
  }

  function roomTopbar(st) {
    return topbar('<span class="title">' + esc(t('room', { code: st.room.code })) + '</span>');
  }

  function claimHostBox(st) {
    if (!st.room.can_claim_host) return '';
    return '<div class="host-note"><span class="spacer">' + esc(t('become_host', { name: hostName(st) })) + '</span>' +
      '<button class="btn small secondary" data-action="claim-host">' + esc(t('become_host_btn')) + '</button></div>';
  }

  // ----- lobby -----
  function renderLobby(st, isNew) {
    if (isNew) {
      S.editing = null;
      const url = joinUrl(st.room.code);
      let qr = '';
      try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { qr = ''; }
      app.innerHTML =
        roomTopbar(st) +
        '<div class="stack" style="--gap:18px">' +
          '<section class="panel">' +
            '<div class="invite">' +
              '<div><div class="bigcode">' + esc(st.room.code) + '</div>' +
              '<p class="small muted" style="margin-top:8px">' + esc(t('invite')) + ' <b dir="ltr">' + esc(st.room.code) + '</b></p></div>' +
              '<div class="qr" aria-hidden="true">' + qr + '</div>' +
            '</div>' +
            '<button class="btn small secondary" style="margin-top:12px;width:100%" data-action="share">' + esc(t('share')) + '</button>' +
          '</section>' +
          '<section class="compose">' +
            '<h3>' + esc(t('your_opinions')) + '</h3>' +
            '<p class="small muted" style="margin:2px 0 10px">' + esc(t('only_you_see')) + '</p>' +
            '<textarea id="draft" dir="auto" maxlength="' + MAX_OPINION + '" placeholder="' + esc(t('write_ph')) + '">' + esc(S.draft) + '</textarea>' +
            '<div class="counter"><span id="count">' + S.draft.length + '</span>/' + MAX_OPINION + '</div>' +
            '<button class="btn" style="margin-top:8px" data-action="add-op" id="addBtn"' + (S.draft.trim() ? '' : ' disabled') + '>' + esc(t('add')) + '</button>' +
            '<ul class="mine" id="mine"></ul>' +
          '</section>' +
          '<section class="panel"><h3 id="playersTitle"></h3><ul class="people" id="players"></ul></section>' +
          '<div id="startArea" class="stack" style="--gap:10px"></div>' +
          '<div class="row" style="justify-content:center;gap:18px"><button class="link" data-action="rules">' + esc(t('how_to_play')) + '</button>' +
          '<button class="link" data-action="leave">' + esc(t('leave')) + '</button></div>' +
        '</div>';
    }

    // my opinions (left alone while one is being edited)
    const mine = st.me.opinions || [];
    if (S.editing && !mine.some((o) => o.id === S.editing)) S.editing = null;
    if (!S.editing) {
      setHTML($('#mine'), mine.length
        ? mine.map((o) =>
          '<li><div class="' + slipCls(o.body) + '"><span dir="auto">' + esc(o.body) + '</span>' +
          '<div class="actions"><button data-action="edit-op" data-v="' + o.id + '">' + esc(t('edit')) + '</button>' +
          '<button data-action="del-op" data-v="' + o.id + '">' + esc(t('delete')) + '</button></div></div></li>').join('')
        : '<li class="small muted">' + esc(t('empty_mine')) + '</li>');
    }

    // players
    $('#playersTitle').textContent = t('players', { n: st.players.length });
    const host = isHost(st);
    setHTML($('#players'), st.players.map((p) =>
      '<li><span class="dot' + (p.online ? ' on' : '') + '"></span>' + face(p) +
      '<span class="pname">' + esc(p.name) + (p.id === st.me.id ? ' <span class="muted">(' + esc(t('you')) + ')</span>' : '') + '</span>' +
      '<span class="spacer"></span>' +
      (p.id === st.room.host_id ? '<span class="tag host">' + esc(t('host')) + '</span>' : '') +
      '<span class="tag' + (p.ready ? ' ok' : '') + '">' + esc(p.ready ? t('ready') : t('writing')) + '</span>' +
      (host && p.id !== st.me.id ? '<button class="icon-btn" data-action="remove" data-v="' + p.id + '" aria-label="' + esc(t('remove')) + ' ' + esc(p.name) + '">✕</button>' : '') +
      '</li>').join(''));

    // start / waiting
    const writers = st.players.filter((p) => p.ready).length;
    const canStart = st.players.length >= 2 && writers >= 2;
    const pile = '<p class="small muted" style="text-align:center">' + esc(t('pile_count', { n: st.room.total })) + '</p>';
    setHTML($('#startArea'), host
      ? '<button class="btn" data-action="start"' + (canStart ? '' : ' disabled') + '>' + esc(t('start')) + '</button>' +
        (canStart ? '' : '<p class="small muted" style="text-align:center">' + esc(t('start_hint')) + '</p>') + pile
      : '<div class="host-note">⏳ <span>' + esc(t('waiting_host', { name: hostName(st) })) + '</span></div>' + pile + claimHostBox(st));
  }

  // ----- voting -----
  function validTargets(st, voterId) {
    const r = st.room;
    return st.players.filter((p) => p.id !== voterId && !p.crossed_off && (r.stage === 1 || r.candidates.includes(p.id)));
  }

  function renderVoting(st, isNew) {
    const r = st.room;
    if (isNew) {
      const c = st.current;
      const candNames = r.stage === 2 ? joinNames(r.candidates.map((id) => nameOf(st, id))) : '';
      app.innerHTML =
        roomTopbar(st) +
        '<div class="stack" style="--gap:18px">' +
          '<div class="slip-wrap' + (r.stage === 1 ? ' draw' : '') + '">' +
            '<div class="' + slipCls(c.body) + '"><span class="meta">' + esc(t('opinion_n', { n: c.number, total: c.total })) + '</span>' +
            '<span dir="auto">' + esc(c.body) + '</span></div>' +
          '</div>' +
          (r.stage === 2
            ? '<div class="banner">' + esc(t('revote', { names: candNames })) + '</div>'
            : '<h2>' + esc(t('who_wrote')) + '</h2>') +
          '<p class="small muted" id="voteHelp">' + esc(t('tap_suspect')) + '</p>' +
          '<div class="suspects" id="suspects"></div>' +
          '<div id="offlist"></div>' +
          '<div id="votebar"></div>' +
          '<div id="hostbits" class="stack" style="--gap:10px"></div>' +
        '</div>';
    }

    const targets = validTargets(st, st.me.id);
    const myVote = S.pendingVote || st.me.vote;
    if (!targets.length) {
      $('#voteHelp').hidden = true;
      setHTML($('#suspects'), '<div class="host-note" style="grid-column:1/-1">🤫 <span>' + esc(t('only_suspect')) + '</span></div>');
    } else {
      setHTML($('#suspects'), targets.map((p) =>
        '<button class="suspect" data-action="vote" data-v="' + p.id + '" aria-pressed="' + (myVote === p.id) + '">' +
        face(p) + '<span class="pname">' + esc(p.name) + '</span></button>').join(''));
    }

    const off = st.players.filter((p) => p.crossed_off);
    setHTML($('#offlist'), off.length
      ? '<span class="small muted" style="font-weight:600">' + esc(t('not_suspects')) + '</span><div class="offlist">' +
        off.map((p) => '<span>' + esc(p.emoji + ' ' + p.name) + '</span>').join('') + '</div>'
      : '');

    const m = Math.max(st.voters_expected, 1);
    const pct = Math.min(100, Math.round((st.votes_cast / m) * 100));
    const waiting = st.players.filter((p) => !p.voted && validTargets(st, p.id).length);
    setHTML($('#votebar'),
      '<div class="votebar"><div class="meter"><i style="width:' + pct + '%"></i></div>' +
      '<span class="small" style="font-weight:600">' + esc(t('voted_count', { n: st.votes_cast, m: st.voters_expected })) + '</span></div>' +
      (st.me.vote ? '<p class="small" style="margin-top:6px;color:var(--mint);font-weight:600">✓ ' + esc(t('voted_you')) + '</p>' : '') +
      (waiting.length ? '<p class="small muted" style="margin-top:6px">⏳ ' + waiting.map((p) => esc(p.emoji + ' ' + p.name)).join(', ') + '</p>' : ''));

    setHTML($('#hostbits'),
      '<button class="btn small secondary" style="width:100%" data-action="close-voting">' + esc(t('close_voting')) + '</button>' +
      (isHost(st) ? '<div style="text-align:center"><button class="link" data-action="end-game">' + esc(t('end_game')) + '</button></div>' : '') +
      claimHostBox(st));
  }

  // ----- result -----
  function renderResult(st, isNew) {
    const res = st.result || {};
    const players = byId(st);
    if (isNew) {
      const c = st.current;
      const caught = res.outcome === 'caught';
      let verdict, details = [];
      if (caught) {
        const author = players[res.author_id] || { name: '?' };
        verdict = t('caught', { name: author.name });
        details.push(res.crossed_off ? t('crossed', { name: author.name }) : t('still_suspect', { name: author.name }));
        const dets = (res.detectives || []).map((id) => nameOf(st, id));
        details.push(dets.length ? t('points_for', { names: joinNames(dets) }) : t('no_points'));
      } else if (res.reason === 'tie') verdict = t('tie_hidden');
      else if (res.reason === 'no_votes') verdict = t('no_votes');
      else verdict = t('wrong', { name: nameOf(st, res.accused_id) });

      const votes = st.round_votes || [];
      const votesHtml = votes.length
        ? '<ul class="votes-list">' + votes.map((v) => {
          const a = players[v.voter_id] || { emoji: '', name: '?' };
          const b = players[v.target_id] || { emoji: '', name: '?' };
          return '<li>' + esc(a.emoji + ' ' + a.name) + ' <span class="arrow">→</span> ' + esc(b.emoji + ' ' + b.name) +
            (v.stage === 2 ? ' <span class="tag">' + esc(t('revote_tag')) + '</span>' : '') + '</li>';
        }).join('') + '</ul>'
        : '<p class="small muted">—</p>';

      const ranked = st.players.slice().sort((a, b) => b.score - a.score);
      const scoresHtml = '<ul class="scores">' + ranked.map((p) =>
        '<li>' + face(p) + '<span class="pname">' + esc(p.name) + '</span><span class="pts">' + p.score + '</span></li>').join('') + '</ul>';

      app.innerHTML =
        roomTopbar(st) +
        '<div class="stack" style="--gap:18px">' +
          '<div class="slip-wrap">' +
            '<div class="' + slipCls(c.body, 'stamped') + '"><span class="meta">' + esc(t('opinion_n', { n: c.number, total: c.total })) + '</span>' +
            '<span dir="auto">' + esc(c.body) + '</span></div>' +
            '<div class="stamp ' + (caught ? 'caught' : 'hidden') + '">' + esc(caught ? t('caught_stamp') : t('hidden_stamp')) + '</div>' +
          '</div>' +
          '<div class="stack" style="--gap:8px;margin-top:26px">' +
            '<p class="verdict ' + (caught ? 'caught' : 'hidden') + '">' + esc(verdict) + '</p>' +
            details.map((d) => '<p>' + esc(d) + '</p>').join('') +
          '</div>' +
          '<section class="panel"><h3>' + esc(t('votes_title')) + '</h3>' + votesHtml + '</section>' +
          '<section class="panel"><h3>' + esc(t('scores')) + '</h3>' + scoresHtml +
            '<p class="small muted" style="margin-top:8px">' + esc(t('secret_note')) + '</p></section>' +
          '<div id="hostbits" class="stack" style="--gap:10px"></div>' +
        '</div>';
    }
    setHTML($('#hostbits'),
      '<button class="btn" data-action="next">' + esc(st.room.pile > 0 ? t('next') : t('last')) + '</button>' +
      (isHost(st) && st.room.pile > 0 ? '<div style="text-align:center"><button class="link" data-action="end-game">' + esc(t('end_game')) + '</button></div>' : '') +
      claimHostBox(st));
  }

  // ----- finished -----
  function renderFinished(st, isNew) {
    const players = byId(st);
    if (isNew) {
      const final = st.final || [];
      const top = final.length ? final[0].total : 0;
      const scores = '<ul class="scores">' + final.map((f, i) => {
        const p = players[f.id] || { emoji: '', name: '?' };
        const secret = f.total - f.public;
        return '<li class="' + (f.total === top && top > 0 ? 'top' : '') + '"><span class="rank">' + (i + 1) + '</span>' + face(p) +
          '<span class="pname">' + esc(p.name) + '</span>' +
          (secret > 0 ? '<span class="secret">' + esc(t('secret_pts', { n: secret })) + '</span>' : '') +
          '<span class="pts">' + f.total + '</span></li>';
      }).join('') + '</ul>';
      const hist = (st.history || []).map((h) => {
        const a = h.author_id ? players[h.author_id] : null;
        return '<li><div class="' + slipCls(h.body) + '"><span dir="auto">' + esc(h.body) + '</span>' +
          '<span class="by ' + (a ? 'caught' : 'hidden') + '">' + (a ? esc(a.emoji + ' ' + a.name) : '🤫 ' + esc(t('unknown_author'))) + '</span></div></li>';
      }).join('');
      app.innerHTML =
        roomTopbar(st) +
        '<div class="stack" style="--gap:18px">' +
          '<h2 style="font-size:30px">' + esc(t('final_title')) + '</h2>' +
          '<section class="panel">' + scores + '</section>' +
          (hist ? '<h3>' + esc(t('history')) + '</h3><ul class="history">' + hist + '</ul>' : '') +
          '<div id="hostbits" class="stack" style="--gap:10px"></div>' +
          '<div style="text-align:center"><button class="link" data-action="exit">' + esc(t('exit')) + '</button></div>' +
        '</div>';
    }
    setHTML($('#hostbits'), isHost(st)
      ? '<button class="btn" data-action="new-game">' + esc(t('new_game')) + '</button>'
      : '<div class="host-note">⏳ <span>' + esc(t('waiting_new', { name: hostName(st) })) + '</span></div>' + claimHostBox(st));
  }

  // ---------- events ----------
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action, v = b.dataset.v;
    const st = S.state;
    const base = S.session ? { p_code: S.session.code, p_token: S.session.token } : null;

    switch (a) {
      case 'lang':
        S.lang = v; store.set('lang', v); render(); break;
      case 'rules': showRules(); break;
      case 'go-create': S.mode = 'create'; S.screen = 'name'; render(); break;
      case 'go-join': {
        const code = ($('#code').value || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) return;
        S.joinCode = code; S.mode = 'join'; S.screen = 'name'; render(); break;
      }
      case 'back': S.screen = 'home'; render(); break;
      case 'emoji':
        S.emoji = v;
        app.querySelectorAll('.emojis button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
        break;
      case 'submit-name': submitName(b); break;

      case 'share': {
        const url = joinUrl(st.room.code);
        try {
          if (navigator.share) { await navigator.share({ title: t('app_name'), text: t('room', { code: st.room.code }), url }); }
          else { await navigator.clipboard.writeText(url); toast(t('copied')); }
        } catch { /* share sheet dismissed */ }
        break;
      }
      case 'add-op': {
        const ta = $('#draft');
        const body = (ta.value || '').trim();
        if (!body) return;
        await act(b, async () => {
          await rpc('add_opinion', { ...base, p_body: body });
          S.draft = ''; ta.value = ''; $('#count').textContent = '0';
          ta.focus();
        });
        if ($('#addBtn')) $('#addBtn').disabled = !S.draft.trim();
        break;
      }
      case 'edit-op': {
        S.editing = v;
        const op = (st.me.opinions || []).find((o) => o.id === v);
        const li = b.closest('li');
        li.innerHTML = '<div class="' + slipCls(op.body) + '"><textarea dir="auto" maxlength="' + MAX_OPINION + '" id="editbox">' + esc(op.body) + '</textarea>' +
          '<div class="actions"><button data-action="cancel-edit">' + esc(t('cancel')) + '</button>' +
          '<button data-action="save-op" data-v="' + v + '">' + esc(t('save')) + '</button></div></div>';
        $('#mine')._html = null;
        $('#editbox').focus();
        break;
      }
      case 'cancel-edit': S.editing = null; $('#mine')._html = null; renderRoom(); break;
      case 'save-op': {
        const body = ($('#editbox').value || '').trim();
        await act(b, async () => {
          await rpc('edit_opinion', { ...base, p_opinion: v, p_body: body });
          S.editing = null; $('#mine')._html = null;
        });
        break;
      }
      case 'del-op':
        await act(b, () => rpc('delete_opinion', { ...base, p_opinion: v }));
        break;
      case 'remove': {
        const p = byId(st)[v];
        if (await confirmBox(t('remove_confirm', { name: p ? p.name : '' }), t('remove'), true)) {
          await act(null, () => rpc('remove_player', { ...base, p_player: v }));
        }
        break;
      }
      case 'start': await act(b, () => rpc('start_game', base)); break;
      case 'leave':
        if (await confirmBox(t('leave') + '?', t('leave'), true)) {
          await act(null, async () => { await rpc('leave_room', base); leaveLocal(); }, false);
        }
        break;
      case 'exit':
        if (await confirmBox(t('exit_confirm'), t('exit'), true)) leaveLocal();
        break;
      case 'claim-host': await act(b, () => rpc('claim_host', base)); break;

      case 'vote': {
        if ((S.pendingVote || st.me.vote) === v) return;
        S.pendingVote = v;
        app.querySelectorAll('.suspect').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
        vibrate(10);
        try {
          await rpc('cast_vote', { ...base, p_target: v });
        } catch (err) {
          S.pendingVote = null;
          toast(errText(err.code), true);
        }
        refresh();
        break;
      }
      case 'close-voting': {
        const missing = Math.max(0, st.voters_expected - st.votes_cast);
        if (await confirmBox(t('close_confirm', { n: missing }), t('close_voting'))) {
          await act(null, () => rpc('close_voting', { ...base, p_round: st.room.round, p_stage: st.room.stage }));
        }
        break;
      }
      case 'next': await act(b, () => rpc('next_opinion', { ...base, p_round: st.room.round })); break;
      case 'end-game':
        if (await confirmBox(t('end_confirm'), t('end_game'), true)) await act(null, () => rpc('end_game', base));
        break;
      case 'new-game': await act(b, () => rpc('new_game', base)); break;
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'code') {
      const clean = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (clean !== e.target.value) e.target.value = clean;
      S.joinCode = clean;
      $('#joinBtn').disabled = clean.length !== 4;
    } else if (e.target.id === 'draft') {
      S.draft = e.target.value;
      $('#count').textContent = String(S.draft.length);
      $('#addBtn').disabled = !S.draft.trim();
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') { e.preventDefault(); const btn = $('#joinBtn'); if (!btn.disabled) btn.click(); }
    if (e.target.id === 'name') { e.preventDefault(); $('[data-action="submit-name"]').click(); }
  });

  // ---------- boot ----------
  const linkCode = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  applyLang();
  if (S.session && (!linkCode || linkCode === S.session.code)) {
    enterRoom();
  } else if (linkCode.length === 4) {
    if (S.session) { store.del('session'); S.session = null; }
    S.joinCode = linkCode; S.mode = 'join'; S.screen = 'name';
    render();
  } else {
    render();
  }
})();
