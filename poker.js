// Движок техасского холдема один на один.
// Вся логика выполняется только у хозяина стола; гость получает лишь «вид» со своими картами.
(function () {
  const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const HAND_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Тройка', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш'];
  const B5 = 13 ** 5;

  // ---------- карты ----------
  const rank = (c) => c >> 2;
  const suit = (c) => c & 3;
  const isRed = (c) => suit(c) === 1 || suit(c) === 2;

  function randInt(n) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const freshDeck = () => shuffle([...Array(52).keys()]);

  // ---------- оценка руки ----------
  function eval5(c) {
    const r = c.map(rank).sort((a, b) => b - a);
    const flush = c.every((x) => suit(x) === suit(c[0]));
    let straightHigh = -1;
    if (new Set(r).size === 5) {
      if (r[0] - r[4] === 4) straightHigh = r[0];
      else if (r[0] === 12 && r[1] === 3) straightHigh = 3; // A-2-3-4-5
    }
    const cnt = {};
    r.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1));
    const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
    const counts = groups.map((g) => cnt[g]);
    let cat, tb;
    if (straightHigh >= 0 && flush) { cat = 8; tb = [straightHigh]; }
    else if (counts[0] === 4) { cat = 7; tb = groups; }
    else if (counts[0] === 3 && counts[1] === 2) { cat = 6; tb = groups; }
    else if (flush) { cat = 5; tb = r; }
    else if (straightHigh >= 0) { cat = 4; tb = [straightHigh]; }
    else if (counts[0] === 3) { cat = 3; tb = groups; }
    else if (counts[0] === 2 && counts[1] === 2) { cat = 2; tb = groups; }
    else if (counts[0] === 2) { cat = 1; tb = groups; }
    else { cat = 0; tb = r; }
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 13 + (tb[i] || 0);
    return s;
  }

  const COMBOS = {};
  function combos(n) {
    if (COMBOS[n]) return COMBOS[n];
    const out = [];
    const rec = (start, acc) => {
      if (acc.length === 5) return out.push(acc.slice());
      for (let i = start; i < n; i++) { acc.push(i); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return (COMBOS[n] = out);
  }

  function evalBest(cards) {
    let best = -1, bestIdx = null;
    for (const idx of combos(cards.length)) {
      const s = eval5(idx.map((i) => cards[i]));
      if (s > best) { best = s; bestIdx = idx; }
    }
    const cat = Math.floor(best / B5);
    const top = Math.floor(best / 13 ** 4) % 13;
    const name = cat === 8 && top === 12 ? HAND_NAMES[9] : HAND_NAMES[cat];
    return { score: best, cat, name, best: bestIdx.map((i) => cards[i]) };
  }

  // ---------- «удачная» раскладка ----------
  function pickTarget() {
    // две пары, тройка, стрит, флеш, фулл-хаус — чтобы выглядело естественно
    const pool = [2, 2, 3, 3, 4, 4, 5, 5, 6];
    return pool[randInt(pool.length)];
  }

  function scoreLucky(F, O, B, target) {
    const ef = evalBest(F.concat(B)), eo = evalBest(O.concat(B));
    if (ef.score <= eo.score) return -1;
    let s = 20 - Math.abs(ef.cat - target) * 4;
    s += Math.min(eo.cat, 3) * 2; // у соперника тоже что-то есть — будет экшн
    if (B.length === 5) {
      const ff = evalBest(F.concat(B.slice(0, 3))), of = evalBest(O.concat(B.slice(0, 3)));
      if (ff.score > of.score) s += 3;
    }
    if (ef.cat >= 8) s -= 8;
    return s + Math.random() * 3;
  }

  function luckyDeck(fav) {
    const target = pickTarget();
    let best = null, bs = -1;
    for (let i = 0; i < 1500; i++) {
      const d = freshDeck();
      const F = fav === 1 ? [d[2], d[3]] : [d[0], d[1]];
      const O = fav === 1 ? [d[0], d[1]] : [d[2], d[3]];
      let s = scoreLucky(F, O, d.slice(4, 9), target);
      if (s < 0) continue;
      if (rank(F[0]) === rank(F[1])) s += 2;
      if (Math.max(rank(F[0]), rank(F[1])) >= 9) s += 1;
      if (s > bs) { bs = s; best = d; }
    }
    return best || freshDeck();
  }

  // Переложить ещё не открытые карты стола так, чтобы fav выиграл текущую раздачу
  function luckyBoard(S, fav) {
    if (S.phase !== 'betting' || S.revealed >= 5) return false;
    const fixed = S.board.slice(0, S.revealed);
    const used = new Set([...S.players[0].cards, ...S.players[1].cards, ...fixed]);
    const rest = [...Array(52).keys()].filter((c) => !used.has(c));
    const F = S.players[fav].cards, O = S.players[1 - fav].cards;
    const target = pickTarget();
    let best = null, bs = -1;
    for (let i = 0; i < 2500; i++) {
      shuffle(rest);
      const B = fixed.concat(rest.slice(0, 5 - fixed.length));
      const s = scoreLucky(F, O, B, target);
      if (s > bs) { bs = s; best = B; }
    }
    if (!best) return false;
    S.board = best;
    return true;
  }

  // ---------- состояние игры ----------
  function newGame(cfg) {
    return {
      cfg,
      players: [
        { name: cfg.hostName, stack: cfg.stack, cards: [] },
        { name: '', stack: cfg.stack, cards: [] },
      ],
      dealer: 1, hand: 0, phase: 'lobby', board: [], revealed: 0, street: 0,
      toAct: -1, currentBet: 0, minRaise: cfg.bb, runout: false, result: null,
      nextAt: 0, luck: 'off',
    };
  }

  function post(S, seat, amt) {
    const p = S.players[seat];
    const a = Math.max(0, Math.min(amt, p.stack));
    p.stack -= a; p.bet += a; p.totalIn += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  function startHand(S) {
    S.result = null; S.runout = false; S.nextAt = 0;
    if (S.players.some((p) => p.stack <= 0)) { S.phase = 'gameover'; return; }
    S.players.forEach((p) => Object.assign(p, { cards: [], bet: 0, totalIn: 0, folded: false, allIn: false, acted: false, last: '' }));
    S.hand++;
    S.dealer = 1 - S.dealer;
    const deck = S.luck !== 'off' ? luckyDeck(1) : freshDeck();
    if (S.luck === 'next') S.luck = 'off';
    S.players[0].cards = [deck[0], deck[1]];
    S.players[1].cards = [deck[2], deck[3]];
    S.board = deck.slice(4, 9);
    S.revealed = 0; S.street = 0;
    const sb = S.dealer, bb = 1 - S.dealer;
    post(S, sb, S.cfg.sb);
    post(S, bb, S.cfg.bb);
    S.currentBet = Math.max(S.players[0].bet, S.players[1].bet);
    S.minRaise = S.cfg.bb;
    S.phase = 'betting';
    progress(S, sb);
  }

  const notDone = (S) => [0, 1].filter((i) => {
    const p = S.players[i];
    return !p.folded && !(p.allIn || (p.acted && p.bet === S.currentBet));
  });

  function progress(S, preferred) {
    const live = [0, 1].filter((i) => !S.players[i].folded);
    if (live.length === 1) return winByFold(S, live[0]);
    const nd = notDone(S);
    if (nd.length) { S.toAct = nd.includes(preferred) ? preferred : nd[0]; return; }
    endStreet(S);
  }

  function endStreet(S) {
    S.players.forEach((p) => { p.bet = 0; p.acted = false; });
    S.currentBet = 0; S.minRaise = S.cfg.bb;
    const canBet = S.players.every((p) => !p.allIn);
    if (!canBet) { S.toAct = -1; S.runout = true; return; } // карты откроются по таймеру
    revealNext(S);
    if (S.phase === 'betting') {
      S.toAct = 1 - S.dealer;
      S.players.forEach((p) => (p.last = ''));
    }
  }

  function revealNext(S) {
    if (S.street >= 3) return showdown(S);
    S.street++;
    S.revealed = [0, 3, 4, 5][S.street];
  }

  function showdown(S) {
    S.revealed = 5; S.toAct = -1;
    const e = S.players.map((p) => evalBest(p.cards.concat(S.board)));
    const m = Math.min(S.players[0].totalIn, S.players[1].totalIn);
    S.players.forEach((p) => { if (p.totalIn > m) p.stack += p.totalIn - m; });
    const pot = 2 * m;
    let winners;
    if (e[0].score > e[1].score) winners = [0];
    else if (e[1].score > e[0].score) winners = [1];
    else winners = [0, 1];
    if (winners.length === 1) S.players[winners[0]].stack += pot;
    else {
      const half = Math.floor(pot / 2);
      S.players[S.dealer].stack += half;
      S.players[1 - S.dealer].stack += pot - half;
    }
    S.players.forEach((p, i) => (p.last = e[i].name));
    S.result = { type: 'showdown', winners, pot, hands: e.map((x) => ({ name: x.name, best: x.best })) };
    S.phase = 'showdown';
  }

  function winByFold(S, w) {
    const pot = S.players[0].totalIn + S.players[1].totalIn;
    S.players[w].stack += pot;
    S.toAct = -1;
    S.result = { type: 'fold', winners: [w], pot };
    S.phase = 'showdown';
  }

  function act(S, seat, type, amt) {
    if (S.phase !== 'betting' || S.toAct !== seat) return false;
    const p = S.players[seat], o = S.players[1 - seat];
    const toCall = S.currentBet - p.bet;
    switch (type) {
      case 'fold':
        p.folded = true; p.last = 'Фолд';
        break;
      case 'check':
        if (toCall > 0) return false;
        p.last = 'Чек';
        break;
      case 'call': {
        if (toCall <= 0) return false;
        const a = post(S, seat, toCall);
        p.last = p.allIn ? 'Олл-ин ' + fmt(a) : 'Колл ' + fmt(a);
        break;
      }
      case 'raise': {
        if (o.allIn || p.stack <= toCall) return false;
        const maxTo = p.bet + p.stack;
        const to = Math.min(Math.max(Math.floor(+amt || 0), S.currentBet + S.minRaise), maxTo);
        const wasOpen = S.currentBet === 0;
        const size = to - S.currentBet;
        if (size >= S.minRaise) S.minRaise = size;
        S.currentBet = to;
        post(S, seat, to - p.bet);
        o.acted = false;
        p.last = p.allIn ? 'Олл-ин ' + fmt(to) : (wasOpen ? 'Бет ' : 'Рейз до ') + fmt(to);
        break;
      }
      default:
        return false;
    }
    p.acted = true;
    progress(S, 1 - seat);
    return true;
  }

  function rematch(S) {
    S.players.forEach((p) => (p.stack = S.cfg.stack));
    S.dealer = 1;
    startHand(S);
  }

  // ---------- вид для конкретного игрока ----------
  function viewFor(S, seat) {
    const rel = (i) => (i < 0 ? null : i === seat ? 'me' : 'op');
    const reveal = S.runout || (S.result && S.result.type === 'showdown');
    const pv = (i) => {
      const p = S.players[i];
      const has = p.cards && p.cards.length;
      return {
        name: p.name, stack: p.stack, bet: p.bet || 0, folded: !!p.folded, allIn: !!p.allIn,
        last: p.last || '', dealer: S.dealer === i && S.phase !== 'lobby',
        cards: !has ? [] : i === seat || (reveal && !p.folded) ? p.cards.slice() : [-1, -1],
      };
    };
    const me = S.players[seat];
    const totalIn = S.players.reduce((a, p) => a + (p.totalIn || 0), 0);
    const bets = S.players.reduce((a, p) => a + (p.bet || 0), 0);
    let legal = null;
    if (S.phase === 'betting' && S.toAct === seat) {
      const op = S.players[1 - seat];
      const toCall = Math.max(0, S.currentBet - me.bet);
      const maxTo = me.bet + me.stack;
      legal = {
        toCall: Math.min(toCall, me.stack), canCheck: toCall === 0,
        canRaise: !op.allIn && me.stack > toCall,
        minTo: Math.min(S.currentBet + S.minRaise, maxTo), maxTo,
        currentBet: S.currentBet, potTotal: totalIn, myBet: me.bet,
      };
    }
    let result = null;
    if (S.result) {
      const r = S.result;
      result = {
        type: r.type, pot: r.pot, winners: r.winners.map(rel),
        hands: r.hands ? { me: r.hands[seat], op: r.hands[1 - seat] } : null,
      };
    }
    return {
      phase: S.phase, hand: S.hand, sb: S.cfg.sb, bb: S.cfg.bb, street: S.street,
      board: S.board.slice(0, S.revealed), pot: totalIn - bets, me: pv(seat), op: pv(1 - seat),
      toAct: S.phase === 'betting' && S.toAct >= 0 ? rel(S.toAct) : null,
      legal, result, nextIn: S.nextAt ? Math.max(0, S.nextAt - Date.now()) : 0,
      gameWinner: S.phase === 'gameover' ? rel(S.players[0].stack > 0 ? 0 : 1) : null,
    };
  }

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  window.Poker = {
    RANK_LABEL, SUITS, rank, suit, isRed, fmt,
    newGame, startHand, act, revealNext, rematch, viewFor, luckyBoard,
  };
})();
