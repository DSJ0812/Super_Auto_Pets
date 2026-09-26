'use strict';
/* ============================================================
 *  game.js — 商店 / 经济 / 回合循环 / 对手生成
 *
 *  这一层负责「游戏进程」，战斗引擎（engine.js）只被调用一次。
 *  商店阶段的宠物技能需要一个和战斗引擎 API 一致的环境，
 *  所以这里实现了 ShopEnv。
 * ============================================================ */

const CFG = {
  TEAM_MAX: 5,          // 队伍上限（实际按回合 3/4/5）
  GOLD_PER_TURN: 10,    // 每回合金币（回合结束清零，不累积）
  PET_COST: 3,
  FOOD_COST: 3,
  ROLL_COST: 1,
  SELL_GAIN: 1,
  WIN_TARGET: 10,       // 10 胜结束
  LOSE_MAX: 3,          // 3 败结束
  SHOP_PET_SLOTS: 5,
  SHOP_FOOD_SLOTS: 2,
  AP_SCALE: 0.60,       // 幽灵行动点折扣。官方曲线是给「完整 6 tier 池 + 真实玩家快照」设计的，
                        // 本作只有 Turtle Pack 61 只、对手全是幽灵，按原版会碾压玩家。
                        // ⚠️ 这个值对【羁绊强度】很敏感 —— 每次改羁绊都要重测。
                        //    加进 8 阵营 + 调强数值之后，同样的 0.42 从 22% 涨到了 34%
                        //    （因为玩家会主动凑羁绊，而幽灵只是随机生成）。
                        // 实测（每档 500 局、固定种子，AI 是「会同名合成 + 买食物 + 凑阵营」的普通水平）：
                        //    0.55 → 28%   0.58 → 25%   0.60 → 23%   0.65 → 21%   0.85 → 16%
                        // 目标：把「普通玩家」的通关率压在 20-25%。

  /* ---- 经济模式（8 人混战会切成 'tft'）----
   * sap：每回合固定 10 金、不累积、宠物统一 3 金          （经典模式）
   * tft：金币累积 + 利息 + 连胜奖励、宠物按星级定价        （8 人混战） */
  ECONOMY: 'sap',
  TFT_BASE_GOLD: 5,        // 每回合基础金币
  TFT_INTEREST_PER: 5,     // 每存满 5 金吃 1 点利息（原来 10 金才 1 点，攒钱太不划算）
  TFT_INTEREST_MAX: 5,     // 利息上限
  TFT_STREAK_CAP: 3,       // 连胜/连败奖励上限
  TFT_ROLL_COST: 2,        // 刷新费用

  /* ---- 宠物包（一局只用一包，见 PACKS / activePack）----
   * turtle = 原有 62 只；star = 星包 76 只 */
  PACK: 'turtle'
};

/* 宠物价格：SAP 统一价；TFT 按星级（T1=1 金 … T6=6 金）
 * 可选传入 game，会应用遗物的「批发商」折扣（最低 1 金） */
function petCostOf(defId, game) {
  let c;
  if (CFG.ECONOMY !== 'tft') c = CFG.PET_COST;
  else {
    const d = PETS[defId];
    c = (d && d.tier >= 1) ? d.tier : CFG.PET_COST;
  }
  if (game) c = Math.max(1, c - relicSum(game, 'petDiscount'));
  return c;
}

/* 刷新费用 */
function rollCostOf() {
  return CFG.ECONOMY === 'tft' ? CFG.TFT_ROLL_COST : CFG.ROLL_COST;
}

/* ---- 宠物包 ----
 * 官方每个包自成一套 6 个星级。两个包混进同一个池子会**稀释重复率**，
 * 让合成升级变得几乎不可能，所以一局只用一个包（和官方一致）。
 * 没写 pack 字段的宠物都算 turtle（原有 62 只），这样不用改老数据。 */
const PACKS = {
  turtle: { cn: '龟包', en: 'Turtle Pack', icon: '🐢' },
  star:   { cn: '星包', en: 'Star Pack',   icon: '⭐' }
};

function packOf(defId) {
  const d = PETS[defId];
  return (d && d.pack) || 'turtle';
}

/* 本局用哪个包（由 URL 的 ?pack= 决定，默认龟包） */
function activePack() {
  return (CFG.PACK && PACKS[CFG.PACK]) ? CFG.PACK : 'turtle';
}

/* 可购买池：当前包里的全部非代币宠物（Tier 1-6）
 * 具体能买到几星由「商店等级」按回合决定，见 unlockedPool() */
function buyablePool() {
  const pack = activePack();
  return Object.keys(PETS).filter(function (k) {
    return !PETS[k].token && PETS[k].tier >= 1 && packOf(k) === pack;
  });
}

/* ------------------------------------------------------------
 *  商店环境：让商店阶段的宠物技能拥有和战斗引擎一致的 API
 * ---------------------------------------------------------- */
function ShopEnv(game) {
  this.game = game;
  this.lastBattleLost = game.lastBattleLost;
  this.events = [];
  this.actor = null;     // 当前正在触发技能的宠物（用于给事件标记来源）
  // 当前商店等级。⚠️ 必须是【属性】不是方法 —— 鹳的遗言用的是 `g.tier || 1`，
  // 给个函数的话是真值，会算出 NaN
  this.tier = game.getShopTier();
  // ⚠️ 刻意不设 sides：水滴鱼用 `g.sides ? 2 : 1` 区分自己是不是在战斗里
}
ShopEnv.prototype.emit = function (ev) {
  if (this.actor && ev.by == null) ev.by = this.actor.uid;
  this.events.push(ev);
  return ev;
};
ShopEnv.prototype.team = function (side) { return this.game.team; };
ShopEnv.prototype.allPets = function () { return this.game.team; };
ShopEnv.prototype.indexOf = function (pet) { return this.game.team.indexOf(pet); };

ShopEnv.prototype.buff = function (pet, atk, hp) {
  if (!pet) return;
  if (atk) pet.atk += atk;
  if (hp)  pet.hp += hp;
  this.emit({ e: 'buff', t: pet.uid, atk: atk || 0, hp: hp || 0 });
};
ShopEnv.prototype.friends = function (pet) {
  return this.game.team.filter(function (p) { return p !== pet; });
};
ShopEnv.prototype.behind = function (pet, n) {
  const i = this.game.team.indexOf(pet);
  if (i < 0) return [];
  return this.game.team.slice(i + 1, i + 1 + n);
};
ShopEnv.prototype.ahead = function (pet, n) {
  const i = this.game.team.indexOf(pet);
  if (i < 0) return [];
  const out = [];
  for (let k = i - 1; k >= 0 && out.length < n; k--) out.push(this.game.team[k]);
  return out;
};
ShopEnv.prototype.random = function (arr, n) {
  const pool = arr.slice(), out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(RNG.int(pool.length), 1)[0]);
  }
  return out;
};
ShopEnv.prototype.addGold = function (n) {
  this.game.gold += n;
  this.emit({ e: 'gold', n: n });
};
// Squirrel：本回合商店食物降价
ShopEnv.prototype.discountFood = function (n) {
  this.game.foodDiscount = (this.game.foodDiscount || 0) + n;
  this.emit({ e: 'discount', n: n });
};
// Cow：把整个食物商店换成指定的免费牛奶
ShopEnv.prototype.replaceFoodShop = function (foodId) {
  const g = this.game;
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    g.shopFoods[i] = { id: foodId, cost: 0 };
    g.frozenFoods[i] = false;
  }
  this.emit({ e: 'stock', id: foodId, cost: 0 });
};
ShopEnv.prototype.stock = function (foodId, cost) {
  const c = cost == null ? CFG.FOOD_COST : cost;
  this.game.stockFood(foodId, c);
  this.emit({ e: 'stock', id: foodId, cost: c });
};
ShopEnv.prototype.buffShop = function (atk, hp) {
  for (const slot of this.game.shopPets) {
    if (slot) { slot.atk += atk; slot.hp += hp; }
  }
  this.emit({ e: 'shopBuff', atk: atk, hp: hp });
};

