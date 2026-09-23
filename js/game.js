'use strict';
/* ============================================================
 *  game.js — 商店 / 经济 / 回合循环 / 对手生成
 *
 *  这一层负责「游戏进程」，战斗引擎（engine.js）只被调用一次。
 *  商店阶段的宠物技能需要一个和战斗引擎 API 一致的环境，
 *  所以这里实现了 ShopEnv。
 * ============================================================ */

const CFG = {
  TEAM_MAX: 5,          // 队伍上限
  GOLD_PER_TURN: 10,    // 每回合金币（回合结束清零，不累积）
  PET_COST: 3,
  FOOD_COST: 3,
  ROLL_COST: 1,
  SELL_GAIN: 1,
  WIN_TARGET: 10,       // 10 胜结束
  LOSE_MAX: 3,          // 3 败结束
  SHOP_PET_SLOTS: 5,
  SHOP_FOOD_SLOTS: 2
};

/* 可购买池：Tier 1-3 的非代币宠物 */
function buyablePool() {
  return Object.keys(PETS).filter(function (k) {
    return !PETS[k].token && PETS[k].tier >= 1 && PETS[k].tier <= 3;
  });
}

/* ------------------------------------------------------------
 *  商店环境：让商店阶段的宠物技能拥有和战斗引擎一致的 API
 * ---------------------------------------------------------- */
function ShopEnv(game) {
  this.game = game;
  this.lastBattleLost = game.lastBattleLost;
  this.events = [];
}
ShopEnv.prototype.emit = function (ev) { this.events.push(ev); return ev; };
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
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
};
ShopEnv.prototype.addGold = function (n) { this.game.gold += n; };
ShopEnv.prototype.stock = function (foodId, cost) {
  this.game.stockFood(foodId, cost == null ? CFG.FOOD_COST : cost);
};
ShopEnv.prototype.buffShop = function (atk, hp) {
  for (const slot of this.game.shopPets) {
    if (slot) { slot.atk += atk; slot.hp += hp; }
  }
  this.emit({ e: 'shopBuff', atk: atk, hp: hp });
};

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
  this.rollShop(true);
  // 第一回合：触发开局技能（此时队伍为空，无效果）
  this.triggerTurnStart();
};

/* ---- 商店刷新 ---- */
Game.prototype.rollShop = function (isInitial) {
  const pool = buyablePool();
  for (let i = 0; i < CFG.SHOP_PET_SLOTS; i++) {
    if (!isInitial && this.frozenPets[i]) continue;   // 冻结的保留
    this.shopPets[i] = this.makeShopPet(pool[Math.floor(Math.random() * pool.length)]);
    this.frozenPets[i] = false;
  }
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    if (!isInitial && this.frozenFoods[i]) continue;
    this.shopFoods[i] = this.makeShopFood();
    this.frozenFoods[i] = false;
  }
};

// 商店里的宠物是「等级 1 的实例」，可以被 Duck 之类的技能加属性
Game.prototype.makeShopPet = function (defId) {
  const p = makePet(defId, 1);
  return p;
};

Game.prototype.makeShopFood = function () {
  const keys = Object.keys(FOODS).filter(function (k) { return !FOODS[k].token; });
  return { id: keys[Math.floor(Math.random() * keys.length)] };
};

Game.prototype.stockFood = function (foodId, cost) {
  for (let i = 0; i < this.shopFoods.length; i++) {
    if (!this.shopFoods[i]) { this.shopFoods[i] = { id: foodId, free: true }; return; }
  }
  // 槽位满了就替换第一个
  this.shopFoods[0] = { id: foodId, free: true };
};

/* ---- 购买宠物 ---- */
Game.prototype.buyPet = function (slotIdx) {
  const pet = this.shopPets[slotIdx];
  if (!pet) return { ok: false, msg: '这个位置没有宠物' };
  if (this.gold < CFG.PET_COST) return { ok: false, msg: '金币不够' };

  // 1) 先看能否合并（队伍里有同名且未满级）
  const same = this.team.find(function (p) { return p.defId === pet.defId && p.lvl < 3; });
  if (same) {
    this.gold -= CFG.PET_COST;
    this.shopPets[slotIdx] = null;
    const before = same.lvl;
    this.addExp(same, 1);
    return { ok: true, msg: petName(same.def) + ' 获得经验' + (same.lvl > before ? '，升到 ' + same.lvl + ' 级！' : ''),
             merged: true, pet: same };
  }

  // 2) 队伍已满则不能加新宠物
  if (this.team.length >= CFG.TEAM_MAX) {
    return { ok: false, msg: '队伍已满（' + CFG.TEAM_MAX + '），先卖掉一只' };
  }

  this.gold -= CFG.PET_COST;
  this.shopPets[slotIdx] = null;
  const np = clonePet(pet);
  np.side = -1;
  this.team.push(np);
  this.applyPerksFromShop(pet, np);

  // 购买触发（Otter）
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  const def = np.def;
  if (def && def.hooks && def.hooks.buy) {
    env.emit({ e: 'ability', t: np.uid, hook: 'buy' });
    def.hooks.buy(env, { self: np, lvl: np.lvl });
  }
  return { ok: true, msg: '购买了 ' + petName(np.def), pet: np };
};

