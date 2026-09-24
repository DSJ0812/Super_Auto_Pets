'use strict';
/* ============================================================
 *  playback.js — 战斗回放器（经典/混战/联机三种界面共用）
 *
 *  引擎吐出的是一串【有序事件】，这里把它逐条应用到一份「展示镜像」
 *  上并重绘。既然三种模式的战斗表现完全一样，就只该有一份实现。
 *
 *  设计要点：
 *   · 状态（view / log / idx / timer）由调用方传进来托管，
 *     这样各界面自己的状态对象仍然持有回放进度，便于外部查询与测试
 *   · DOM 元素通过选择器注入，各页面用自己的 id
 * ============================================================ */

/* 把宠物复制成「展示用」的镜像（只读，不会被写回真实队伍） */
function battleCloneView(p, side) {
  return {
    uid: p.uid,
    defId: p.defId,
    def: p.def,
    lvl: p.lvl,
    atk: p.atk,
    hp: p.hp,
    maxHp: p.hp,        // 开战时的生命 —— 血条以它为满值
    perks: (p.perks || []).map(function (x) { return { id: x.id, uses: x.uses }; }),
    side: side
  };
}

/* 在展示镜像里按 uid 找宠物
 * ⚠️ view 的结构是 { mine, foe }，不是数组，不能写成 view[0]/view[1] */
function battleFind(view, uid) {
  if (!view) return null;
  for (const p of view.mine) if (p.uid === uid) return { pet: p, side: 0 };
  for (const p of view.foe)  if (p.uid === uid) return { pet: p, side: 1 };
  return null;
}

/* 把展示镜像里某个 uid 的宠物移动到新位置（推位事件用） */
function battleMoveTo(view, uid, to) {
  if (!view) return;
  for (const key of ['mine', 'foe']) {
    const arr = view[key];
    const i = arr.findIndex(function (p) { return p.uid === uid; });
    if (i < 0) continue;
    const pet = arr.splice(i, 1)[0];
    arr.splice(Math.max(0, Math.min(to, arr.length)), 0, pet);
    return;
  }
}

/* ------------------------------------------------------------
 *  回放器
 *  opt = {
 *    mine, foe, label, skip, next, shopView, battleView,   // 选择器
 *    speedMul: function () { return 1; },                  // 速度倍率（可动态变）
 *    baseDelay: 420,
 *    onFinish: function (winner) {}                        // 结束时回调（设置按钮等）
 *  }
 * ---------------------------------------------------------- */
function BattlePlayer(opt) {
  this.el = opt;
  this.state = null;
  this.timer = null;
  this._hi = null;
}

BattlePlayer.prototype.$ = function (sel) { return sel ? $(sel) : null; };
BattlePlayer.prototype.speed = function () {
  const f = this.el.speedMul;
  const v = (typeof f === 'function') ? f() : (f || 1);
  return (typeof v === 'number' && v > 0) ? v : 1;
};

/* markDeadIfZero 在 render.js 里（三种模式共用） */

/* 开始回放
 *  state  各界面自己的状态对象（会被写入 view / log / idx / timer / mySide）
 *  log    引擎事件日志
 *  mine   我方开战前队伍（原始宠物对象）
 *  foe    对手开战前队伍
 *  label  开场文案
 *  opts.mySide  我方在【引擎】里是 side 0 还是 side 1（默认 0）
 *               ⚠️ 8 人混战/联机的配对里，玩家可能是 b 方（引擎 side 1）。
 *                  引擎的 summon 事件是按 side 决定插到哪一边的，不做这个
 *                  翻译的话，我方的召唤物会被插到【对手】那一侧；
 *                  胜负判定（winner 0/1）也会反过来说。 */