/* 只给商店的某一个位置加属性（小鸭「给最左边的商店宠物 +N 生命」） */
ShopEnv.prototype.buffShopAt = function (index, atk, hp) {
  const slot = this.game.shopPets[index];
  if (!slot) return;
  if (atk) slot.atk += atk;
  if (hp)  slot.hp += hp;
  this.emit({ e: 'shopBuffAt', t: slot.uid, atk: atk || 0, hp: hp || 0 });
};

/* 交换两只宠物的攻击和生命（青蛙） */
ShopEnv.prototype.swapStats = function (a, b) {
  if (!a || !b) return;
  const atk = a.atk; a.atk = b.atk; b.atk = atk;
  const hp = a.hp;  a.hp = b.hp;   b.hp = hp;
  this.emit({ e: 'swap', t: a.uid, t2: b.uid });
};

/* 直接把攻击设成某个值（白蚁「把攻击设为商店等级 +N」） */
ShopEnv.prototype.setAtk = function (pet, n) {
  if (!pet) return;
  pet.atk = Math.max(0, n);
  this.emit({ e: 'setAtk', t: pet.uid, n: pet.atk });
};

/* 接下来几次刷新免费（狨猴） */
ShopEnv.prototype.freeRolls = function (n) {
  this.game.freeRolls = (this.game.freeRolls || 0) + n;
  this.emit({ e: 'freeRoll', n: n });
};

/* 往队伍里加一只宠物（豚鼠「购买时召唤一只豚鼠」）。
 * 队伍满了就什么都不做 —— 官方也是这么处理的。 */
ShopEnv.prototype.summon = function (a, b, c2, d2) {
  // ⚠️ 兼容两种调用方式：
  //   summon(defId, opts)                     —— 商店技能自己用（豚鼠）
  //   summon(side, index, defId, opts)        —— 和 Battle 一样的签名，
  //     这样同一段技能代码在战斗和商店两个上下文里都能直接跑（鸭嘴兽 / 食蚁兽）
  let defId, opts;
  if (typeof a === 'number') { defId = c2; opts = d2; }
  else { defId = a; opts = b; }
  opts = opts || {};
  const g = this.game;
  if (g.team.length >= g.getTeamMax()) return null;
  const pet = makePet(defId, opts.lvl || 1, { atk: opts.atk, hp: opts.hp });
  pet.side = -1;
  g.team.push(pet);
  this.emit({ e: 'summonShop', t: pet.uid, defId: defId });
  // 友方被召唤时（星包羊驼）
  for (const q of g.team) {
    if (q === pet) continue;
    const dq = q.def;
    if (dq && dq.hooks && dq.hooks.friendSummoned) {
      this.actor = q;
      dq.hooks.friendSummoned(this, { self: q, lvl: q.lvl, target: pet });
    }
  }
  this.actor = null;
  return pet;
};

/* 商店里对自己造成伤害（牦牛「回合结束：对自己造成 1 伤害」）。
 * 官方里商店阶段宠物不会真的死，所以最低留 1 点生命。
 * 受伤后要通知「友方受伤」（星包考拉在商店里也给桉树叶）。 */
ShopEnv.prototype.hit = function (pet, n) {
  if (!pet) return 0;
  const before = pet.hp;
  pet.hp = Math.max(1, pet.hp - n);
  const real = before - pet.hp;
  if (real) {
    this.emit({ e: 'dmg', t: pet.uid, n: real });
    this.notifyFriendHurt(pet);
  }
  return real;
};

/* 通知全体友方「这个友方受伤了」（星包考拉） */
ShopEnv.prototype.notifyFriendHurt = function (pet) {
  if (!pet || pet.hp <= 0) return;      // 已经阵亡的再给标记没意义
  for (const q of this.game.team) {
    if (q === pet) continue;
    const dq = q.def;
    if (dq && dq.hooks && dq.hooks.friendHurt) {
      this.actor = q;
      dq.hooks.friendHurt(this, { self: q, lvl: q.lvl, hurt: pet });
    }
  }
  this.actor = null;
};

/* 移除 Perk（海鹦 / 鸽子要把草莓标记「花掉」）。
 * 同时通知「友方失去标记」（星包真迅猛龙）。 */
ShopEnv.prototype.removePerk = function (pet, id) {
  if (!pet) return false;
  const before = pet.perks.length;
  pet.perks = pet.perks.filter(function (p) { return p.id !== id; });
  if (pet.perks.length === before) return false;
  pet._lostPerk = id;
  this.emit({ e: 'perkLost', t: pet.uid, id: id });
  for (const q of this.game.team) {
    if (q === pet) continue;
    const dq = q.def;
    if (dq && dq.hooks && dq.hooks.friendLostPerk) {
      this.actor = q;
      dq.hooks.friendLostPerk(this, { self: q, lvl: q.lvl, target: pet, perk: id });
    }
  }
  this.actor = null;
  return true;
};
/* 兼容旧名字 */
ShopEnv.prototype.removePerkNotify = ShopEnv.prototype.removePerk;

/* ============================================================
 *  让 ShopEnv 也能跑「战斗语境」的遗言钩子
 *
 *  为什么需要：安眠药（让一只宠物阵亡）和星包螳螂（回合开始对相邻友方造成 50 伤害）
 *  都要在【商店阶段】触发遗言，而遗言钩子全是按战斗上下文写的
 *  （萤火虫要用 hitWithin、蟑螂要用 grantExp、鹳要看 tier）。
 *  所以这里把缺的那几个补齐 —— 商店里只有一条战线，没有敌人。
 *
 *  ⚠️ 刻意【不】提供 sides 字段：星包水滴鱼用 `g.sides ? 2 : 1` 判断自己是不是
 *     在战斗里（战斗中多给一只经验）。加了 sides 会让它在商店里也按战斗算。
 * ============================================================ */
ShopEnv.prototype.grantExp = function (pet, n) {
  this.game.addExp(pet, n);
};

/* 商店里没有敌人，所以「对面的宠物」永远是空 */
ShopEnv.prototype.foes = function () { return []; };

/* N 格内（商店只有一条战线，按队内下标算距离） */
ShopEnv.prototype.within = function (pet, spaces) {
  const team = this.game.team;
  const i = team.indexOf(pet);
  if (i < 0) return [];
  const out = [];
  team.forEach(function (p, k) { if (Math.abs(k - i) <= spaces) out.push(p); });
  return out;
};
ShopEnv.prototype.hitWithin = function (pet, spaces, dmg) {
  const targets = this.within(pet, spaces);
  for (const t of targets) this.hit(t, dmg);
  return targets;
};

/* 商店里「击杀」一只宠物：触发它的遗言，然后永久移出队伍。
 * 安眠药和螳螂都用它（注意和 hit 的区别：hit 最低留 1 点生命，不会真的死） */
ShopEnv.prototype.kill = function (pet) {
  if (!pet) return;
  const d = pet.def;
  let notes = [];
  if (d && d.hooks && d.hooks.faint) {
    const envF = new ShopEnv(this.game);
    envF.lastBattleLost = this.lastBattleLost;
    envF.actor = pet;
    d.hooks.faint(envF, { self: pet, lvl: pet.lvl });
    envF.actor = null;
    for (const ev of envF.events) this.events.push(ev);
    notes = describeShopNotes(this.game, envF.events);
  }
  const i = this.game.team.indexOf(pet);
  if (i >= 0) this.game.team.splice(i, 1);
  this.emit({ e: 'faintShop', t: pet.uid, defId: pet.defId });
  return notes;
};

ShopEnv.prototype.hasPerk = function (pet, id) {
  if (!pet) return false;
  return pet.perks.some(function (p) { return p.id === id; });
};

/* 把战斗里「永久」加成回写到商店队伍（星包仙犰狳）。
 * 战斗跑在队伍【副本】上，所以引擎只能发 permBuff 事件，由这里按 uid 找回真实宠物。
 * ⚠️ 三个跑战斗的地方都要调：solo/经典（resolveTurn）、8 人混战、联机。 */
