'use strict';
/* ============================================================
 *  melee.js — 8 人混战（大逃杀模式）
 *
 *  玩法：
 *   · 你和 7 个人机同场竞技，各自独立经营自己的队伍
 *   · 每回合两两配对打一场；输的一方按 TFT 规则扣血
 *   · 血量归零出局，最后活着的人获胜；你出局即结算名次
 *
 *  经济：TFT 式（金币累积 + 利息 + 连胜奖励 + 宠物按星级定价）
 *  复用：商店/合并/道具逻辑全部复用 game.js 的 Game 类，
 *        战斗复用 engine.js，渲染复用 render.js
 * ============================================================ */

/* 8 人模式专属配置 */
const MELEE_CFG = {
  COUNT: 8,
  BASE_HP: 30,          // 初始血量
  NAMES: ['你', '小灰', '阿黄', '点点', '毛毛', '球球', '豆豆', '大壮'],

  /* 扣血（TFT 式）：基础伤害随回合增长 + 每个存活敌方单位 1 点 */
  dmgBase: function (turn) { return 2 + Math.floor(turn / 2); },
  dmgPerUnit: 1,

  /* AI 性格：0 = 稳健攒钱，1 = 激进花钱（随机分配，制造强弱差异） */
  AI_GREED_RANGE: [0.55, 0.95]   // 每回合愿意花掉存款的比例
};

/* ------------------------------------------------------------
 *  一个参战者
 * ---------------------------------------------------------- */
function Fighter(idx, isHuman) {
  this.idx = idx;
  this.isHuman = isHuman;
  this.name = MELEE_CFG.NAMES[idx] || ('AI-' + idx);
  this.hp = MELEE_CFG.BASE_HP;
  this.alive = true;
  this.rank = 0;                 // 出局时确定名次（1 = 冠军）
  this.streak = 0;               // 正=连胜，负=连败
  this.eliminatedTurn = 0;

  // 复用单人模式的商店逻辑；经济由 CFG.ECONOMY = 'tft' 决定
  this.game = new Game();
  this.game.gold = 0;
  this.game.turn = 1;
  this.game.streak = 0;

  // AI 性格（人类玩家不需要）
  this.greed = isHuman ? 1
    : MELEE_CFG.AI_GREED_RANGE[0] +
      RNG.next() * (MELEE_CFG.AI_GREED_RANGE[1] - MELEE_CFG.AI_GREED_RANGE[0]);
}

/* 该参战者的队伍（注意：不要叫 team，会和 game.team 混淆） */
Fighter.prototype.getTeam = function () { return this.game.team; };

/* ------------------------------------------------------------
 *  主控
 * ---------------------------------------------------------- */
function Melee() {
  CFG.ECONOMY = 'tft';                     // 8 人模式固定用 TFT 经济
  this.fighters = [];
  for (let i = 0; i < MELEE_CFG.COUNT; i++) {
    this.fighters.push(new Fighter(i, i === 0));
  }
  this.human = this.fighters[0];
  this.turn = 1;
  this.phase = 'shop';                     // shop | battle | over
  this.reports = [];                       // 每回合战报
  this.lastReport = null;
  this.humanRank = 0;
  this.humanEliminated = false;
  this.startTurn();
}

Melee.prototype.alive = function () {
  return this.fighters.filter(function (f) { return f.alive; });
};

Melee.prototype.byIdx = function (i) { return this.fighters[i]; };

/* ---- 回合开始：所有人都领工资 + 刷商店 ---- */
Melee.prototype.startTurn = function () {
  for (const f of this.fighters) {
    if (!f.alive) continue;
    const g = f.game;
    const up = g.setTurn(this.turn);   // 顺带拿到商店等级有没有提升
    g.streak = f.streak;
    g.grantIncome();          // TFT 收入：基础 + 利息 + 连胜
    g.phase = 'shop';
    g.pendingFood = null;
    g.foodDiscount = 0;
    g.rollsThisTurn = 0;
    g.rollShop(false);        // 按当前商店等级刷新
    g.triggerTurnStart();
    if (up.upgraded) g.triggerShopTierUp(up.after);
    g.offerRelicChoice();     // 到点给遗物三选一
    // AI 不会挑，随机拿一个（保证和玩家规则对等）
    if (!f.isHuman && g.pendingRelicChoice && g.pendingRelicChoice.length) {
      const ids = g.pendingRelicChoice;
      g.pickRelic(RNG.pick(ids));
    }
  }
  this.phase = 'shop';
};