BattlePlayer.prototype.start = function (state, log, mine, foe, label, opts) {
  this.state = state;
  const mySide = (opts && opts.mySide != null) ? opts.mySide : 0;
  state.mySide = mySide;
  state.log = log || [];
  state.idx = 0;
  state.view = {
    mine: (mine || []).map(function (p) { return battleCloneView(p, mySide); }),
    foe:  (foe  || []).map(function (p) { return battleCloneView(p, 1 - mySide); })
  };
  this._hi = null;
  // 日志跑完时 step() 会调 finish()（不带参数），所以把胜负先存起来。
  // ⚠️ winner 一律是【引擎视角】的 0/1，由 finish() 按 mySide 翻译成「我赢/我输」。
  if (opts && opts.winner != null) this._defaultWinner = opts.winner;

  const sv = this.$(this.el.shopView);
  const bv = this.$(this.el.battleView);
  if (sv) sv.style.display = 'none';
  if (bv) bv.style.display = '';
  const sk = this.$(this.el.skip);
  const nx = this.$(this.el.next);
  if (sk) sk.style.display = '';
  if (nx) nx.style.display = 'none';

  this.render(null, (label == null) ? '准备开战…' : label);
  this.step();
};

/* 一条一条地推进 */
BattlePlayer.prototype.step = function () {
  const state = this.state;
  if (!state || !state.view) return;

  // 上一帧标记阵亡的移出视图（保证 summon 的 pos 与引擎一致）
  state.view.mine = state.view.mine.filter(function (p) { return !p._dead; });
  state.view.foe  = state.view.foe.filter(function (p) { return !p._dead; });

  if (state.idx >= state.log.length) { this.finish(); return; }
  const ev = state.log[state.idx++];
  let label = null;

  switch (ev.e) {
    case 'battleStart': label = '开战！'; break;
    case 'phase':       label = '第 ' + ev.n + ' 回合'; break;

    case 'attack': {
      const A = battleFind(state.view, ev.a), B = battleFind(state.view, ev.b);
      if (A) { A.pet.hp -= ev.dmgA; markDeadIfZero(A.pet); }
      if (B) { B.pet.hp -= ev.dmgB; markDeadIfZero(B.pet); }
      label = (A ? petName(A.pet.def) : '?') + ' ⚔ ' + (B ? petName(B.pet.def) : '?');
      this._hi = [ev.a, ev.b];
      break;
    }
    case 'dmg': {
      const t = battleFind(state.view, ev.t);
      if (t) {
        t.pet.hp -= ev.n;
        markDeadIfZero(t.pet);
        label = petName(t.pet.def) + ' 受到 ' + ev.n + ' 伤害';
      }
      this._hi = [ev.t];
      break;
    }
    case 'buff': {
      const t = battleFind(state.view, ev.t);
      if (t) {
        t.pet.atk += ev.atk; t.pet.hp += ev.hp;
        label = petName(t.pet.def) + ' +' + ev.atk + '/+' + ev.hp;
      }
      this._hi = [ev.t];
      break;
    }
    case 'perk': {
      const t = battleFind(state.view, ev.t);
      if (t) t.pet.perks = [{ id: ev.id, uses: 1 }];
      label = '获得 ' + (typeof FOODS !== 'undefined' && FOODS[ev.id] ? FOODS[ev.id].cn : ev.id);
      this._hi = [ev.t];
      break;
    }
    case 'perkUsed': {
      const t = battleFind(state.view, ev.t);
      if (t) {
        const pk = t.pet.perks.find(function (x) { return x.id === ev.id; });
        if (pk) pk.uses--;
      }
      break;
    }
    case 'perkLost': {
      const t = battleFind(state.view, ev.t);
      if (t) t.pet.perks = t.pet.perks.filter(function (x) { return x.id !== ev.id; });
      break;
    }
    case 'faint': {
      const t = battleFind(state.view, ev.t);
      if (t) { t.pet.hp = 0; t.pet._dead = true; label = petName(t.pet.def) + ' 阵亡'; }
      this._hi = [ev.t];
      break;
    }
    case 'transform': {
      const t = battleFind(state.view, ev.t);
      if (t) {
        t.pet.defId = ev.id;
        t.pet.def = (typeof PETS !== 'undefined' && PETS[ev.id]) ? PETS[ev.id] : t.pet.def;
        t.pet.atk = ev.atk; t.pet.hp = ev.hp; t.pet.lvl = ev.lvl;
        label = '变成了 ' + petName(t.pet.def);
      }
      this._hi = [ev.t];
      break;
    }
    case 'summon': {
      // side 0 = 视图左边（我方），side 1 = 右边（对手）
      // ⚠️ 必须和 state.mySide 比 —— 玩家不一定是引擎的 side 0
      const key = (ev.side === (state.mySide || 0)) ? 'mine' : 'foe';
      state.view[key].splice(ev.pos, 0, {
        uid: ev.t, defId: ev.defId, def: PETS[ev.defId], lvl: ev.lvl || 1,
        atk: ev.atk, hp: ev.hp, perks: [], side: ev.side
      });
      label = '召唤了 ' + petName(PETS[ev.defId]);
      this._hi = [ev.t];
      break;
    }
    case 'push': {
      battleMoveTo(state.view, ev.t, ev.to);
      const t = battleFind(state.view, ev.t);
      if (t) label = petName(t.pet.def) + ' 被推向前排';
      this._hi = [ev.t];
      break;
    }
    case 'ability': this._hi = [ev.t]; break;

    case 'battleEnd':
      state.idx = state.log.length;
      this.finish(ev.winner);
      return;
  }

  this._fx = battleFxOfEvent(ev);     // 这一帧的扣血飘字 / 前冲 / 受击
  this.render(this._hi, label);
  const base = (this.el.baseDelay || 420) / this.speed();
  const self = this;
  this.timer = setTimeout(function () { self.step(); },
    ev.e === 'phase' ? base * 1.6 : base);
  state.timer = this.timer;
};