function applyPermBuffs(teams, log) {
  if (!log || !log.length) return 0;
  // teams 允许两种写法：[队伍A, 队伍B] 或者直接一个队伍（形如 [宠物, 宠物]）。
  // ⚠️ 用「第一个元素是不是数组」来区分 —— 否则单个队伍会被当成队伍列表，
  //    于是把宠物当成队伍去 .find()，直接 TypeError。
  const list = (Array.isArray(teams) && Array.isArray(teams[0])) ? teams : [teams];
  let n = 0;
  for (const ev of log) {
    if (ev.e !== 'permBuff') continue;
    for (const team of list) {
      if (!team || !Array.isArray(team)) continue;
      const real = team.find(function (p) { return p.uid === ev.t; });
      if (!real) continue;
      if (ev.atk) real.atk += ev.atk;
      if (ev.hp)  real.hp  = Math.max(1, real.hp + ev.hp);
      n++;
      break;
    }
  }
  return n;
}

/* 商店里自己加【永久】属性（仙犰狳在商店受击时用）。
 * 商店里的属性本来就是永久的，所以这里不需要额外的事件。 */
ShopEnv.prototype.buffPerm = function (pet, atk, hp) {
  return this.buff(pet, atk, hp);
};

/* 商店里给 Perk（星包考拉：友方在商店受伤时给桉树叶）。
 * 和 engine.js 的 Battle.givePerk 同规则：一只宠物同时只能带 1 个 Food Perk。 */
ShopEnv.prototype.givePerk = function (pet, id, uses) {
  if (!pet || pet.hp <= 0) return;
  pet.perks = [{ id: id, uses: uses == null ? 1 : uses }];
  pet.weak = false;
  this.emit({ e: 'perk', t: pet.uid, id: id });
  this.notifyPerkGained(pet, id);
};

/* 商店里变身（星包菊石用安眠药在商店阵亡时，把身后的友方变成拟态章鱼）。
 * 规则和 engine.js 的 Battle.transform 一致：等级重置为 1、已得加成保留、
 * 不会致死。区别是这里直接改真实队伍里的宠物，所以是永久生效的。 */
ShopEnv.prototype.transform = function (pet, defId, opts) {
  opts = opts || {};
  if (!pet || pet.hp <= 0) return null;
  const def = PETS[defId];
  if (!def) return null;
  const lvl = opts.lvl || 1;
  const bonus = EXP_BONUS[lvl] || 0;
  const oldBonus = EXP_BONUS[pet.lvl] || 0;
  const gainAtk = pet.atk - ((pet.def ? pet.def.atk : 1) + oldBonus);
  const gainHp  = pet.hp  - ((pet.def ? pet.def.hp  : 1) + oldBonus);
  pet.defId = defId;
  pet.def = def;
  pet.lvl = lvl;
  pet.exp = 0;
  pet.atk = Math.max(0, def.atk + bonus + gainAtk);
  pet.hp  = Math.max(1, def.hp + bonus + gainHp);
  if (def.perk) pet.perks = [{ id: def.perk, uses: 1 }];
  this.emit({ e: 'transform', t: pet.uid, id: defId, atk: pet.atk, hp: pet.hp, lvl: pet.lvl });
  return pet;
};

/* 「直到战斗结束」的临时属性（星包霍加狓：刷新时 +1/+1 直到战斗结束）。
 * 商店阶段照常加在宠物身上，打完这一场后由 Game.endTurn 还原。 */
ShopEnv.prototype.buffTemp = function (pet, atk, hp) {
  if (!pet) return;
  if (atk) { pet.atk += atk; pet._tempAtk = (pet._tempAtk || 0) + atk; }
  if (hp)  { pet.hp += hp;   pet._tempHp  = (pet._tempHp  || 0) + hp; }
  this.emit({ e: 'buff', t: pet.uid, atk: atk || 0, hp: hp || 0 });
};

/* 商店里获得 Perk 时通知友方（星包鹤鸵） */
ShopEnv.prototype.notifyPerkGained = function (pet, perkId) {
  for (const q of this.game.team) {
    if (q === pet) continue;
    const dq = q.def;
    if (dq && dq.hooks && dq.hooks.friendGainedPerk) {
      this.actor = q;
      dq.hooks.friendGainedPerk(this, { self: q, lvl: q.lvl, target: pet, perk: perkId });
    }
  }
  this.actor = null;
};

/* 打乱「前方友方」之间的位置（星包科莫多巨蜥）。
 * 只在这段区间内洗牌，保证它们仍然都在自己前面。 */
ShopEnv.prototype.shuffleAhead = function (pet) {
  const team = this.game.team;
  const i = team.indexOf(pet);
  if (i <= 0) return;
  const head = team.slice(0, i);
  for (let k = head.length - 1; k > 0; k--) {
    const j = RNG.int(k + 1);
    const tmp = head[k]; head[k] = head[j]; head[j] = tmp;
  }
  for (let k = 0; k < head.length; k++) team[k] = head[k];
  this.emit({ e: 'shuffle', n: head.length });
};


/* 宠物身上有没有某个 Perk（商店阶段用，和 Battle.hasPerk 同义） */
function petHasPerk(pet, id) {
  return !!(pet && pet.perks && pet.perks.some(function (x) { return x.id === id && x.uses > 0; }));
}

/* 反向查：某个 Perk 对应哪种食物（星包红雀要「库存前方友方的 Perk」） */
function foodForPerk(perkId) {
  for (const k of Object.keys(FOODS)) {
    if (FOODS[k].perk === perkId && !FOODS[k].token) return k;
  }
  return null;
}

/* ------------------------------------------------------------
 *  把商店阶段的事件汇总成一句人话（方案 B：汇总成一条）
 *  返回形如 ["虫子 库存 苹果", "天鹅 +2 金"] 的字符串数组
 * ---------------------------------------------------------- */
function describeShopNotes(game, events) {
  const byUid = {};
  for (const p of game.team) byUid[p.uid] = p;
  const nameOf = function (uid) {
    return byUid[uid] ? petName(byUid[uid].def) : '';
  };
  const statTxt = function (atk, hp) {
    const parts = [];
    if (atk) parts.push('+' + atk + ' 攻击');
    if (hp)  parts.push('+' + hp + ' 生命');
    return parts.join(' ');
  };

  const notes = [];
  for (const ev of events) {
    const who = nameOf(ev.by);
    if (ev.e === 'gold') {
      notes.push((who ? who + ' ' : '') + '+' + ev.n + ' 金');
    } else if (ev.e === 'stock') {
      const f = FOODS[ev.id];
      notes.push((who ? who + ' ' : '') + '库存了' + (f ? f.cn : ev.id) +
                 (ev.cost ? '（' + ev.cost + ' 金）' : '（免费）'));
    } else if (ev.e === 'buff') {
      const t = statTxt(ev.atk, ev.hp);
      if (t) notes.push((who ? who + ' ' : '') + '给 ' + (nameOf(ev.t) || '友方') + ' ' + t);
    } else if (ev.e === 'shopBuff') {
      const t = statTxt(ev.atk, ev.hp);
      if (t) notes.push((who ? who + ' ' : '') + '给商店宠物 ' + t);
    } else if (ev.e === 'shopBuffAt') {
      const t = statTxt(ev.atk, ev.hp);
      if (t) notes.push((who ? who + ' ' : '') + '给商店里的 ' + (nameOf(ev.t) || '宠物') + ' ' + t);
    } else if (ev.e === 'swap') {
      notes.push((who ? who + ' ' : '') + '交换了 ' + (nameOf(ev.t) || '?') + ' 和 ' + (nameOf(ev.t2) || '?') + ' 的属性');
    } else if (ev.e === 'setAtk') {
      const p = byUid[ev.t];
      notes.push((who ? who + ' ' : '') + '把 ' + (nameOf(ev.t) || '自己') + ' 的攻击设为 ' + ev.n);
    } else if (ev.e === 'freeRoll') {
      notes.push((who ? who + ' ' : '') + '接下来 ' + ev.n + ' 次刷新免费');
    } else if (ev.e === 'summonShop') {
      const d = PETS[ev.defId];
      notes.push((who ? who + ' ' : '') + '召唤了 ' + (d ? petName(d) : ev.defId));
    } else if (ev.e === 'dmg') {
      notes.push((who ? who + ' ' : '') + '自己受到 ' + ev.n + ' 伤害');
    } else if (ev.e === 'perkLost') {
      notes.push((who ? who + ' ' : '') + '失去了 ' + ev.id + ' 标记');
    } else if (ev.e === 'sellBonus') {
      notes.push((who ? who + ' ' : '') + '售价提高 ' + ev.n + ' 金');
    } else if (ev.e === 'exp') {
      notes.push((who ? who + ' ' : '') + '+' + ev.n + ' 经验');
    } else if (ev.e === 'reduceOnce') {
      notes.push((who ? who + ' ' : '') + '获得一次减伤 ' + ev.n);
    }
  }
  return notes;
}

