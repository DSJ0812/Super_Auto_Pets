'use strict';
/* ============================================================
 *  online.js — 联机（服务端权威）对局流程    【服务器专用】
 *
 *  和 melee.js 的关系：
 *   · melee.js 是单机 8 人混战，写死了「1 个人类 + 7 个 AI」
 *     （this.human = fighters[0]、isHuman 布尔、report.humanLog 单数）
 *   · 联机里 8 个座位都可能是「真人(remote)」或「AI」，还需要
 *     「等所有人结束回合」的门控 —— 语义不同，所以流程单独写
 *
 *  但能复用的全部复用，绝不复刻规则：
 *   · Game                     商店 / 经济 / 合并 / 遗物   （game.js）
 *   · runBattle + 遗物开战效果   战斗                      （engine.js / relics.js）
 *   · Melee.prototype.aiShop   AI 经营（⚠️ 它不使用 this，可以直接借）
 *   · MELEE_CFG                血量 / 扣血曲线 / AI 性格区间（数值只改一处）
 *   · Melee.prototype.pairUp   洗牌 + 两两分组（⚠️ 它只使用 this.alive()）
 * ============================================================ */

let __token = 0;
function makeToken() {
  __token++;
  return 'p' + __token + '-' + Math.random().toString(36).slice(2, 8);
}

/* ------------------------------------------------------------
 *  一个座位
 * ---------------------------------------------------------- */
function Seat(idx) {
  this.idx = idx;
  this.kind = 'empty';        // empty | remote | ai
  this.token = null;          // 真人的凭证（也用于刷新后重连）
  this.name = '';
  this.connected = false;
  this.ready = false;         // 商店阶段：是否点了「结束回合」
  this.acked = false;         // 战斗阶段：是否点了「进入下一回合」

  this.hp = MELEE_CFG.BASE_HP;
  this.alive = true;
  this.rank = 0;
  this.streak = 0;
  this.greed = 1;             // AI 性格，复用 melee.js 的 aiShop
  this.game = null;
}

/* ------------------------------------------------------------
 *  对局
 * ---------------------------------------------------------- */
function OnlineGame() {
  CFG.ECONOMY = 'tft';                       // 联机走 8 人混战那套经济
  this.seats = [];
  for (let i = 0; i < MELEE_CFG.COUNT; i++) this.seats.push(new Seat(i));
  this.turn = 1;
  this.phase = 'lobby';                      // lobby | shop | battle | over
  this.seed = null;                          // 由服务器填（界面上显示、便于复现）
  this.seq = 0;
  this.events = [];
  this.lastBattleBySeat = {};                // 刷新/重连时能重放自己的那一场
  this.splitSeq = 0;                         // 上次「开场」时的事件序号（新加入的人从这里开始收）
}

OnlineGame.prototype.aliveSeats = function () {
  return this.seats.filter(function (s) { return s.alive; });
};
OnlineGame.prototype.remoteSeats = function () {
  return this.seats.filter(function (s) { return s.kind === 'remote'; });
};
OnlineGame.prototype.onlineRemoteSeats = function () {
  return this.seats.filter(function (s) { return s.kind === 'remote' && s.connected; });
};
OnlineGame.prototype.seatByToken = function (token) {
  for (const s of this.seats) if (s.token && s.token === token) return s;
  return null;
};

/* ---- 事件流（客户端用 seq 增量拉取）---- */
OnlineGame.prototype.emit = function (to, data) {
  this.seq++;
  this.events.push({ seq: this.seq, to: to, data: data });
  if (this.events.length > 800) this.events.splice(0, this.events.length - 800);
};
OnlineGame.prototype.emitAll = function (data) { this.emit(null, data); };

/* 取某个座位该收到的事件（to === null 是广播） */
OnlineGame.prototype.eventsSince = function (seatIdx, since) {
  const out = [];
  for (const ev of this.events) {
    if (ev.seq <= since) continue;
    if (ev.to === null || ev.to === seatIdx) out.push(ev);
  }
  return out;
};

/* ------------------------------------------------------------
 *  大厅
 * ---------------------------------------------------------- */
OnlineGame.prototype.roster = function () { return rosterOf(this.seats); };