/* 直接跳到结尾（「跳过动画」） */
BattlePlayer.prototype.skip = function () {
  const state = this.state;
  if (!state) return;
  clearTimeout(this.timer);
  while (state.idx < state.log.length) {
    const ev = state.log[state.idx++];
    if (ev.e === 'battleEnd') break;
    const v = state.view;
    if (!v) break;
    v.mine = v.mine.filter(function (p) { return !p._dead; });
    v.foe  = v.foe.filter(function (p) { return !p._dead; });
    this.apply(ev);
  }
  this.finish();
};

/* 应用单条事件（skip 用；不含重绘和文案） */
BattlePlayer.prototype.apply = function (ev) {
  const state = this.state;
  if (!state || !state.view) return;
  switch (ev.e) {
    case 'attack': {
      const A = battleFind(state.view, ev.a), B = battleFind(state.view, ev.b);
      if (A) { A.pet.hp -= ev.dmgA; markDeadIfZero(A.pet); }
      if (B) { B.pet.hp -= ev.dmgB; markDeadIfZero(B.pet); }
      break;
    }
    case 'dmg':  {
      const t = battleFind(state.view, ev.t);
      if (t) { t.pet.hp -= ev.n; markDeadIfZero(t.pet); }
      break;
    }
    case 'buff': { const t = battleFind(state.view, ev.t); if (t) { t.pet.atk += ev.atk; t.pet.hp += ev.hp; } break; }
    case 'perk': { const t = battleFind(state.view, ev.t); if (t) t.pet.perks = [{ id: ev.id, uses: 1 }]; break; }
    case 'perkUsed': {
      const t = battleFind(state.view, ev.t);
      if (t) { const pk = t.pet.perks.find(function (x) { return x.id === ev.id; }); if (pk) pk.uses--; }
      break;
    }
    case 'perkLost': {
      const t = battleFind(state.view, ev.t);
      if (t) t.pet.perks = t.pet.perks.filter(function (x) { return x.id !== ev.id; });
      break;
    }
    case 'faint':  { const t = battleFind(state.view, ev.t); if (t) { t.pet.hp = 0; t.pet._dead = true; } break; }
    case 'transform': {
      const t = battleFind(state.view, ev.t);
      if (t) {
        t.pet.defId = ev.id;
        t.pet.def = (typeof PETS !== 'undefined' && PETS[ev.id]) ? PETS[ev.id] : t.pet.def;
        t.pet.atk = ev.atk; t.pet.hp = ev.hp; t.pet.lvl = ev.lvl;
      }
      break;
    }
    case 'summon': {
      const key = (ev.side === (state.mySide || 0)) ? 'mine' : 'foe';
      state.view[key].splice(ev.pos, 0, {
        uid: ev.t, defId: ev.defId, def: PETS[ev.defId], lvl: ev.lvl || 1,
        atk: ev.atk, hp: ev.hp, perks: [], side: ev.side
      });
      break;
    }
    case 'push': battleMoveTo(state.view, ev.t, ev.to); break;
  }
};