/* ------------------------------------------------------------
 *  游戏状态
 * ---------------------------------------------------------- */
function Game() {
  this.reset();
}

Game.prototype.reset = function () {
  this.gold = CFG.GOLD_PER_TURN;
  this.turn = 1;
  this.wins = 0;
  this.losses = 0;
  this.team = [];
  this.shopPets = new Array(CFG.SHOP_PET_SLOTS).fill(null);
  this.shopFoods = new Array(CFG.SHOP_FOOD_SLOTS).fill(null);
  this.frozenPets = new Array(CFG.SHOP_PET_SLOTS).fill(false);
  this.frozenFoods = new Array(CFG.SHOP_FOOD_SLOTS).fill(false);
  this.lastBattleLost = false;
  this.phase = 'shop';           // shop | battle | gameover
  this.lastResult = null;
  this.pendingFood = null;       // 待选目标的食物索引
  this.pendingFoods = [];        // 待用库存：商店摆不下的道具先攒着，空位出现时自动补上
  this.history = [];
  this.shopNotes = [];           // 商店阶段技能触发的汇总提示（方案 B）
  this.foodDiscount = 0;         // 本回合的食物折扣（Squirrel）
  this.freeRolls = 0;            // 剩余免费刷新次数（狨猴）
  this.relics = [];              // 已获得的遗物
  this.pendingRelicChoice = null;// 待选择的遗物（三选一）
  this.relicChoiceDone = {};     // 已给过选择的回合
  this.rollShop(true);
  // 第一回合：触发开局技能（此时队伍为空，无效果）
  this.triggerTurnStart();
};

/* ---- 商店等级（官方规则：每两回合解锁一级）----
 *  回合1→T1 · 回合3→T2 · 回合5→T3 · 回合7→T4 · 回合9→T5 · 回合11+→T6
 *  作用：商店只会刷出「已解锁」的宠物，玩家和幽灵共用同一套解锁进度 */
Game.prototype.getShopTier = function () {
  const early = relicSum(this, 'tierEarly');       // 遗物「星探」：提前解锁
  const t = this.turn + early;
  if (t >= 11) return 6;
  if (t >= 9)  return 5;
  if (t >= 7)  return 4;
  if (t >= 5)  return 3;
  if (t >= 3)  return 2;
  return 1;
};

/* 当前已解锁的宠物池 */
Game.prototype.unlockedPool = function () {
  const max = this.getShopTier();
  return buyablePool().filter(function (id) { return PETS[id].tier <= max; });
};

/* ---- 商店刷新 ---- */
Game.prototype.rollShop = function (isInitial) {
  const pool = this.unlockedPool();
  for (let i = 0; i < CFG.SHOP_PET_SLOTS; i++) {
    // ⚠️ 必须同时判断「格子有货」：否则买空后残留的冻结标记会让这格永久不再补货
    if (!isInitial && this.frozenPets[i] && this.shopPets[i]) continue;
    this.shopPets[i] = this.makeShopPet(RNG.pick(pool));
    this.frozenPets[i] = false;
  }
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    if (!isInitial && this.frozenFoods[i] && this.shopFoods[i]) continue;
    this.shopFoods[i] = this.makeShopFood();
    this.frozenFoods[i] = false;
  }
  // 待用库存里攒着的道具（3 级鸽子的第 3 个苹果之类）补进空位
  this.fillFoodsFromPending();
};

/* ---- 队伍上限：官方规则是随回合增长的 3 → 4 → 5 ---- */
Game.prototype.getTeamMax = function () {
  if (this.turn <= 2) return 3;
  if (this.turn <= 4) return 4;
  return 5;
};

// 商店里的宠物是「等级 1 的实例」，可以被 Duck 之类的技能加属性
Game.prototype.makeShopPet = function (defId) {
  const p = makePet(defId, 1);
  return p;
};

Game.prototype.makeShopFood = function () {
  // 食物也要按宠物包过滤 —— 草莓是星包的，不该出现在龟包的商店里
  const pack = activePack();
  const keys = Object.keys(FOODS).filter(function (k) {
    if (FOODS[k].token) return false;
    return (FOODS[k].pack || 'turtle') === pack;
  });
  if (!keys.length) return null;
  return { id: RNG.pick(keys), cost: CFG.FOOD_COST };
};

/* 往商店里放一个道具（Worm / Pigeon 之类的技能用）
 * cost 由技能指定 —— 官方 Worm 给的是「2 金苹果」，比常价便宜 */
Game.prototype.stockFood = function (foodId, cost) {
  const item = { id: foodId, cost: cost == null ? CFG.FOOD_COST : cost };
  // 1) 优先放空位（顺便清掉可能残留的冻结标记）
  for (let i = 0; i < this.shopFoods.length; i++) {
    if (!this.shopFoods[i]) {
      this.shopFoods[i] = item;
      this.frozenFoods[i] = false;
      return true;
    }
  }
  // 2) 其次找「没被冻结、而且不是同一个道具」的槽位。
  //    ⚠️ 这一步是关键：像鸽子「库存 N 个苹果」、鼠妇「库存 N 个安眠药」这种
  //       连续库存，如果每次都覆盖同一个槽位，N 次下来只会剩 1 个
  //       （实测 2 级鸽子卖完只有 1 个苹果）。优先避开同类就不会互相覆盖。
  for (let i = 0; i < this.shopFoods.length; i++) {
    if (this.frozenFoods[i]) continue;
    if (this.shopFoods[i] && this.shopFoods[i].id === foodId) continue;
    this.shopFoods[i] = item;
    return true;
  }
  // 3) 两个食物位都占着（而且都是同一种道具）—— 商店确实摆不下了。
  //    ⚠️ 以前这里是「覆盖掉一个」，等于凭空丢东西：3 级鸽子说的
  //       「库存 3 个苹果」实际只能拿到 2 个。现在改成放进【待用库存】，
  //       等食物位空出来（用掉 / 刷新）时自动补上，一个都不会丢。
  if (!this.pendingFoods) this.pendingFoods = [];
  this.pendingFoods.push(item);
  return false;
};

/* 把「待用库存」里攒着的道具补进空着的食物位。
 * 每次刷新商店、以及用掉一个食物之后都会调一次。 */
Game.prototype.fillFoodsFromPending = function () {
  if (!this.pendingFoods || !this.pendingFoods.length) return 0;
  let n = 0;
  for (let i = 0; i < this.shopFoods.length && this.pendingFoods.length; i++) {
    if (this.shopFoods[i]) continue;
    this.shopFoods[i] = this.pendingFoods.shift();
    this.frozenFoods[i] = false;
    n++;
  }
  return n;
};