OnlineGame.prototype.lobbyState = function () {
  return {
    t: 'lobby',
    phase: this.phase,
    seats: MELEE_CFG.COUNT,
    players: this.remoteSeats().map(function (s) {
      return { seat: s.idx, name: s.name, connected: !!s.connected };
    })
  };
};
OnlineGame.prototype.pushLobby = function () { this.emitAll(this.lobbyState()); };

/* 名字去重：两个「小明」会变成「小明」和「小明(2)」 */
function uniqueName(seats, want, selfIdx) {
  let name = want;
  let n = 2;
  for (;;) {
    const clash = seats.some(function (s) {
      return s.idx !== selfIdx && s.name === name;
    });
    if (!clash) return name;
    name = want + '(' + n + ')';
    n++;
  }
}

OnlineGame.prototype.addPlayer = function (wantName) {
  if (this.phase !== 'lobby') return { ok: false, msg: '这一局已经开始了，等下一局吧' };
  let seat = null;
  for (const s of this.seats) if (s.kind === 'empty') { seat = s; break; }
  if (!seat) return { ok: false, msg: '房间满了（最多 ' + MELEE_CFG.COUNT + ' 人）' };

  const raw = String(wantName == null ? '' : wantName).trim().slice(0, 12);
  seat.kind = 'remote';
  seat.name = uniqueName(this.seats, raw || ('玩家' + (seat.idx + 1)), seat.idx);
  seat.token = makeToken();
  seat.connected = true;
  seat.ready = false;

  this.pushLobby();
  return { ok: true, token: seat.token, seat: seat.idx, name: seat.name };
};

/* 刷新页面 / 掉线重连：凭证在 localStorage，服务器保留座位 */
OnlineGame.prototype.rejoin = function (token) {
  const seat = this.seatByToken(token);
  if (!seat || seat.kind !== 'remote') return { ok: false, msg: '找不到你的座位（可能房间已重置）' };
  seat.connected = true;
  this.pushLobby();
  return { ok: true, seat: seat.idx, name: seat.name, snapshot: this.snapshot(seat) };
};

OnlineGame.prototype.setConnected = function (token, v) {
  const seat = this.seatByToken(token);
  if (!seat) return;
  seat.connected = !!v;
  this.pushLobby();
  // 有人掉线可能让「等所有人」的门槛变得可满足
  if (this.phase === 'shop') this.tryResolve();
  if (this.phase === 'battle') this.checkAdvance();
};

/* ------------------------------------------------------------
 *  开局
 * ---------------------------------------------------------- */
OnlineGame.prototype.start = function () {
  if (this.phase !== 'lobby') return { ok: false, msg: '已经开始了' };
  const humans = this.remoteSeats();
  if (!humans.length) return { ok: false, msg: '还没有人加入房间' };

  for (const s of this.seats) {
    if (s.kind === 'empty') {
      s.kind = 'ai';
      // 索引 0 的默认名是「你」，AI 用不了，换成「电脑」
      const nm = MELEE_CFG.NAMES[s.idx] || ('电脑' + (s.idx + 1));
      s.name = uniqueName(this.seats, nm === '你' ? '电脑' : nm, s.idx);
      s.greed = MELEE_CFG.AI_GREED_RANGE[0] +
                RNG.next() * (MELEE_CFG.AI_GREED_RANGE[1] - MELEE_CFG.AI_GREED_RANGE[0]);
    }
    s.game = new Game();
    s.game.gold = 0;
    s.game.turn = 1;
    s.game.streak = 0;
  }
  this.turn = 1;
  this.phase = 'shop';
  this.splitSeq = this.seq;         // 新加入的人从这一刻开始收事件
  this.emitAll({ t: 'started', seats: MELEE_CFG.COUNT, seed: this.seed });
  this.startTurn();
  return { ok: true };
};