/* 重绘战场 */
BattlePlayer.prototype.render = function (highlight, label) {
  const state = this.state;
  if (!state || !state.view) return;
  const v = state.view;
  const fx = this._fx;          // 这一帧要播的特效（扣血飘字 / 前冲 / 受击）

  const arena = this.$(this.el.arena);
  if (arena) arena.classList.toggle('fighting', !!fx);

  const foe = this.$(this.el.foe);
  if (foe) {
    foe.innerHTML = '';
    for (const p of v.foe) {
      const c = petCard(p);
      if (highlight && highlight.indexOf(p.uid) >= 0) c.classList.add('acting');
      battleDecorateCard(c, p, fx, false);
      foe.appendChild(c);
    }
  }
  const mine = this.$(this.el.mine);
  if (mine) {
    mine.innerHTML = '';
    for (const p of v.mine) {
      const c = petCard(p);
      if (highlight && highlight.indexOf(p.uid) >= 0) c.classList.add('acting');
      battleDecorateCard(c, p, fx, true);
      mine.appendChild(c);
    }
  }
  const lb = this.$(this.el.label);
  if (lb && label != null) lb.textContent = label;
};

/* 收尾：清掉残留尸体、判定胜负、交给调用方收场 */
BattlePlayer.prototype.finish = function (winner) {
  const state = this.state;
  clearTimeout(this.timer);
  this._fx = null;                    // 结束画面不要再飘扣血数字
  const arena = this.$(this.el.arena);
  if (arena) arena.classList.remove('fighting');
  if (state && state.view) {
    state.view.mine = state.view.mine.filter(function (p) { return !p._dead; });
    state.view.foe  = state.view.foe.filter(function (p) { return !p._dead; });
    this.render(null, '战斗结束');
  }
  if (winner === undefined) winner = this._defaultWinner;

  const lb = this.$(this.el.label);
  if (lb) {
    // ⚠️ winner 是【引擎视角】的 0/1（0 = side 0 赢），必须按 mySide 翻译成
    //    「我赢/我输」—— 玩家在引擎里可能是 side 1，直接当成「0 就是我赢」
    //    会把胜负显示反。
    const mySide = (state && state.mySide != null) ? state.mySide : 0;
    let txt, cls;
    if (winner === 0 || winner === 1) {
      const iWon = (winner === mySide);
      txt = iWon ? '🎉 这一场赢了！' : '💀 这一场输了';
      cls = iWon ? 'win' : 'lose';
    } else {
      txt = '🤝 平局'; cls = 'draw';
    }
    lb.textContent = txt;
    lb.className = 'battle-label ' + cls;
  }
  const sk = this.$(this.el.skip);
  const nx = this.$(this.el.next);
  if (sk) sk.style.display = 'none';
  if (nx) nx.style.display = '';

  if (this.el.onFinish) this.el.onFinish(winner);
};