/* 取某个道具槽的实际价格（0 表示免费；Squirrel 折扣与遗物「营养师」在这里生效） */
Game.prototype.foodCost = function (f) {
  if (!f) return CFG.FOOD_COST;
  const base = f.cost == null ? CFG.FOOD_COST : f.cost;
  const disc = (this.foodDiscount || 0) + relicSum(this, 'foodDiscount');
  return Math.max(0, base - disc);
};

/* ---- 购买宠物 ----
 * teamIdx 可选：给了就插到队伍的那个位置（拖拽购买），不给就追加到末尾 */
Game.prototype.buyPet = function (slotIdx, teamIdx) {
  const pet = this.shopPets[slotIdx];
  if (!pet) return { ok: false, msg: '这个位置没有宠物' };
  const cost = petCostOf(pet.defId, this);        // SAP 固定价 / TFT 按星级 / 遗物折扣
  if (this.gold < cost) return { ok: false, msg: '金币不够（需要 ' + cost + ' 金）' };

  // 1) 先看能否合并（队伍里有同名且未满级）—— 合并时位置无意义
  const same = this.team.find(function (p) { return p.defId === pet.defId && p.lvl < 3; });
  if (same) {
    this.gold -= cost;
    this.shopPets[slotIdx] = null;
    this.frozenPets[slotIdx] = false;      // 商品没了，冻结标记也要清掉

    /* 官方：合并时【取两者中更高的属性】，然后才吃经验带来的 +1/+1。
     *   "Combining a pet that has higher stats with a pet that has lower stats will
     *    result in the higher stats being chosen before applying the +1 attack and
     *    +1 health boost(s)."
     * 商店里的宠物可能被 Duck / Canned Food / 小鼠之类的技能加过属性，
     * 以前合并分支把商店那只【整只丢掉】，玩家花同样的钱却亏掉那部分增益。 */
    if (pet.atk > same.atk) same.atk = pet.atk;
    if (pet.hp  > same.hp)  same.hp  = pet.hp;

    const before = same.lvl;
    this.addExp(same, 1);

    /* ⚠️ 合并【也必须】触发「购买时」技能。
     *    官方（Otter 页）："Like all Buy pets, the Otter's ability will also
     *    activate when an Otter from the shop is merged with an existing Otter,
     *    which is the only way to activate the Level 2 and Level 3 effects."
     *    而且合并是升到 2/3 级的唯一途径 —— 不触发的话，2 级、3 级的
     *    「购买时」效果永远拿不到。
     *    以前这里只 addExp 就 return 了，症状就是「奶牛第二次买不刷新牛奶」。
     *    等级要取【合并后】的 same.lvl（技能按新等级结算）。 */
    const env = new ShopEnv(this);
    env.lastBattleLost = this.lastBattleLost;
    const md = same.def;
    if (md && md.hooks && md.hooks.buy) {
      env.actor = same;
      md.hooks.buy(env, { self: same, lvl: same.lvl });
    }
    env.actor = null;
    const mnotes = describeShopNotes(this, env.events);
    const bn = this.notifyFriendBought(same);
    const mall = mnotes.concat(bn);
    return { ok: true, msg: petName(same.def) + ' 获得经验' + (same.lvl > before ? '，升到 ' + same.lvl + ' 级！' : '')
             + (mall.length ? ' · ' + mall.join(' · ') : ''),
             merged: true, pet: same };
  }

  // 2) 队伍已满则不能加新宠物
  const max = this.getTeamMax();
  if (this.team.length >= max) {
    return { ok: false, msg: '队伍已满（本回合上限 ' + max + ' 只），先卖掉一只' };
  }

  this.gold -= cost;
  this.shopPets[slotIdx] = null;
  this.frozenPets[slotIdx] = false;        // 商品没了，冻结标记也要清掉
  const np = clonePet(pet);
  np.side = -1;
  if (teamIdx == null) {
    this.team.push(np);
  } else {
    const at = Math.max(0, Math.min(teamIdx, this.team.length));
    this.team.splice(at, 0, np);
  }
  /* ⚠️ 这里【不能】再补一次商店增益。
   *    clonePet 已经把商店那只的 atk/hp 原样抄过来了，而商店增益（Duck /
   *    Canned Food / buffShopAt）是直接写进 shopPets[i].atk/hp 的（见 ShopEnv.buffShop），
   *    所以增益早就在 np 身上了。以前这里还会再 applyPerksFromShop 一次
   *    （按「相对基础值的差值」再加一遍），结果是【算了两次】：
   *    商店里 6/8 的水獭买回来变成 11/13。
   *    参考实现（Rust sap_ref）也是同一个模型：商店刷新时就 pet.stats += perm_stats，
   *    买到手就是商店里那副属性，没有第二步。 */

  // 购买触发（Otter）
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  const def = np.def;
  if (def && def.hooks && def.hooks.buy) {
    env.actor = np;
    def.hooks.buy(env, { self: np, lvl: np.lvl });
  }
  env.actor = null;
  const notes = describeShopNotes(this, env.events);
  const bn2 = this.notifyFriendBought(np);
  const allNotes = notes.concat(bn2);
  return { ok: true, msg: '购买了 ' + petName(np.def)
           + (allNotes.length ? ' · ' + allNotes.join(' · ') : ''), pet: np };
};

/* ⚠️ 以前这里有一个 applyPerksFromShop(shopPet, teamPet)：
 *    按「商店宠物相对基础值的差值」再给队伍宠物补一次属性。
 *    它是多余的，而且是错的 —— 商店增益本来就写在 shopPets[i].atk/hp 上，
 *    clonePet 已经原样抄走了，再补一次就是【算两次】（商店 6/8 买回来 11/13）。
 *    合并分支则相反，整只丢掉商店那只，增益全没了（现在也改成取两者较高值）。
 *    所以这个函数直接删掉，别再被谁捡回来用。 */

/* 购买后通知其他友方（Dragon「购买 1 级友方时」） */
Game.prototype.notifyFriendBought = function (bought) {
  const env = new ShopEnv(this);
  for (const p of this.team) {
    if (p === bought) continue;
    const d = p.def;
    if (d && d.hooks && d.hooks.friendBought) {
      env.actor = p;
      d.hooks.friendBought(env, { self: p, lvl: p.lvl, bought: bought });
    }
  }
  env.actor = null;
  return describeShopNotes(this, env.events);
};

/* ---- 升星奖励（官方规则）----
 *  「Upon leveling up, the player is given a choice between two Pets from
 *    the next tier. However, this effect does not apply when merging two
 *    Level 2 Pets into a Level 3 Pet.」
 *  → 升星时，商店里出现 2 个「下一星级」的宠物供玩家挑选（可以买，也可以不买） */
Game.prototype.tierUpReward = function () {
  const cur = this.getShopTier();
  /* ⚠️ 官方原文只说「下一星级」，而 6 级就是最高星级、没有 7 级 ——
   *    所以「6 级给什么」官方没写。这里的选择是【封顶到 6】：
   *    6 级升星仍然刷 2 个 6 级宠物，而不是什么都不给。
   *    理由：升星有奖励是基础规则，打到后期升星反而没奖励会自相矛盾。
   *    （若哪天查到官方在 6 级确实不给奖励，把 want 改回 return 即可。） */
  const want = Math.min(cur + 1, 6);
  const pool = buyablePool().filter(function (id) {
    return PETS[id].tier === want;
  });
  if (!pool.length) return;

  // 随机挑 N 个格子替换（洗牌取前 N；遗物「孵化器」会让 N 变大）
  const cnt = 2 + relicSum(this, 'tierRewardCount');
  const idxs = [];
  for (let i = 0; i < this.shopPets.length; i++) idxs.push(i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = RNG.int(i + 1);
    const tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp;
  }
  // ⚠️ 优先用「没被冻结」的格子（空格也算），只有不够时才动冻结的。
  //    以前是纯随机挑，会把玩家特意冻住、想留到下一回合的宠物直接冲掉，
  //    而且还会把冻结标记一并清掉 —— 玩家会莫名其妙丢东西。
  const freeSlots = idxs.filter(function (i) { return !(this.frozenPets[i] && this.shopPets[i]); }, this);
  const frozenSlots = idxs.filter(function (i) { return (this.frozenPets[i] && this.shopPets[i]); }, this);
  const order = freeSlots.concat(frozenSlots);
  for (let k = 0; k < cnt && k < order.length; k++) {
    const slot = order[k];
    this.shopPets[slot] = this.makeShopPet(RNG.pick(pool));
    this.frozenPets[slot] = false;      // 这格的商品换了，冻结标记跟着清掉
  }
};