/* ------------------------------------------------------------
 *  AI 自动经营（和玩家用同一套商店规则，保证公平）
 * ---------------------------------------------------------- */
Melee.prototype.aiShop = function (f) {
  const g = f.game;
  let guard = 0;
  let rolls = 0;

  // 愿意花的钱：按性格比例，留一部分吃利息
  const budgetFloor = Math.floor(g.gold * (1 - f.greed));

  const affordable = function () { return g.gold > budgetFloor; };

  while (guard++ < 60) {
    let acted = false;

    // 1) 优先合并（同名且未满级）
    for (let i = 0; i < g.shopPets.length; i++) {
      const sp = g.shopPets[i];
      if (!sp) continue;
      if (!affordable() || g.gold < petCostOf(sp.defId, g)) continue;
      if (g.team.some(function (p) { return p.defId === sp.defId && p.lvl < 3; })) {
        if (g.buyPet(i).ok) { acted = true; break; }
      }
    }
    if (acted) continue;

    // 2) 队伍没满 → 买场上星级最高的
    if (g.team.length < g.getTeamMax()) {
      let best = -1, bestTier = -1;
      for (let i = 0; i < g.shopPets.length; i++) {
        const sp = g.shopPets[i];
        if (!sp) continue;
        if (!affordable() || g.gold < petCostOf(sp.defId, g)) continue;
        const t = (PETS[sp.defId] || {}).tier || 0;
        if (t > bestTier) { bestTier = t; best = i; }
      }
      if (best >= 0 && g.buyPet(best).ok) continue;
    }

    // 3) 队伍满了 → 用高星换掉最低星
    if (g.team.length >= g.getTeamMax() && rolls < 2) {
      let best = -1, bestTier = 0;
      for (let i = 0; i < g.shopPets.length; i++) {
        const sp = g.shopPets[i];
        if (!sp) continue;
        if (g.gold < petCostOf(sp.defId, g)) continue;
        const t = (PETS[sp.defId] || {}).tier || 0;
        if (t > bestTier) { bestTier = t; best = i; }
      }
      let worst = 0, worstTier = 99;
      g.team.forEach(function (p, i) {
        const t = (PETS[p.defId] || {}).tier || 0;
        if (t < worstTier) { worstTier = t; worst = i; }
      });
      if (best >= 0 && bestTier > worstTier) {
        g.sellPet(worst);
        if (g.buyPet(best).ok) continue;
      }
    }

    // 4) 花点钱刷新找更好的
    if (rolls < 2 && affordable() && g.gold >= rollCostOf() + petCostOf('Ant', g) + budgetFloor) {
      if (g.roll().ok) { rolls++; continue; }
    }
    break;
  }
};

/* ------------------------------------------------------------
 *  配对：随机两两一组；人数为奇数时随机一人轮空
 * ---------------------------------------------------------- */
Melee.prototype.pairUp = function () {
  const list = this.alive().slice();
  // 洗牌
  for (let i = list.length - 1; i > 0; i--) {
    const j = RNG.int(i + 1);
    const t = list[i]; list[i] = list[j]; list[j] = t;
  }
  const pairs = [];
  let bye = null;
  for (let i = 0; i + 1 < list.length; i += 2) {
    pairs.push([list[i], list[i + 1]]);
  }
  if (list.length % 2 === 1) bye = list[list.length - 1];
  return { pairs: pairs, bye: bye };
};

/* ------------------------------------------------------------
 *  结束回合：AI 经营 → 配对 → 战斗 → 扣血 → 淘汰
 * ---------------------------------------------------------- */
