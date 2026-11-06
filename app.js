(function () {
  const P = window.Poker;
  const $ = (s) => document.querySelector(s);
  const PEER_PREFIX = 'pokervdvoem-v1-';
  const AUTO_NEXT_MS = 6500;
  const RUNOUT_MS = 1300;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  // флаг «я хозяин» живёт во вкладке: перезагрузка не теряет стол, а новая вкладка — это гость
  const tab = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };

  let role = null;     // 'host' | 'guest'
  let code = null;
  let S = null;        // полное состояние (только у хозяина)
  let view = null;     // то, что видит этот игрок
  let prevView = null;
  let peer = null, conn = null, timer = null;
  let myName = '';
  let guestConnecting = false;

  // ================= ЗВУК =================
  let ac = null, muted = store.get('pk_mute') === '1';
  function audio() {
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'sine', vol = 0.07, delay = 0) {
    if (muted || !audio()) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function swish(delay = 0) {
    if (muted || !audio()) return;
    const t = ac.currentTime + delay, len = 0.12, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass'; f.frequency.value = 3000; g.gain.value = 0.25;
    src.buffer = buf; src.connect(f).connect(g).connect(ac.destination); src.start(t);
  }
  const sfx = {
    card: (n = 1) => { for (let i = 0; i < n; i++) swish(i * 0.11); },
    chip: () => { tone(2200, 0.05, 'triangle', 0.05); tone(2900, 0.05, 'triangle', 0.04, 0.05); },
    turn: () => { tone(660, 0.12, 'sine', 0.05); tone(990, 0.16, 'sine', 0.05, 0.1); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'sine', 0.07, i * 0.1)),
    lose: () => [392, 330].forEach((f, i) => tone(f, 0.3, 'sine', 0.05, i * 0.15)),
  };

  // ================= ЛОББИ =================
  function init() {
    const params = new URLSearchParams(location.search);
    code = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    $('#btn-sound').textContent = muted ? '🔇' : '🔊';

    if (code) {
      const saved = store.get('pk_state_' + code);
      if (tab.get('pk_host_' + code) && saved) {
        role = 'host';
        S = JSON.parse(saved);
        myName = S.players[0].name;
        startHostNet();
        if (S.phase === 'lobby') showWait(); else commit();
      } else {
        role = 'guest';
        $('#lobby-join').hidden = false;
        $('#in-guest-name').value = store.get('pk_name') || '';
      }
    } else {
      $('#lobby-create').hidden = false;
      $('#in-host-name').value = store.get('pk_name') || '';
    }
  }

  $('#btn-create').onclick = () => {
    myName = ($('#in-host-name').value.trim() || 'Игрок').slice(0, 16);
    store.set('pk_name', myName);
    const [sb, bb] = $('#in-blinds').value.split('/').map(Number);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => alphabet[x % alphabet.length]).join('');
    role = 'host';
    S = P.newGame({ hostName: myName, stack: +$('#in-stack').value, sb, bb });
    tab.set('pk_host_' + code, '1');
    save();
    history.replaceState(null, '', '?room=' + code);
    startHostNet();
    showWait();
  };

  $('#btn-join').onclick = () => {
    myName = ($('#in-guest-name').value.trim() || 'Гость').slice(0, 16);
    store.set('pk_name', myName);
    $('#btn-join').disabled = true;
    setStatus('Подключаемся к столу…');
    audio();
    startGuestNet();
  };

  function showWait() {
    $('#lobby-create').hidden = true;
    $('#lobby-wait').hidden = false;
    $('#share-link').value = location.origin + location.pathname + '?room=' + code;
  }
  $('#btn-copy').onclick = async () => {
    const link = $('#share-link').value;
    try { await navigator.clipboard.writeText(link); } catch (e) { $('#share-link').select(); document.execCommand('copy'); }
    $('#btn-copy').textContent = 'Готово ✓';
    setTimeout(() => ($('#btn-copy').textContent = 'Копировать'), 1500);
  };

  function setStatus(t) { $('#lobby-status').textContent = t; }
  function showGame() {
    $('#screen-lobby').hidden = true;
    $('#screen-game').hidden = false;
  }

  // ================= СЕТЬ: ХОЗЯИН =================
  function startHostNet() {
    peer = new Peer(PEER_PREFIX + code, { debug: 1 });
    peer.on('open', () => setStatus(''));
    peer.on('connection', (c) => {
      c.on('open', () => {
        if (conn && conn !== c) { try { conn.close(); } catch (e) {} }
        conn = c;
        c.on('data', onHostData);
        c.on('close', () => { if (conn === c) { conn = null; toast((S.players[1].name || 'Соперник') + ' отключилась… ждём'); } });
      });
    });
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        setStatus('Восстанавливаем стол…');
        try { peer.destroy(); } catch (x) {}
        setTimeout(startHostNet, 4000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        setStatus('Проблемы с сетью, переподключаемся…');
      } else console.warn(e);
    });
  }

  function onHostData(d) {
    if (!d || !S) return;
    if (d.t === 'hello') {
      const nm = String(d.name || 'Гость').slice(0, 16);
      S.players[1].name = nm;
      if (S.phase === 'lobby') P.startHand(S);
      toast(nm + ' за столом ♥');
      commit();
    } else if (d.t === 'act') {
      if (P.act(S, 1, d.a, d.amt)) commit();
      else sendState();
    } else if (d.t === 'emo') {
      floatEmoji('op', d.e);
    } else if (d.t === 'rematch') {
      if (S.phase === 'gameover') { P.rematch(S); commit(); }
    }
  }

  function save() { if (S) store.set('pk_state_' + code, JSON.stringify(S)); }
  function sendState() {
    if (conn && conn.open) conn.send({ t: 'state', v: P.viewFor(S, 1) });
  }
  function commit() {
    if (S.phase === 'showdown' && !S.nextAt) S.nextAt = Date.now() + AUTO_NEXT_MS;
    save();
    sendState();
    setView(P.viewFor(S, 0));
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (S.phase === 'betting' && S.runout) {
      timer = setTimeout(() => { P.revealNext(S); commit(); }, RUNOUT_MS);
    } else if (S.phase === 'showdown') {
      timer = setTimeout(() => { P.startHand(S); commit(); }, Math.max(300, S.nextAt - Date.now()));
    }
  }

  // ================= СЕТЬ: ГОСТЬ =================
  function startGuestNet() {
    peer = new Peer({ debug: 1 });
    peer.on('open', connectToHost);
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000));
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {
        guestConnecting = false;
        setStatus('Стол пока не открыт — ждём хозяина…');
        if (view) toast('Соединение потеряно, переподключаемся…');
        setTimeout(connectToHost, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        setStatus('Проблемы с сетью, переподключаемся…');
      } else console.warn(e);
    });
  }
  function connectToHost() {
    if (guestConnecting || (conn && conn.open)) return;
    guestConnecting = true;
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    c.on('open', () => {
      guestConnecting = false;
      conn = c;
      c.send({ t: 'hello', name: myName });
    });
    c.on('data', (d) => {
      if (d.t === 'state') { showGame(); setView(d.v); }
      else if (d.t === 'emo') floatEmoji('op', d.e);
    });
    c.on('close', () => {
      if (conn === c) { conn = null; toast('Связь пропала, переподключаемся…'); setTimeout(connectToHost, 2000); }
    });
    setTimeout(() => { if (guestConnecting && !(conn && conn.open)) { guestConnecting = false; connectToHost(); } }, 8000);
  }

  // ================= ДЕЙСТВИЯ =================
  function doAction(a, amt) {
    audio();
    if (role === 'host') { if (P.act(S, 0, a, amt)) commit(); }
    else if (conn && conn.open) {
      conn.send({ t: 'act', a, amt });
      $('#controls').querySelectorAll('button, input').forEach((b) => (b.disabled = true));
    }
  }
  function sendEmoji(e) {
    audio();
    floatEmoji('me', e);
    if (conn && conn.open) conn.send({ t: 'emo', e });
  }
  function askRematch() {
    if (role === 'host') { P.rematch(S); commit(); }
    else if (conn && conn.open) conn.send({ t: 'rematch' });
  }

  // ================= ОТРИСОВКА =================
  function setView(v) {
    prevView = view;
    view = v;
    if (v.nextIn) v._deadline = Date.now() + v.nextIn;
    showGame();
    playSounds(prevView, v);
    render();
  }

  function playSounds(a, b) {
    if (!a) return;
    const cnt = (v) => v.board.length + v.me.cards.length;
    const nc = cnt(b) - (a.hand === b.hand ? cnt(a) : 0);
    if (nc > 0) sfx.card(Math.min(nc, 3));
    if (a.hand === b.hand && b.me.bet + b.op.bet > a.me.bet + a.op.bet) sfx.chip();
    if (b.result && !a.result) setTimeout(() => (b.result.winners.includes('me') ? sfx.win() : sfx.lose()), 250);
    if (b.toAct === 'me' && a.toAct !== 'me') setTimeout(sfx.turn, 300);
  }

  const fmt = P.fmt;
  const CHIP_COLORS = ['#e2475e', '#2f7fe0', '#1f9a5a', '#222', '#8b3fd6'];

  function cardEl(c) {
    const d = document.createElement('div');
    if (c === null || c === undefined) { d.className = 'card slot'; return d; }
    if (c < 0) { d.className = 'card back'; return d; }
    const r = P.RANK_LABEL[P.rank(c)], s = P.SUITS[P.suit(c)];
    const face = P.rank(c) >= 9 && P.rank(c) <= 11;
    d.className = 'card' + (P.isRed(c) ? ' red' : '');
    d.dataset.c = c;
    d.innerHTML = `<div class="tl">${r}<i>${s}</i></div><div class="mid${face ? ' face' : ''}">${face ? r + s : s}</div><div class="br">${r}<i>${s}</i></div>`;
    return d;
  }

  function renderCards(el, cards, winSet) {
    const sig = JSON.stringify(cards) + '|' + (winSet ? [...winSet].join(',') : '');
    if (el._sig === sig) return;
    const prev = el._cards || [];
    el._sig = sig;
    el.innerHTML = '';
    let k = 0;
    cards.forEach((c, i) => {
      const n = cardEl(c);
      const was = prev[i];
      if (c !== null && was !== c) {
        n.classList.add(was === -1 && c >= 0 ? 'flip' : 'deal');
        n.style.animationDelay = k++ * 110 + 'ms';
      }
      if (winSet && c >= 0 && winSet.has(c)) n.classList.add('win');
      el.appendChild(n);
    });
    el._cards = cards.slice();
  }

  function chipsHTML(amount) {
    const n = Math.min(5, Math.max(1, Math.ceil(Math.log10(amount + 1) * 1.4)));
    let h = '<div class="chips">';
    for (let i = 0; i < n; i++) h += `<div class="chip" style="--c:${CHIP_COLORS[i % CHIP_COLORS.length]};top:${-i * 4}px;animation-delay:${i * 40}ms"></div>`;
    return h + '</div>';
  }

  function renderSeat(who, p, v, winSet) {
    $(`#${who}-name`).textContent = p.name || '…';
    $(`#${who}-stack`).textContent = fmt(p.stack);
    $(`#${who}-avatar`).textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    const seat = $(`#seat-${who}`);
    seat.classList.toggle('active', v.toAct === who);
    seat.classList.toggle('folded', p.folded);
    $(`#${who}-dealer`).classList.toggle('on', p.dealer);

    const bub = $(`#${who}-bubble`);
    const isHand = v.result && v.result.type === 'showdown';
    if (bub.textContent !== p.last) { bub.textContent = p.last; bub.style.animation = 'none'; bub.offsetHeight; bub.style.animation = ''; }
    bub.className = 'bubble' + (isHand ? ' hand' : p.folded ? ' fold' : '');

    renderCards($(`#${who}-cards`), p.cards, winSet);

    const betEl = $(`#${who}-bet`);
    const bsig = String(p.bet);
    if (betEl._sig !== bsig) {
      betEl._sig = bsig;
      betEl.innerHTML = p.bet > 0 ? chipsHTML(p.bet) + `<span>${fmt(p.bet)}</span>` : '';
    }
  }

  function render() {
    const v = view;
    if (!v) return;
    $('#hand-no').textContent = 'Раздача #' + v.hand;
    $('#blinds').textContent = `Блайнды ${v.sb}/${v.bb}`;
    $('#luck-dot').classList.toggle('on', role === 'host' && S && S.luck !== 'off');

    let winSet = null;
    const r = v.result;
    if (r && r.type === 'showdown' && r.hands) {
      winSet = new Set();
      r.winners.forEach((w) => r.hands[w].best.forEach((c) => winSet.add(c)));
    }
    document.querySelector('.felt').classList.toggle('dim', !!winSet);

    renderSeat('me', v.me, v, winSet);
    renderSeat('op', v.op, v, winSet);

    const board = v.board.slice();
    while (board.length < 5) board.push(null);
    renderCards($('#board'), v.phase === 'lobby' ? [] : board, winSet);

    const potEl = $('#pot');
    const potSig = String(v.pot);
    if (potEl._sig !== potSig) {
      potEl._sig = potSig;
      potEl.innerHTML = v.pot > 0 ? chipsHTML(v.pot) + `Банк: ${fmt(v.pot)}` : '';
    }

    renderResult(v);
    renderControls(v);
    renderOverlay(v);
  }

  function renderResult(v) {
    const el = $('#result');
    const r = v.result;
    const sig = r ? v.hand + JSON.stringify(r) : '';
    if (el._sig === sig) return;
    el._sig = sig;
    if (!r) { el.innerHTML = ''; return; }
    const name = (w) => (w === 'me' ? 'Ты' : v.op.name);
    let title, sub = '';
    if (r.winners.length === 2) {
      title = 'Ничья — банк пополам';
      sub = r.hands ? r.hands.me.name : '';
    } else {
      const w = r.winners[0];
      title = w === 'me' ? `Ты выигрываешь ${fmt(r.pot)}!` : `${name(w)} забирает ${fmt(r.pot)}`;
      if (r.type === 'fold') sub = (w === 'me' ? v.op.name : 'Ты') + ' сбросил' + (w === 'me' ? '(а)' : '') + ' карты';
      else sub = r.hands[w].name;
    }
    const ms = v._deadline ? Math.max(0, v._deadline - Date.now()) : 0;
    el.innerHTML = `<div class="result-box"><b>${title}</b><div>${sub}</div>${ms && v.phase === 'showdown' ? `<div class="next-bar"><i style="animation-duration:${ms}ms"></i></div>` : ''}</div>`;
    if (r.winners.length === 1 && r.winners[0] === 'me' && r.pot >= v.bb * 10) heartRain(14);
  }

  function renderControls(v) {
    const el = $('#controls');
    const L = v.legal;
    let sig;
    if (v.phase === 'betting' && v.toAct === 'me' && L) sig = 'act' + v.hand + JSON.stringify(L);
    else if (v.phase === 'betting') sig = 'wait' + v.toAct + v.op.name;
    else sig = 'idle' + v.phase;
    if (el._sig === sig) return;
    el._sig = sig;

    if (sig.startsWith('wait')) {
      el.innerHTML = `<div class="waiting-turn">${v.toAct === 'op' ? 'Ходит ' + esc(v.op.name) : 'Открываем карты'}<span class="dots"></span></div>`;
      return;
    }
    if (sig.startsWith('idle')) {
      el.innerHTML = v.phase === 'showdown' ? '<div class="waiting-turn">Следующая раздача скоро<span class="dots"></span></div>' : '';
      return;
    }

    let html = '';
    if (L.canRaise) {
      const potAfterCall = L.potTotal + L.toCall;
      const clamp = (x) => Math.max(L.minTo, Math.min(L.maxTo, Math.round(x)));
      const presets = [
        ['Мин', L.minTo],
        ['½ банка', clamp(L.currentBet + potAfterCall / 2)],
        ['Банк', clamp(L.currentBet + potAfterCall)],
        ['Олл-ин', L.maxTo],
      ];
      html += `<div class="raise-row">${presets.map(([t, x]) => `<button class="preset" data-to="${x}">${t}</button>`).join('')}
        <div class="slider-wrap"><input type="range" id="raise-range" min="${L.minTo}" max="${L.maxTo}" step="${Math.max(1, v.sb)}" value="${L.minTo}"><span class="raise-val" id="raise-val">${fmt(L.minTo)}</span></div></div>`;
    }
    html += '<div class="action-row">';
    if (!L.canCheck) html += '<button class="btn btn-red" data-a="fold">Фолд</button>';
    html += L.canCheck
      ? '<button class="btn btn-blue" data-a="check">Чек</button>'
      : `<button class="btn btn-green" data-a="call">${L.toCall >= v.me.stack ? 'Олл-ин' : 'Колл'} ${fmt(L.toCall)}</button>`;
    if (L.canRaise) html += `<button class="btn btn-gold" data-a="raise" id="raise-btn"></button>`;
    html += '</div>';
    el.innerHTML = html;

    const range = $('#raise-range');
    const updateRaise = () => {
      if (!range) return;
      let x = +range.value;
      if (x > L.maxTo - v.sb) x = Math.min(x, L.maxTo);
      $('#raise-val').textContent = fmt(x);
      $('#raise-btn').textContent = x >= L.maxTo ? `Олл-ин ${fmt(x)}` : (L.currentBet === 0 ? 'Бет ' : 'Рейз до ') + fmt(x);
    };
    if (range) range.oninput = updateRaise;
    updateRaise();
    el.querySelectorAll('.preset').forEach((b) => (b.onclick = () => { range.value = b.dataset.to; updateRaise(); }));
    el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      doAction(a, a === 'raise' ? +range.value : 0);
    }));
  }

  function renderOverlay(v) {
    const el = $('#overlay');
    const sig = v.phase === 'gameover' ? 'go' + v.gameWinner : '';
    if (el._sig === sig) return;
    el._sig = sig;
    if (!sig) { el.hidden = true; el.innerHTML = ''; return; }
    const iWon = v.gameWinner === 'me';
    el.innerHTML = `<div class="over-card">
      <div class="big-emo">${iWon ? '🏆' : '💐'}</div>
      <h2>${iWon ? 'Ты победил' + (role === 'guest' ? '(а)' : '') + '!' : esc(v.op.name) + ' побеждает!'}</h2>
      <p>${iWon ? 'Все фишки твои. Ещё партию?' : 'Сегодня удача на её стороне. Реванш?'}</p>
      <button class="btn btn-gold big" id="btn-rematch">Реванш</button></div>`;
    el.hidden = false;
    $('#btn-rematch').onclick = askRematch;
    heartRain(30);
    (iWon ? sfx.win : sfx.lose)();
  }

  // ================= ЭФФЕКТЫ =================
  function floatEmoji(who, e) {
    if (!/^[\p{Extended_Pictographic}‍️]{1,8}$/u.test(e)) return;
    const a = $(`#${who}-avatar`).getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'float-emo';
    d.textContent = e;
    d.style.left = a.left + a.width / 2 + 'px';
    d.style.top = a.top - 10 + 'px';
    d.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    $('#float-layer').appendChild(d);
    setTimeout(() => d.remove(), 2300);
    if (who === 'op') tone(1200, 0.08, 'sine', 0.04);
  }
  function heartRain(n) {
    const set = ['❤️', '💖', '💕', '✨', '♥️', '🌹'];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'heart-fall';
      d.textContent = set[i % set.length];
      d.style.left = Math.random() * 100 + 'vw';
      d.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      d.style.animationDelay = Math.random() * 1.2 + 's';
      d.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
      $('#float-layer').appendChild(d);
      setTimeout(() => d.remove(), 6500);
    }
  }
  let toastT;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 2800);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  $('#emojis').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-e]');
    if (b) sendEmoji(b.dataset.e);
  });
  $('#btn-sound').onclick = () => {
    muted = !muted;
    store.set('pk_mute', muted ? '1' : '0');
    $('#btn-sound').textContent = muted ? '🔇' : '🔊';
  };

  // ================= ПАНЕЛЬ УДАЧИ (только у хозяина) =================
  // Открывается тройным нажатием на «Раздача #…» или на надпись в центре стола, либо Alt+L.
  let taps = [];
  function secretTap() {
    if (role !== 'host') return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 800);
    taps.push(now);
    if (taps.length >= 3) { taps = []; openLuck(); }
  }
  $('#hand-no').addEventListener('click', secretTap);
  $('#emblem').addEventListener('click', secretTap);
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyL') { e.preventDefault(); if (role === 'host') openLuck(); }
    if (e.key === 'Escape') $('#luck-panel').hidden = true;
  });

  function openLuck() {
    const el = $('#luck-panel');
    const nm = esc(S.players[1].name || 'гостя');
    const canNow = S.phase === 'betting' && S.revealed < 5;
    const opt = (m, t, s) => `<button class="luck-opt${S.luck === m ? ' sel' : ''}" data-m="${m}">${t}<small>${s}</small></button>`;
    el.innerHTML = `<h3>🍀 Удача · ${nm}</h3><p>Видишь это только ты.</p>
      ${opt('off', 'Честная игра', 'Обычная случайная раздача')}
      ${opt('next', 'Следующая раздача — её', 'Сильная рука и победа, один раз')}
      ${opt('always', 'Все раздачи — её', 'Пока не выключишь')}
      ${canNow ? `<button class="luck-opt" data-now="1">✨ Эта раздача — её<small>Оставшиеся карты стола сложатся в её пользу</small></button>` : ''}
      <button class="btn btn-small luck-close">Закрыть</button>`;
    el.hidden = false;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
      S.luck = b.dataset.m;
      save();
      render();
      openLuck();
    }));
    const nowBtn = el.querySelector('[data-now]');
    if (nowBtn) nowBtn.onclick = () => {
      const ok = P.luckyBoard(S, 1);
      save();
      nowBtn.innerHTML = ok ? '✓ Готово<small>Карты стола переложены</small>' : 'Не получилось<small>Слишком поздно для этой раздачи</small>';
      nowBtn.disabled = true;
    };
    el.querySelector('.luck-close').onclick = () => (el.hidden = true);
  }

  init();
})();