/* ---- 加经验 / 升级 ---- */
Game.prototype.addExp = function (pet, n) {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  for (let i = 0; i < n; i++) {
    if (pet.lvl >= 3) break;
    pet.exp = (pet.exp || 0) + 1;
    pet.atk += 1;
    pet.hp  += 1;
    const need = EXP_BONUS[pet.lvl + 1];
    if (pet.exp >= need) {
      pet.lvl += 1;
      const def = pet.def;
      if (def && def.hooks && def.hooks.levelUp) {
        env.emit({ e: 'ability', t: pet.uid, hook: 'levelUp' });
        def.hooks.levelUp(env, { self: pet, lvl: pet.lvl });
      }
      // 友方升级时的触发（星包水母）
      for (const q of this.team) {
        if (q === pet) continue;
        const dq = q.def;
        if (dq && dq.hooks && dq.hooks.friendLevelUp) {
          env.actor = q;
          dq.hooks.friendLevelUp(env, { self: q, lvl: q.lvl, target: pet });
        }
      }
      env.actor = null;
      // 官方：升星时给「下一星级的两个宠物」；但合成到 3 级不触发
      if (pet.lvl < 3) this.tierUpReward();
    }
  }
};

/* ---- 出售宠物 ---- */
Game.prototype.sellPet = function (teamIdx) {
  const pet = this.team[teamIdx];
  if (!pet) return { ok: false, msg: '没有这只宠物' };

  // 出售技能在宠物仍在队伍时触发（需要 friends/behind/ahead 位置信息）
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  const def = pet.def;
  if (def && def.hooks && def.hooks.sell) {
    env.actor = pet;
    def.hooks.sell(env, { self: pet, lvl: pet.lvl });
  }
  env.actor = null;

  // ⚠️ 必须在移出队伍之前生成提示，否则查不到宠物名字
  const notes = describeShopNotes(this, env.events);

  const petBonus = pet._sellBonus || 0;      // 星包麋鹿：临时提高某只宠物的售价
  const hadSell = !!(def && def.hooks && def.hooks.sell);
  this.team.splice(teamIdx, 1);

  // 友方被出售时（星包海葵）
  const envS = new ShopEnv(this);
  envS.lastBattleLost = this.lastBattleLost;
  for (const q of this.team) {
    const dq = q.def;
    if (dq && dq.hooks && dq.hooks.friendSold) {
      envS.actor = q;
      dq.hooks.friendSold(envS, { self: q, lvl: q.lvl, sold: pet, hadSell: hadSell });
    }
  }
  envS.actor = null;
  for (const ev of envS.events) env.events.push(ev);
  // 售价 = 宠物等级（1/2/3 级分别卖 1/2/3 金）。官方原文：
  // "Pets will sell for one at level 1, for 2 at level 2, and 3 at level three"。
  // ⚠️ 以前这里是固定的 CFG.SELL_GAIN（1 金），所以 2 级 / 3 级宠物卖掉也只给 1 金，
  //    和官方不符，玩起来也会觉得「合了半天卖出去不值」。
  const sellGain = Math.max(1, pet.lvl || 1) +
                   relicSum(this, 'sellBonus') + petBonus;   // 遗物「当铺」/ 星包麋鹿
  this.gold += sellGain;
  return { ok: true, msg: '卖掉了 ' + petName(pet.def) + '，+' + sellGain + ' 金'
           + (notes.length ? ' · ' + notes.join(' · ') : '') };
};

/* ---- 购买食物 ---- */
Game.prototype.buyFood = function (slotIdx) {
  const f = this.shopFoods[slotIdx];
  if (!f) return { ok: false, msg: '这个位置没有道具' };
  const cost = this.foodCost(f);
  if (this.gold < cost) return { ok: false, msg: '金币不够' };
  if (!this.team.length) return { ok: false, msg: '队伍是空的，先买宠物' };
  // 进入"选目标"状态
  this.pendingFood = slotIdx;
  return { ok: true, msg: '选择一只宠物使用「' + FOODS[f.id].cn + '」', needTarget: true };
};

/* ---- 把食物用在某只宠物上 ---- */
Game.prototype.applyFood = function (teamIdx) {
  if (this.pendingFood == null) return { ok: false, msg: '没有待使用的道具' };
  const f = this.shopFoods[this.pendingFood];
  if (!f) { this.pendingFood = null; return { ok: false, msg: '道具不存在' }; }
  const pet = this.team[teamIdx];
  if (!pet) return { ok: false, msg: '目标无效' };

  const def = FOODS[f.id];
  const cost = this.foodCost(f);
  this.gold -= cost;

  /* ---- 安眠药：让这只宠物阵亡（永久移出队伍，但会触发它的遗言）----
   * 官方原文："Make one pet faint. Always on sale!"，而且
   * "Sleeping Pill does not trigger Eats food abilities" —— 所以这里提前 return，
   * 不走下面的 buff / perk / friendlyAteFood 流程。 */
  if (def.faint) {
    const envK = new ShopEnv(this);
    envK.lastBattleLost = this.lastBattleLost;
    const notes = envK.kill(pet);
    this.shopFoods[this.pendingFood] = null;
    this.frozenFoods[this.pendingFood] = false;
    this.pendingFood = null;
    this.fillFoodsFromPending();               // 待用库存补进刚空出来的位置
    return {
      ok: true,
      msg: '安眠药让 ' + petName(def ? pet.def : null) + ' 阵亡了'
           + (notes && notes.length ? ' · ' + notes.join(' · ') : '')
    };
  }

  if (def.buff) {
    // Cat：食物效果 ×2/×3/×4（按猫自己的等级），每回合最多 2 次
    let mul = 1;
    const cat = this.team.find(function (p) {
      return p.defId === 'Cat' && p !== pet && (p._catUsed || 0) < 2;
    });
    if (cat) {
      mul = 1 + cat.lvl;
      cat._catUsed = (cat._catUsed || 0) + 1;
    }
    pet.atk += def.buff[0] * mul;
    pet.hp  += def.buff[1] * mul;
  }
  if (def.perk) {
    // 官方规则：新 Perk 覆盖旧 Perk（一只宠物同时只能带 1 个），
    // 而且 Food Perk 会顶掉异常状态
    setPerk(pet, def.perk, 1);
    pet.weak = false;
  }
  if (def.exp) {
    // 巧克力：给经验（会正常触发升级）
    const envX = new ShopEnv(this);
    envX.lastBattleLost = this.lastBattleLost;
    envX.emit({ e: 'exp', t: pet.uid, n: def.exp });
    this.addExp(pet, def.exp);
  }
  this.shopFoods[this.pendingFood] = null;
  this.frozenFoods[this.pendingFood] = false;   // 道具没了，冻结标记也要清掉
  this.pendingFood = null;
  this.fillFoodsFromPending();                  // 待用库存补进刚空出来的位置

  // 「友方吃食物」触发（Rabbit）
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  // 「友方获得 Perk」触发（星包鹤鸵）
  if (def.perk) {
    const envP = new ShopEnv(this);
    envP.lastBattleLost = this.lastBattleLost;
    envP.notifyPerkGained(pet, def.perk);
    for (const ev of envP.events) env.events.push(ev);   // 并进同一个事件流，提示才显示得出来
  }
  for (const p of this.team) {
    if (p === pet) continue;
    const d = p.def;
    if (d && d.hooks && d.hooks.friendlyAteFood) {
      env.actor = p;
      d.hooks.friendlyAteFood(env, { self: p, lvl: p.lvl, eater: pet });
    }
  }
  env.actor = null;
  const notes = describeShopNotes(this, env.events);
  return { ok: true, msg: def.cn + ' 用在 ' + petName(pet.def) + ' 上'
           + (notes.length ? ' · ' + notes.join(' · ') : '') };
};