// 商店里被加过属性的宠物，购买时把差值带进队伍
Game.prototype.applyPerksFromShop = function (shopPet, teamPet) {
  const base = PETS[shopPet.defId];
  const diffAtk = shopPet.atk - base.atk;
  const diffHp  = shopPet.hp  - base.hp;
  if (diffAtk > 0) teamPet.atk += diffAtk;
  if (diffHp  > 0) teamPet.hp  += diffHp;
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
    env.emit({ e: 'ability', t: pet.uid, hook: 'sell' });
    def.hooks.sell(env, { self: pet, lvl: pet.lvl });
  }

  this.team.splice(teamIdx, 1);
  this.gold += CFG.SELL_GAIN;
  return { ok: true, msg: '卖掉了 ' + petName(pet.def) + '，+' + CFG.SELL_GAIN + ' 金' };
};

/* ---- 购买食物 ---- */
Game.prototype.buyFood = function (slotIdx) {
  const f = this.shopFoods[slotIdx];
  if (!f) return { ok: false, msg: '这个位置没有道具' };
  const cost = f.free ? 0 : CFG.FOOD_COST;
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
  const cost = f.free ? 0 : CFG.FOOD_COST;
  this.gold -= cost;

  if (def.buff) {
    pet.atk += def.buff[0];
    pet.hp  += def.buff[1];
  }
  if (def.perk) {
    pet.perks.push({ id: def.perk, uses: def.perk === 'Melon' ? 1 : 1 });
  }
  this.shopFoods[this.pendingFood] = null;
  this.pendingFood = null;

  // 「友方吃食物」触发（Rabbit）
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  for (const p of this.team) {
    if (p === pet) continue;
    const d = p.def;
    if (d && d.hooks && d.hooks.friendlyAteFood) {
      env.emit({ e: 'ability', t: p.uid, hook: 'friendlyAteFood' });
      d.hooks.friendlyAteFood(env, { self: p, lvl: p.lvl, eater: pet });
    }
  }
  return { ok: true, msg: def.cn + ' 用在 ' + petName(pet.def) + ' 上' };
};

/* ---- 刷新商店 ---- */
Game.prototype.roll = function () {
  if (this.gold < CFG.ROLL_COST) return { ok: false, msg: '金币不够刷新' };
  this.gold -= CFG.ROLL_COST;
  this.pendingFood = null;
  this.rollShop(false);
  return { ok: true, msg: '刷新了商店' };
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
  for (const p of this.team) {
    p._ox = 0; p._rabbit = 0;   // 重置每回合计数
    const d = p.def;
    if (d && d.hooks && d.hooks.startTurn) {
      env.emit({ e: 'ability', t: p.uid, hook: 'startTurn' });
      d.hooks.startTurn(env, { self: p, lvl: p.lvl });
    }
  }
};

/* ---- 回合结束技能 ---- */
Game.prototype.triggerTurnEnd = function () {
  const env = new ShopEnv(this);
  env.lastBattleLost = this.lastBattleLost;
  for (const p of this.team) {
    const d = p.def;
    if (d && d.hooks && d.hooks.endTurn) {
      env.emit({ e: 'ability', t: p.uid, hook: 'endTurn' });
      d.hooks.endTurn(env, { self: p, lvl: p.lvl });
    }
  }
};

/* ------------------------------------------------------------
 *  对手生成（SAP 用的是其他玩家的队伍快照，这里按回合强度模拟）
 * ---------------------------------------------------------- */
Game.prototype.makeOpponent = function () {
  const pool = buyablePool();
  const t = this.turn;
  // 队伍规模随回合增长（1、2、2、3、3、4、4、5…）
  const size = Math.min(CFG.TEAM_MAX, 1 + Math.floor(t / 2));
  // 等级随回合提升（给玩家留出合成升级的窗口）
  let lvl = 1;
  if (t >= 11) lvl = 3;
  else if (t >= 6) lvl = 2;

  const out = [];
  for (let i = 0; i < size; i++) {
    const defId = pool[Math.floor(Math.random() * pool.length)];
    out.push(makePet(defId, lvl));
  }
  // 很后期才给对手额外属性，避免滚雪球
  const extra = Math.max(0, Math.floor((t - 10) / 4));
  if (extra > 0) {
    for (const p of out) { p.atk += extra; p.hp += extra; }
  }
  return out;
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
  const result = runBattle(this.team, opponent);

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

  this.history.push({ turn: this.turn, winner: result.winner, wins: this.wins, losses: this.losses });

  // 游戏结束判定
  if (this.wins >= CFG.WIN_TARGET) this.phase = 'gameover';
  else if (this.losses >= CFG.LOSE_MAX) this.phase = 'gameover';

  return { ok: true, result: this.lastResult };
};

/* ---- 进入下一回合 ---- */
Game.prototype.nextTurn = function () {
  if (this.phase === 'gameover') return;
  this.turn++;
  this.gold = CFG.GOLD_PER_TURN;
  this.phase = 'shop';
  this.pendingFood = null;
  this.rollShop(false);
  this.triggerTurnStart();
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Game: Game, CFG: CFG, ShopEnv: ShopEnv, buyablePool: buyablePool };
}