/* ---- 回合开始（对应 melee.js 的 startTurn）---- */
OnlineGame.prototype.startTurn = function () {
  for (const s of this.seats) {
    if (!s.alive || !s.game) continue;
    const g = s.game;
    const up = g.setTurn(this.turn);   // 顺带拿到商店等级有没有提升
    g.streak = s.streak;
    g.grantIncome();
    g.phase = 'shop';
    g.pendingFood = null;
    g.foodDiscount = 0;
    g.rollsThisTurn = 0;
    g.rollShop(false);
    g.triggerTurnStart();
    if (up.upgraded) g.triggerShopTierUp(up.after);
    g.offerRelicChoice();
    if (s.kind === 'ai' && g.pendingRelicChoice && g.pendingRelicChoice.length) {
      const ids = g.pendingRelicChoice;
      g.pickRelic(RNG.pick(ids));
    }
    s.ready = (s.kind === 'ai');     // AI 视为已准备
    s.acked = (s.kind === 'ai');
  }
  this.phase = 'shop';
  const roster = this.roster();
  for (const s of this.onlineRemoteSeats()) {
    this.emit(s.idx, {
      t: 'turn', turn: this.turn, phase: 'shop',
      roster: roster, you: packSelf(s.game, s)
    });
  }
};

/* ------------------------------------------------------------
 *  玩家操作
 * ---------------------------------------------------------- */
OnlineGame.prototype.action = function (token, a) {
  const seat = this.seatByToken(token);
  if (!seat) return { ok: false, msg: '你不在这个房间里' };
  if (seat.kind !== 'remote') return { ok: false, msg: '无效的座位' };

  const type = a && a.type;

  // 房主强制推进：任何阶段都能用（包括自己已出局、纯观战时）
  if (type === 'forceResolve') return this.forceResolve(seat);
  // 战斗阶段只接受「进入下一回合」
  if (this.phase === 'battle') {
    if (type === 'nextTurn') return this.ackBattle(seat);
    return { ok: false, msg: '战斗结算中，等回放结束' };
  }
  if (this.phase !== 'shop') return { ok: false, msg: '现在不是商店阶段' };
  if (!seat.alive) return { ok: false, msg: '你已经出局了，可以继续观战' };

  const g = seat.game;
  let r;
  switch (type) {
    case 'buyPet':    r = g.buyPet(a.slot, a.to); break;
    case 'sellPet':   r = g.sellPet(a.idx); break;
    case 'movePet':   g.movePet(a.from, a.to); r = { ok: true, msg: '' }; break;
    case 'roll':      r = g.roll(); break;
    case 'freezePet': g.toggleFreezePet(a.i); r = { ok: true, msg: '' }; break;
    case 'freezeFood':g.toggleFreezeFood(a.i); r = { ok: true, msg: '' }; break;
    case 'buyFood':   r = g.buyFood(a.slot); break;
    case 'applyFood': r = g.applyFood(a.idx); break;
    case 'pickRelic': r = g.pickRelic(a.id); break;
    case 'ready':     return this.setReady(seat, true);
    case 'unready':   return this.setReady(seat, false);
    default:          r = { ok: false, msg: '未知操作：' + type };
  }

  // 操作后立刻把「自己那份」回给本人（局域网延迟可忽略，商店手感依然即时）
  if (r.ok) {
    this.emit(seat.idx, {
      t: 'self', you: packSelf(g, seat), roster: this.roster()
    });
    // 其他人只需要知道「准备状态 / 队伍规模」变了
    this.emitAll({ t: 'roster', roster: this.roster() });
  }
  return r;
};

OnlineGame.prototype.setReady = function (seat, v) {
  const g = seat.game;
  if (v) {
    if (!g.team.length) return { ok: false, msg: '队伍是空的，先买宠物' };
    if (g.pendingFood != null) return { ok: false, msg: '先选一只宠物用掉道具' };
    if (g.pendingRelicChoice && g.pendingRelicChoice.length) return { ok: false, msg: '先选一件遗物' };
  }
  seat.ready = !!v;
  this.emit(seat.idx, { t: 'self', you: packSelf(g, seat), roster: this.roster() });
  this.emitAll({ t: 'roster', roster: this.roster() });
  if (v) this.tryResolve();
  return { ok: true, msg: v ? '已结束回合，等其他人…' : '已取消' };
};

/* 所有在世的真人都点了「结束回合」→ 结算 */
OnlineGame.prototype.tryResolve = function () {
  if (this.phase !== 'shop') return false;
  const pending = this.seats.filter(function (s) {
    return s.kind === 'remote' && s.alive && s.connected && !s.ready;
  });
  if (pending.length) return false;
  this.resolveTurn();
  return true;
};