/* ---- 刷新商店 ---- */
Game.prototype.roll = function () {
  const rc = rollCostOf();                 // SAP 1 金 / TFT 2 金
  let free = false;
  if (this.freeRolls > 0) {                // 狨猴：接下来 N 次刷新免费
    this.freeRolls--;
    free = true;
  } else {
    if (this.gold < rc) return { ok: false, msg: '金币不够刷新' };
    this.gold -= rc;
  }
  this.pendingFood = null;
  this.rollsThisTurn = (this.rollsThisTurn || 0) + 1;   // 星包马岛长尾狸猫按这个数结算
  this.rollShop(false);
  this.triggerRoll();                      // 刷新触发的技能（星包水豚 / 霍加狓）
  return {
    ok: true,
    msg: free ? ('免费刷新（还剩 ' + this.freeRolls + ' 次）') : '刷新了商店'
  };
};

/* 刷新商店时触发（水豚给新刷出的商店宠物加属性、霍加狓自己 +1/+1） */
Game.prototype.triggerRoll = function () {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  for (const p of this.team) {
    const d = p.def;
    if (d && d.hooks && d.hooks.roll) {
      env.actor = p;
      d.hooks.roll(env, { self: p, lvl: p.lvl });
    }
  }
  env.actor = null;
  const notes = describeShopNotes(this, env.events);
  if (notes.length) this.shopNotes = (this.shopNotes || []).concat(notes);
};

/* ---- 冻结 ---- */
Game.prototype.toggleFreezePet = function (i) {
  if (this.shopPets[i]) this.frozenPets[i] = !this.frozenPets[i];
};
Game.prototype.toggleFreezeFood = function (i) {
  if (this.shopFoods[i]) this.frozenFoods[i] = !this.frozenFoods[i];
};

/* ---- 调整队伍顺序 ---- */
Game.prototype.movePet = function (from, to) {
  if (from === to) return;
  if (from < 0 || from >= this.team.length) return;
  const [p] = this.team.splice(from, 1);
  const idx = Math.max(0, Math.min(to, this.team.length));
  this.team.splice(idx, 0, p);
};

/* ---- 回合开始技能 ---- */
Game.prototype.triggerTurnStart = function () {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  // 回合开始生效的食物 Perk（星包葡萄 +1 金）
  for (const p of this.team) {
    if (petHasPerk(p, 'Grapes')) {
      this.gold += 1;
      env.actor = p;
      env.emit({ e: 'gold', n: 1 });
    }
  }
  env.actor = null;
  // ⚠️ 必须先 slice 成快照再遍历：螳螂的 startTurn 会「击倒相邻友方」
  //    （ShopEnv.kill 会 splice 真实队伍），直接 for...of this.team 的话
  //    数组一变短，遍历就会【跳过】后面的宠物 —— 表现就是「回合开始技能
  //    有的没触发 / 触发顺序怪怪的」。
  const turnOrder = this.team.slice();
  for (const p of turnOrder) {
    p._ox = 0; p._rabbit = 0;   // 重置每回合计数
    p._catUsed = 0;             // Cat 的食物翻倍次数
    p._koala = 0;               // 星包考拉：本回合还能给几次桉树叶
    if (this.team.indexOf(p) < 0) continue;   // 已经被前面的技能弄走了，跳过
    const d = p.def;
    if (d && d.hooks && d.hooks.startTurn) {
      env.actor = p;
      d.hooks.startTurn(env, { self: p, lvl: p.lvl });
    }
  }
  env.actor = null;
  this.shopNotes = describeShopNotes(this, env.events);

  // 遗物的回合开始效果（训练场等）——只统计新增的事件
  const mark = env.events.length;
  applyRelicTurnStart(this, env);
  const relicNotes = describeShopNotes(this, env.events.slice(mark));
  if (relicNotes.length) this.shopNotes = this.shopNotes.concat(relicNotes);

  // 阵营羁绊里唯一在商店阶段生效的是飞禽（每回合开始）
  const synNotes = applySynergyTurnStart(this);
  if (synNotes.length) this.shopNotes = this.shopNotes.concat(synNotes);
};

/* ---- 回合结束技能 ---- */
Game.prototype.triggerTurnEnd = function () {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  // 回合结束生效的食物 Perk（星包黄瓜 +1 生命 / 胡萝卜 +1/+1）
  for (const p of this.team) {
    if (petHasPerk(p, 'Cucumber')) { p.hp += 1; env.actor = p; env.emit({ e: 'buff', t: p.uid, atk: 0, hp: 1 }); }
    if (petHasPerk(p, 'Carrot'))   { p.atk += 1; p.hp += 1; env.actor = p; env.emit({ e: 'buff', t: p.uid, atk: 1, hp: 1 }); }
  }
  env.actor = null;
  for (const p of this.team) {
    const d = p.def;
    if (d && d.hooks && d.hooks.endTurn) {
      env.actor = p;
      d.hooks.endTurn(env, { self: p, lvl: p.lvl });
    }
  }
  env.actor = null;
  const notes = describeShopNotes(this, env.events);
  // 追加到本回合已有提示后面（回合开始的提示还在）
  this.shopNotes = (this.shopNotes || []).concat(notes);
};

/* ------------------------------------------------------------
 *  对手生成 —— 严格按官方「Ghost（幽灵）」算法
 *
 *  官方 wiki 原文要点：
 *   · Turn 1：从 Tier 1 选 3 只，放最前 3 位
 *   · Turn 2+：选 5 只（不超过当回合队伍上限），并从本回合起累计行动点
 *   · 行动点 = 回合数 × 2 − 4（回合 1 = 0，回合 2 = 1）
 *   · 每点行动点随机做三件事之一：
 *       ① 给一只宠物一个食物 Perk（每只最多一次）
 *       ② 给一只宠物 +1 经验
 *       ③ 给一只宠物 +(floor(回合/4) + 2) 点属性，随机分到攻击或生命
 *   · 宠物一律从基础属性起步，不触发商店阶段技能
 *
 *  注意：官方【没有】显式难度系数 —— 难度差异来自行动点的随机分配
 *  （有的幽灵属性堆在一只身上，有的摊得很散），这天然产生强弱差异。
 * ---------------------------------------------------------- */
Game.prototype.makeOpponent = function () {
  const t = this.turn;
  // 官方 Ghost 规则：从「已解锁的 tier」里选宠物
  const pool = this.unlockedPool();
  const maxTeam = this.getTeamMax();

  // ---- 1) 组队 ----
  let team = [];
  if (t === 1) {
    const tier1 = pool.filter(function (id) { return PETS[id].tier === 1; });
    const src = tier1.length ? tier1 : pool;
    for (let i = 0; i < Math.min(3, maxTeam); i++) {
      team.push(makePet(RNG.pick(src), 1));
    }
  } else {
    const n = Math.min(5, maxTeam);
    for (let i = 0; i < n; i++) {
      team.push(makePet(RNG.pick(pool), 1));
    }
  }

  // ---- 2) 花掉行动点 ----
  // 官方 AP 曲线是给「完整 6 tier 宠物池 + 真实玩家快照」设计的，
  // 对本作（62 只宠物、纯幽灵对手）偏强。实测折扣 0.7 时通关率约 45%。
  const rawAp = (t === 1) ? 0 : (t === 2 ? 1 : t * 2 - 4);
  const ap = Math.max(0, Math.round(rawAp * CFG.AP_SCALE));
  const statGain = Math.floor(t / 4) + 2;
  const perkFoods = Object.keys(FOODS).filter(function (id) {
    return FOODS[id].perk && !FOODS[id].token;
  });

  for (let k = 0; k < ap && team.length; k++) {
    const target = RNG.pick(team);
    const action = RNG.int(3);

    if (action === 0 && perkFoods.length) {
      // ① 给食物 Perk（同一只最多带一个，已有就跳过）
      if (!target.perks.length) {
        const fid = RNG.pick(perkFoods);
        setPerk(target, FOODS[fid].perk, 1);
      }
    } else if (action === 1) {
      // ② +1 经验（每点经验 +1/+1；满级后仍给 +1/+1，官方 0.24 起）
      target.exp = (target.exp || 0) + 1;
      target.atk += 1;
      target.hp  += 1;
      if (target.lvl < 3 && target.exp >= EXP_BONUS[target.lvl + 1]) target.lvl += 1;
    } else {
      // ③ 加属性，逐点随机分配到攻击或生命
      for (let s = 0; s < statGain; s++) {
        if (RNG.next() < 0.5) target.atk += 1;
        else                     target.hp  += 1;
      }
    }
  }

  return team;
};