Melee.prototype.endTurn = function () {
  if (this.phase !== 'shop') return { ok: false, msg: '当前不能结束回合' };
  if (!this.human.game.team.length) return { ok: false, msg: '队伍是空的，先买宠物' };

  // 1) AI 各自经营
  for (const f of this.fighters) {
    if (!f.alive || f.isHuman) continue;
    this.aiShop(f);
  }

  // 2) 配对
  const pairing = this.pairUp();
  const report = { turn: this.turn, matches: [], bye: pairing.bye ? pairing.bye.name : null, humanLog: null };

  // 3) 打
  for (const [a, b] of pairing.pairs) {
    // 各自应用自己的遗物开战效果（在副本上，不影响商店里的队伍）
    const aTeam = a.game.team.map(clonePet);
    const bTeam = b.game.team.map(clonePet);
    applyRelicBattleStart(a.game, aTeam, bTeam);
    applyRelicBattleStart(b.game, bTeam, aTeam);
    const res = runBattle(aTeam, bTeam, { tier: a.game.getShopTier(), rolls: a.game.rollsThisTurn || 0 });

    let winner = null, loser = null;
    if (res.winner === 0)      { winner = a; loser = b; }
    else if (res.winner === 1) { winner = b; loser = a; }
    // 平局：双方都不扣血

    const m = {
      a: a.idx, b: b.idx,
      aName: a.name, bName: b.name,
      winner: res.winner,          // 0 / 1 / 'draw'
      dmg: 0, loserIdx: null
    };

    if (loser) {
      const survivors = (loser === a ? res.final[1] : res.final[0]).length;
      const dmg = MELEE_CFG.dmgBase(this.turn) + survivors * MELEE_CFG.dmgPerUnit;
      loser.hp -= dmg;
      m.dmg = dmg;
      m.loserIdx = loser.idx;
      m.survivors = survivors;
      loser.streak = loser.streak > 0 ? -1 : loser.streak - 1;
      winner.streak = winner.streak < 0 ? 1 : winner.streak + 1;
    }

    // 玩家参战的那一场：保留完整日志 + 开战前的双方队伍（供界面回放）
    if (a.isHuman || b.isHuman) {
      report.humanLog = res.log;
      report.humanIsA = a.isHuman;
      report.humanRes = res;
      report.humanMine = a.isHuman ? aTeam : bTeam;
      report.humanFoe  = a.isHuman ? bTeam : aTeam;
      report.humanFoeName = a.isHuman ? b.name : a.name;
    }
    report.matches.push(m);
  }

  // 轮空：不掉血，但也不算连胜
  if (pairing.bye) {
    report.matches.push({
      a: pairing.bye.idx, b: -1,
      aName: pairing.bye.name, bName: '轮空',
      winner: 'bye', dmg: 0, loserIdx: null
    });
  }

  // 4) 淘汰判定
  const dead = [];
  for (const f of this.fighters) {
    if (f.alive && f.hp <= 0) {
      f.alive = false;
      f.hp = 0;
      f.eliminatedTurn = this.turn;
      dead.push(f);
    }
  }
  // 同时出局的按剩余血量排（这里都是 0，按队伍强度排更合理，简化：按出手顺序）
  const stillAlive = this.alive().length;
  dead.forEach(function (f, i) {
    f.rank = stillAlive + dead.length - i;      // 越早出局名次越低
  });
  if (this.human.isHuman && !this.human.alive && !this.humanEliminated) {
    this.humanEliminated = true;
    this.humanRank = this.human.rank;
  }

  this.lastReport = report;
  this.reports.push(report);

  // 5) 结束判定
  const left = this.alive();
  if (left.length <= 1) {
    if (left.length === 1) left[0].rank = 1;
    if (this.human.alive) this.humanRank = 1;
    this.phase = 'over';
  } else if (this.humanEliminated) {
    this.phase = 'over';                         // 你出局了 → 直接结算
  } else {
    this.phase = 'battle';
  }

  return { ok: true, report: report, dead: dead };
};

/* ---- 进入下一回合 ---- */
Melee.prototype.nextTurn = function () {
  if (this.phase === 'over') return;
  this.turn++;
  this.startTurn();
};

/* ---- 名次文案 ---- */
Melee.prototype.rankText = function () {
  const r = this.humanRank;
  if (r === 1) return '🏆 第 1 名 —— 你是最后的赢家！';
  if (r === 2) return '🥈 第 2 名';
  if (r === 3) return '🥉 第 3 名';
  return '第 ' + r + ' 名（共 ' + MELEE_CFG.COUNT + ' 人）';
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Melee: Melee, Fighter: Fighter, MELEE_CFG: MELEE_CFG };
}