/* ---- 房主强制推进（有人挂机/不点结束回合时的唯一出路）----
 * 商店阶段：替没准备的人用 AI 打完这一回合，然后结算
 * 战斗阶段：直接进下一回合 */
OnlineGame.prototype.forceResolve = function (seat) {
  const host = this.remoteSeats()[0];
  if (!host || host.idx !== seat.idx) return { ok: false, msg: '只有房主能强制推进' };

  if (this.phase === 'battle') {
    for (const s of this.seats) if (s.kind === 'remote') s.acked = true;
    this.checkAdvance();
    return { ok: true, msg: '已强制进入下一回合' };
  }
  if (this.phase === 'over') return { ok: false, msg: '这一局已经结束了' };
  if (this.phase !== 'shop') return { ok: false, msg: '现在不能推进' };

  const skipped = [];
  for (const s of this.seats) {
    if (s.kind !== 'remote' || !s.alive || s.ready) continue;
    // 队伍是空的就替他买几只，免得空着上场
    if (s.game && !s.game.team.length) Melee.prototype.aiShop(s);
    s.ready = true;
    skipped.push(s.name);
  }
  this.emitAll({ t: 'roster', roster: this.roster() });
  this.resolveTurn();
  return { ok: true, msg: skipped.length ? ('已替 ' + skipped.join('、') + ' 结束回合') : '已推进' };
};

/* ------------------------------------------------------------
 *  结算一个回合：AI 经营 → 配对 → 战斗 → 扣血 → 淘汰
 * ---------------------------------------------------------- */