/* ------------------------------------------------------------
 *  结束回合 → 打一场
 * ---------------------------------------------------------- */
Game.prototype.endTurn = function () {
  if (this.phase !== 'shop') return { ok: false, msg: '当前不能结束回合' };
  if (!this.team.length) return { ok: false, msg: '队伍是空的，先买宠物' };

  this.triggerTurnEnd();

  const opponent = this.makeOpponent();

  // ⚠️ 战斗在队伍副本上进行，战斗内的属性变化不会带回商店
  const myTeam  = this.team.map(clonePet);
  const foeTeam = opponent.map(clonePet);
  // 遗物的开战效果（战旗 / 獠牙 / 铁甲 / 猎杀标记）
  applyRelicBattleStart(this, myTeam, foeTeam);
  // 阵营羁绊（自创机制）：⚠️ 两边都要给 —— 只给玩家的话等于单方面降低难度
  applySynergyBattleStart(this, myTeam);
  applySynergyBattleStart(this, foeTeam);
  const result = runBattle(myTeam, foeTeam, { tier: this.getShopTier(), rolls: this.rollsThisTurn || 0, turn: this.turn });
  // 战斗里的「永久」加成回写到真实队伍（星包仙犰狳）
  applyPermBuffs(this.team, result.log);

  this.phase = 'battle';
  this.lastResult = {
    winner: result.winner,      // 0 = 我方胜, 1 = 敌方胜, 'draw'
    log: result.log,
    opponent: opponent,
    myFinal: result.final[0],
    foeFinal: result.final[1]
  };

  // 结算胜负
  if (result.winner === 0)      { this.wins++;   this.lastBattleLost = false; }
  else if (result.winner === 1) { this.losses++; this.lastBattleLost = true; }
  else                          { this.lastBattleLost = false; }   // 平局不算输

  // 还原「直到战斗结束」的临时属性（霍加狓）
  for (const p of this.team) {
    if (p._tempAtk) { p.atk = Math.max(0, p.atk - p._tempAtk); p._tempAtk = 0; }
    if (p._tempHp)  { p.hp  = Math.max(1, p.hp  - p._tempHp);  p._tempHp  = 0; }
  }

  this.history.push({ turn: this.turn, winner: result.winner, wins: this.wins, losses: this.losses });

  // 游戏结束判定
  if (this.wins >= CFG.WIN_TARGET) this.phase = 'gameover';
  else if (this.losses >= CFG.LOSE_MAX) this.phase = 'gameover';

  return { ok: true, result: this.lastResult };
};

/* ---- 回合收入 ----
 * SAP：固定 10 金，回合结束清零（不累积）
 * TFT：基础金 + 利息（每存满 N 金吃 1 点）+ 连胜/连败奖励，金币累积 */
Game.prototype.grantIncome = function () {
  const relicGold = relicSum(this, 'income');
  if (CFG.ECONOMY !== 'tft') {
    const gain = CFG.GOLD_PER_TURN + relicGold;
    this.gold = gain;                      // SAP：每回合重置（遗物加成叠加上去）
    this.lastIncome = { base: CFG.GOLD_PER_TURN, interest: 0, streak: 0, relic: relicGold, gain: gain };
    return this.lastIncome;
  }
  const base = CFG.TFT_BASE_GOLD;
  const iMax = CFG.TFT_INTEREST_MAX + relicSum(this, 'interestMax');
  const interest = Math.min(iMax, Math.floor(this.gold / CFG.TFT_INTEREST_PER));
  // 连胜/连败奖励（金铲铲式分档）：2-3 场 +1，4-5 场 +2，6+ 场 +3
  const s = Math.abs(this.streak || 0);
  let streakGold = 0;
  if (s >= 6)      streakGold = 3;
  else if (s >= 4) streakGold = 2;
  else if (s >= 2) streakGold = 1;
  const gain = base + interest + streakGold + relicGold;
  this.gold += gain;
  this.lastIncome = { base: base, interest: interest, streak: streakGold, relic: relicGold, gain: gain };
  return this.lastIncome;
};

/* ---- 遗物（每 3 回合给一次三选一，从回合 3 开始）---- */
Game.prototype.shouldOfferRelic = function () {
  return this.turn >= 3
      && (this.turn - 3) % 3 === 0
      && !this.relicChoiceDone[this.turn];
};

Game.prototype.offerRelicChoice = function () {
  if (!this.shouldOfferRelic()) return null;
  const ids = rollRelics(this.relics, 3, CFG.ECONOMY);
  if (!ids.length) return null;
  this.relicChoiceDone[this.turn] = true;
  this.pendingRelicChoice = ids;
  return ids;
};

Game.prototype.pickRelic = function (id) {
  if (!this.pendingRelicChoice) return { ok: false, msg: '现在没有遗物可选' };
  if (this.pendingRelicChoice.indexOf(id) < 0) return { ok: false, msg: '这个遗物不在候选里' };
  this.relics.push(id);
  this.pendingRelicChoice = null;
  return { ok: true, msg: '获得遗物：' + (RELICS[id] ? RELICS[id].cn : id) };
};

/* ---- 进入下一回合 ---- */
Game.prototype.nextTurn = function () {
  if (this.phase === 'gameover') return;
  const up = this.setTurn(this.turn + 1);   // 会顺带告诉我们商店等级有没有提升
  this.grantIncome();
  this.phase = 'shop';
  this.pendingFood = null;
  this.foodDiscount = 0;         // 每回合重置，Squirrel 会在开局重新打折
  this.rollsThisTurn = 0;        // 本回合刷新次数（星包马岛长尾狸猫）
  this.rollShop(false);
  this.triggerTurnStart();
  if (up.upgraded) this.triggerShopTierUp(up.after);
  this.offerRelicChoice();       // 到点就给三选一
};

/* ---- 设置回合数，并报告商店等级是否提升 ----
 * 商店等级是按回合推算出来的（见 getShopTier），所以没有天然的「升级事件」，
 * 只能比较前后两次推算值。长臂猿（商店升级时…）依赖它。
 * ⚠️ 8 人混战和联机是直接写 g.turn 的，那里也必须改用这个函数。 */
Game.prototype.setTurn = function (n) {
  const before = this.getShopTier();
  this.turn = n;
  const after = this.getShopTier();
  return { before: before, after: after, upgraded: after > before };
};

/* 商店等级提升时触发（长臂猿） */
Game.prototype.triggerShopTierUp = function (tier) {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  for (const p of this.team) {
    const d = p.def;
    if (d && d.hooks && d.hooks.shopTierUpgraded) {
      env.actor = p;
      d.hooks.shopTierUpgraded(env, { self: p, lvl: p.lvl, tier: tier });
    }
  }
  env.actor = null;
  const notes = describeShopNotes(this, env.events);
  if (notes.length) this.shopNotes = (this.shopNotes || []).concat(notes);
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Game: Game, CFG: CFG, ShopEnv: ShopEnv, buyablePool: buyablePool };
}
