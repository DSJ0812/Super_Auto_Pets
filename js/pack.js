'use strict';
/* ============================================================
 *  pack.js — 联机状态「打包 / 解包」（服务器和浏览器共用）
 *
 *  服务器是唯一权威，它把每个玩家自己那份状态打包发给对应客户端；
 *  客户端解包成一个真正的 Game 实例，于是 render.js 里所有渲染函数
 *  都不用改就能直接用。
 *
 *  ⚠️ 两条铁律：
 *   1. def 是对象引用，JSON 里存不了 → 只存 defId，解包时查 PETS 还原
 *   2. 解包时【绝不调用 makePet】—— 那会重新发 uid，
 *      而战斗日志里的事件全是按 uid 索引的，一旦对不上回放就全乱
 * ============================================================ */

/* 宠物 → 纯数据 */
function petToJSON(p) {
  if (!p) return null;
  return {
    uid: p.uid,
    defId: p.defId,
    lvl: p.lvl,
    exp: p.exp,
    atk: p.atk,
    hp: p.hp,
    side: p.side,
    perks: (p.perks || []).map(function (x) { return { id: x.id, uses: x.uses }; }),
    copyDefId: p.copyDefId,
    // Whale 吞下去的友方是嵌套宠物，需要递归
    swallowed: p.swallowed ? petToJSON(p.swallowed) : undefined
  };
}

/* 纯数据 → 宠物（保留 uid，见文件头铁律 2） */
function petFromJSON(j) {
  if (!j) return null;
  const p = {
    uid: j.uid,
    defId: j.defId,
    lvl: j.lvl,
    exp: j.exp,
    def: (typeof PETS !== 'undefined' && PETS[j.defId]) ? PETS[j.defId] : null,
    atk: j.atk,
    hp: j.hp,
    perks: (j.perks || []).map(function (x) { return { id: x.id, uses: x.uses }; }),
    side: (j.side == null) ? -1 : j.side
  };
  if (j.copyDefId) p.copyDefId = j.copyDefId;
  if (j.swallowed) p.swallowed = petFromJSON(j.swallowed);
  return p;
}

/* 打包「某个座位自己那份」状态
 * seat = { idx, name, kind, hp, alive, rank, streak, ready } */
function packSelf(game, seat) {
  if (!game) return null;
  return {
    seat: seat.idx,
    name: seat.name,
    kind: seat.kind,
    hp: seat.hp,
    alive: !!seat.alive,
    rank: seat.rank,
    streak: seat.streak,
    ready: !!seat.ready,

    gold: game.gold,
    turn: game.turn,
    team: game.team.map(petToJSON),
    shopPets: game.shopPets.map(function (p) { return p ? petToJSON(p) : null; }),
    shopFoods: game.shopFoods.map(function (f) { return f ? { id: f.id, cost: f.cost } : null; }),
    frozenPets: game.frozenPets.slice(),
    frozenFoods: game.frozenFoods.slice(),
    pendingFood: game.pendingFood,
    pendingRelicChoice: game.pendingRelicChoice ? game.pendingRelicChoice.slice() : null,
    relics: game.relics.slice(),
    shopNotes: (game.shopNotes || []).slice(),
    lastIncome: game.lastIncome || null,
    foodDiscount: game.foodDiscount || 0,
    freeRolls: game.freeRolls || 0
  };
}

/* 解包成真正的 Game 实例（带 Game.prototype 上的全部方法）
 * 用 Object.create 绕过构造函数 —— 否则会重新 rollShop / triggerTurnStart，
 * 那就等于客户端自己又开了一局，和服务器完全对不上 */
function gameFromPack(pk) {
  if (!pk) return null;
  const g = Object.create(Game.prototype);
  g.gold = pk.gold;
  g.turn = pk.turn;
  g.wins = 0;                 // 8 人混战不按胜场结算
  g.losses = 0;
  g.team = pk.team.map(petFromJSON);
  g.shopPets = (pk.shopPets || []).map(function (j) { return j ? petFromJSON(j) : null; });
  g.shopFoods = (pk.shopFoods || []).map(function (f) { return f ? { id: f.id, cost: f.cost } : null; });
  g.frozenPets = (pk.frozenPets || []).slice();
  g.frozenFoods = (pk.frozenFoods || []).slice();
  g.lastBattleLost = false;
  g.phase = 'shop';
  g.lastResult = null;
  g.pendingFood = (pk.pendingFood == null) ? null : pk.pendingFood;
  g.history = [];
  g.shopNotes = (pk.shopNotes || []).slice();
  g.foodDiscount = pk.foodDiscount || 0;
  g.freeRolls = pk.freeRolls || 0;
  g.relics = (pk.relics || []).slice();
  g.pendingRelicChoice = pk.pendingRelicChoice ? pk.pendingRelicChoice.slice() : null;
  g.relicChoiceDone = {};
  g.lastIncome = pk.lastIncome || null;
  g.streak = pk.streak || 0;
  return g;
}

/* 8 人血量面板的数据（两种模式共用格式） */
function rosterOf(seats) {
  return seats.map(function (s) {
    return {
      idx: s.idx,
      name: s.name,
      kind: s.kind,
      hp: s.hp,
      alive: !!s.alive,
      rank: s.rank,
      streak: s.streak,
      ready: !!s.ready,
      connected: (s.kind === 'ai') ? true : !!s.connected,
      teamSize: s.game ? s.game.team.length : 0
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    petToJSON: petToJSON, petFromJSON: petFromJSON,
    packSelf: packSelf, gameFromPack: gameFromPack, rosterOf: rosterOf
  };
}