OnlineGame.prototype.resolveTurn = function () {
  if (this.phase !== 'shop') return;
  const self = this;

  // 1) AI 座位各自经营（直接借用 melee.js 的 AI：它不使用 this）
  for (const s of this.seats) {
    if (s.kind === 'ai' && s.alive && s.game) Melee.prototype.aiShop(s);
  }

  // 2) 配对（直接借用 melee.js 的洗牌 + 两两分组：它只使用 this.alive()）
  const pairing = Melee.prototype.pairUp.call({
    alive: function () { return self.aliveSeats(); }
  });

  // 3) 开打
  const summaries = [];
  const replays = [];        // { you, foe, mine, foeTeam, res, isA }
  for (const pair of pairing.pairs) {
    const a = pair[0], b = pair[1];
    const aTeam = a.game.team.map(clonePet);
    const bTeam = b.game.team.map(clonePet);
    applyRelicBattleStart(a.game, aTeam, bTeam);
    applyRelicBattleStart(b.game, bTeam, aTeam);
    const res = runBattle(aTeam, bTeam, { tier: a.game.getShopTier(), rolls: a.game.rollsThisTurn || 0 });

    let win = null, lose = null;
    if (res.winner === 0)      { win = a; lose = b; }
    else if (res.winner === 1) { win = b; lose = a; }

    let dmg = 0, survivors = 0;
    if (lose) {
      survivors = (lose === a ? res.final[1] : res.final[0]).length;
      dmg = MELEE_CFG.dmgBase(this.turn) + survivors * MELEE_CFG.dmgPerUnit;
      lose.hp -= dmg;
      lose.streak = lose.streak > 0 ? -1 : lose.streak - 1;
      win.streak  = win.streak  < 0 ? 1 : win.streak + 1;
    }

    const m = {
      a: a.idx, b: b.idx, aName: a.name, bName: b.name,
      winner: res.winner, dmg: dmg, survivors: survivors,
      loserIdx: lose ? lose.idx : null
    };
    summaries.push(m);
    replays.push({ you: a, foe: b, mine: aTeam, theirs: bTeam, res: res, isA: true });
    replays.push({ you: b, foe: a, mine: bTeam, theirs: aTeam, res: res, isA: false });
  }

  // 轮空：不掉血也不算连胜
  if (pairing.bye) {
    summaries.push({
      a: pairing.bye.idx, b: -1,
      aName: pairing.bye.name, bName: '轮空',
      winner: 'bye', dmg: 0, survivors: 0, loserIdx: null
    });
  }

  // 4) 淘汰判定
  const dead = [];
  for (const s of this.seats) {
    if (s.alive && s.hp <= 0) { s.alive = false; s.hp = 0; dead.push(s); }
  }
  const stillAlive = this.aliveSeats().length;
  dead.forEach(function (s, i) {
    s.rank = stillAlive + dead.length - i;    // 越早出局名次越低
  });

  // 5) 结束判定：只剩一人，或者真人都出局了
  const left = this.aliveSeats();
  let over = false;
  if (left.length <= 1) {
    if (left.length === 1) left[0].rank = 1;
    over = true;
  } else if (!left.some(function (s) { return s.kind === 'remote'; })) {
    over = true;
  }

  // 真人都出局时场上可能还剩好几个电脑 —— 不给它们名次的话，
  // 结算面板上就会是一排「–」。按剩余血量从高到低补名次（TFT 就是这么排的）
  if (over) {
    const rest = left.filter(function (s) { return !s.rank; })
      .sort(function (a, b) { return b.hp - a.hp; });
    rest.forEach(function (s, i) { s.rank = i + 1; });
  }

  this.phase = over ? 'over' : 'battle';

  for (const s of this.seats) s.acked = (s.kind === 'ai');
  this.lastBattleBySeat = {};

  // 6) 广播
  const roster = this.roster();
  for (const rp of replays) {
    if (rp.you.kind !== 'remote') continue;
    const winFlag = (rp.res.winner === 'draw') ? 'draw'
      : ((rp.isA ? rp.res.winner === 0 : rp.res.winner === 1) ? 0 : 1);
    const payload = {
      t: 'battle',
      turn: this.turn,
      over: over,
      matches: summaries,
      you: {
        seat: rp.you.idx,
        isA: rp.isA,
        log: rp.res.log,
        mine: rp.mine.map(petToJSON),
        foe: rp.theirs.map(petToJSON),
        foeName: rp.foe.name,
        winner: winFlag
      },
      roster: roster
    };
    this.lastBattleBySeat[rp.you.idx] = payload;
    this.emit(rp.you.idx, payload);
  }
  // 轮空的真人也要收到一份（否则他卡在「等别人」）
  const played = {};
  for (const rp of replays) played[rp.you.idx] = true;
  for (const s of this.onlineRemoteSeats()) {
    if (played[s.idx]) continue;
    // out = 已经出局在观战（和「轮空」是两回事，不能让出局的人看到「轮空不掉血」）
    const payload = {
      t: 'battle', turn: this.turn, over: over, matches: summaries,
      you: {
        seat: s.idx, bye: true, out: !s.alive, winner: 'bye',
        log: [], mine: [], foe: [], foeName: '轮空'
      },
      roster: roster
    };
    this.lastBattleBySeat[s.idx] = payload;
    this.emit(s.idx, payload);
  }

  if (over) {
    this.emitAll({ t: 'over', roster: roster });
  }
};

/* ---- 战斗阶段：等所有在线真人点了「进入下一回合」 ---- */
OnlineGame.prototype.ackBattle = function (seat) {
  seat.acked = true;
  this.checkAdvance();
  return { ok: true, msg: '' };
};
OnlineGame.prototype.checkAdvance = function () {
  if (this.phase !== 'battle') return;
  const pending = this.seats.filter(function (s) {
    return s.kind === 'remote' && s.connected && !s.acked;
  });
  if (pending.length) return;
  this.advance();
};
OnlineGame.prototype.advance = function () {
  if (this.phase !== 'battle') return;
  this.turn++;
  for (const s of this.seats) s.acked = false;
  this.startTurn();
};

/* ------------------------------------------------------------
 *  快照（首次进入 / 刷新重连）
 * ---------------------------------------------------------- */
OnlineGame.prototype.snapshot = function (seat) {
  return {
    t: 'snapshot',
    phase: this.phase,
    turn: this.turn,
    roster: this.roster(),
    you: seat.game ? packSelf(seat.game, seat) : null,
    lastBattle: this.lastBattleBySeat[seat.idx] || null,
    lobby: this.lobbyState()
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OnlineGame: OnlineGame, Seat: Seat };
}
