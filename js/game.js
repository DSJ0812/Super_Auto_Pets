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
  AP_SCALE: 0.4,        // 幽灵行动点折扣。官方曲线是给「完整 6 tier 池 + 真实玩家快照」设计的，
                        // 本作只有 Turtle Pack 61 只、对手全是幽灵，按原版会碾压玩家。
                        // 实测：0.40→约 46%，0.35→53%（测试 AI 是下限，真人会更高）

  /* ---- 经济模式（8 人混战会切成 'tft'）----
   * sap：每回合固定 10 金、不累积、宠物统一 3 金          （经典模式）
   * tft：金币累积 + 利息 + 连胜奖励、宠物按星级定价        （8 人混战） */
  ECONOMY: 'sap',
  TFT_BASE_GOLD: 5,        // 每回合基础金币
  TFT_INTEREST_PER: 10,    // 每存满 10 金吃 1 点利息
  TFT_INTEREST_MAX: 5,     // 利息上限
  TFT_STREAK_CAP: 3,       // 连胜/连败奖励上限
  TFT_ROLL_COST: 2,        // 刷新费用

  /* ---- 宠物包（一局只用一包，见 PACKS / activePack）----
   * turtle = 原有 61 只；star = 星包 76 只 */
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
 * 没写 pack 字段的宠物都算 turtle（原有 61 只），这样不用改老数据。 */
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
 * 官方里商店阶段宠物不会真的死，所以最低留 1 点生命。 */
ShopEnv.prototype.hit = function (pet, n) {
  if (!pet) return 0;
  const before = pet.hp;
  pet.hp = Math.max(1, pet.hp - n);
  const real = before - pet.hp;
  if (real) this.emit({ e: 'dmg', t: pet.uid, n: real });
  return real;
};

/* 移除 Perk（海鹦 / 鸽子要把草莓标记「花掉」） */
ShopEnv.prototype.removePerk = function (pet, id) {
  if (!pet) return false;
  const before = pet.perks.length;
  pet.perks = pet.perks.filter(function (p) { return p.id !== id; });
  if (pet.perks.length === before) return false;
  this.emit({ e: 'perkLost', t: pet.uid, id: id });
  return true;
};

ShopEnv.prototype.hasPerk = function (pet, id) {
  if (!pet) return false;
  return pet.perks.some(function (p) { return p.id === id; });
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

/* 移除 Perk（商店侧）也要通知友方（星包真迅猛龙） */
ShopEnv.prototype.removePerkNotify = function (pet, id) {
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
      return;
    }
  }
  // 2) 其次找没被冻结的槽位
  for (let i = 0; i < this.shopFoods.length; i++) {
    if (!this.frozenFoods[i]) { this.shopFoods[i] = item; return; }
  }
  // 3) 全被冻结了，才覆盖第一个
  this.shopFoods[0] = item;
  this.frozenFoods[0] = false;
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
    const before = same.lvl;
    this.addExp(same, 1);
    const bn = this.notifyFriendBought(same);
    return { ok: true, msg: petName(same.def) + ' 获得经验' + (same.lvl > before ? '，升到 ' + same.lvl + ' 级！' : '')
             + (bn.length ? ' · ' + bn.join(' · ') : ''),
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
  this.applyPerksFromShop(pet, np);

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

// 商店里被加过属性的宠物，购买时把差值带进队伍
Game.prototype.applyPerksFromShop = function (shopPet, teamPet) {
  const base = PETS[shopPet.defId];
  const diffAtk = shopPet.atk - base.atk;
  const diffHp  = shopPet.hp  - base.hp;
  if (diffAtk > 0) teamPet.atk += diffAtk;
  if (diffHp  > 0) teamPet.hp  += diffHp;
};

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
  if (cur >= 6) return;                      // 已是最高星级
  const pool = buyablePool().filter(function (id) {
    return PETS[id].tier === cur + 1;
  });
  if (!pool.length) return;

  // 随机挑 N 个格子替换（洗牌取前 N；遗物「孵化器」会让 N 变大）
  const want = 2 + relicSum(this, 'tierRewardCount');
  const idxs = [];
  for (let i = 0; i < this.shopPets.length; i++) idxs.push(i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = RNG.int(i + 1);
    const tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp;
  }
  for (let k = 0; k < want && k < idxs.length; k++) {
    const slot = idxs[k];
    this.shopPets[slot] = this.makeShopPet(RNG.pick(pool));
    this.frozenPets[slot] = false;
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
  const sellGain = CFG.SELL_GAIN + relicSum(this, 'sellBonus') + petBonus;   // 遗物「当铺」
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

  if (def.buff) {
    // Cat：食物效果翻倍，每回合最多 2 次
    let mul = 1;
    const cat = this.team.find(function (p) {
      return p.defId === 'Cat' && p !== pet && (p._catUsed || 0) < 2;
    });
    if (cat) {
      mul = 2;
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
  for (const p of this.team) {
    p._ox = 0; p._rabbit = 0;   // 重置每回合计数
    p._catUsed = 0;             // Cat 的食物翻倍次数
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
  // 对本作（61 只宠物、纯幽灵对手）偏强。实测折扣 0.7 时通关率约 45%。
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
  const ids = rollRelics(this.relics, 3);
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
