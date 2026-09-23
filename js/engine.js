'use strict';
/* ============================================================
 *  engine.js — Super Auto Pets 战斗引擎
 *
 *  三条设计原则（整个项目的核心）：
 *
 *   1. 引擎只负责「算」，完全不知道界面长什么样。
 *
 *   2. 战斗过程记录成一串【有序事件】，UI 拿着这串事件逐条播放。
 *      → 引擎与表现层彻底解耦，还白送战斗回放功能。
 *
 *   3. 技能是数据（见 data.js），引擎只提供通用原语。
 *      → 加宠物 = 加一条数据，不用改引擎。
 *
 *  战斗机制依据 SAP 官方规则实现，核心几条：
 *   · 每个「战斗回合」= 双方最前排宠物【同时】互相造成伤害（不是先手制）
 *   · 伤害 = 攻击方攻击力，最低 1 点（有 Melon 时可减到 0）
 *   · 阶段顺序：开战 → 攻击前 → 互殴 → 受伤/死亡/攻击后 → 前排见证 → 回合结束
 *   · 宠物死亡后从队伍移除，后排补位
 * ============================================================ */

/* 等级 → 累计经验加成。每 1 点经验 = +1/+1。
 * lvl1 = 0 exp；  2 次合成到 lvl2 = 2 exp → +2/+2；  再到 lvl3 = 5 exp → +5/+5
 * （来源：官方规则 —— 3 只合成到 2 级，再 3 只到 3 级） */
const EXP_BONUS = { 1: 0, 2: 2, 3: 5 };

let __uid = 0;

/* ------------------------------------------------------------
 *  宠物实例
 * ---------------------------------------------------------- */
function makePet(defId, lvl, opts) {
  lvl = lvl || 1;
  opts = opts || {};
  const def = (typeof PETS !== 'undefined' && PETS[defId]) ? PETS[defId] : null;
  const bonus = EXP_BONUS[lvl] || 0;
  return {
    uid: ++__uid,
    defId: defId,
    def: def,
    lvl: lvl,
    atk: opts.atk != null ? opts.atk : ((def ? def.atk : 1) + bonus),
    hp:  opts.hp  != null ? opts.hp  : ((def ? def.hp  : 1) + bonus),
    perks: opts.perks ? opts.perks.map(function (p) { return { id: p.id, uses: p.uses }; }) : [],
    side: -1,
  };
}

function clonePet(p) {
  // 保留原 uid：这样战斗日志里的事件可以直接对应到界面上的宠物
  return {
    uid: p.uid,
    defId: p.defId,
    def: p.def,
    lvl: p.lvl,
    atk: p.atk,
    hp: p.hp,
    perks: p.perks.map(function (x) { return { id: x.id, uses: x.uses }; }),
    side: p.side
  };
}

function cloneTeam(team) {
  return team.filter(Boolean).map(clonePet);
}

/* ------------------------------------------------------------
 *  战斗
 * ---------------------------------------------------------- */
function Battle(teamA, teamB) {
  this.sides = [cloneTeam(teamA), cloneTeam(teamB)];
  this.sides[0].forEach(function (p) { p.side = 0; });
  this.sides[1].forEach(function (p) { p.side = 1; });
  this.log = [];
  this.gold = 0;          // 战斗中获得的额外金币（如 Pig 出售，不在战斗里）
}

/* ---- 基础查询 ---- */
Battle.prototype.team  = function (side) { return this.sides[side]; };
Battle.prototype.front = function (side) { return this.sides[side][0] || null; };
Battle.prototype.allPets = function () { return this.sides[0].concat(this.sides[1]); };
Battle.prototype.indexOf = function (pet) { return this.sides[pet.side].indexOf(pet); };
Battle.prototype.byUid = function (uid) {
  const a = this.sides[0].concat(this.sides[1]);
  for (let i = 0; i < a.length; i++) if (a[i].uid === uid) return a[i];
  return null;
};

/* ---- 日志 ---- */
Battle.prototype.emit = function (ev) { this.log.push(ev); return ev; };

/* ---- 技能原语：供 data.js 里的技能函数调用 ---- */

// 加属性（不会把宠物加死）
Battle.prototype.buff = function (pet, atk, hp) {
  if (!pet || pet.hp <= 0) return;
  if (atk) pet.atk += atk;
  if (hp)  pet.hp = Math.max(1, pet.hp + hp);
  this.emit({ e: 'buff', t: pet.uid, atk: atk || 0, hp: hp || 0 });
};

// 造成伤害（含减伤计算），返回实际伤害
Battle.prototype.hit = function (pet, amount) {
  if (!pet || pet.hp <= 0) return 0;
  const dmg = this.calcDamage(pet, amount);
  pet.hp -= dmg;
  this.emit({ e: 'dmg', t: pet.uid, n: dmg });
  return dmg;
};

// 伤害计算：Melon 减 20，最低可到 0；否则最低 1
Battle.prototype.calcDamage = function (pet, raw) {
  let red = 0;
  for (let i = 0; i < pet.perks.length; i++) {
    const pk = pet.perks[i];
    if (pk.uses === 0) continue;
    if (pk.id === 'Melon')  red += 20;
    if (pk.id === 'Garlic') red += 2;
  }
  if (red > 0) return Math.max(0, raw - red);
  return Math.max(1, raw);
};

// 消耗一次性减伤道具（Melon / Garlic）
Battle.prototype.consumeDefensive = function (pet) {
  for (let i = 0; i < pet.perks.length; i++) {
    const pk = pet.perks[i];
    if ((pk.id === 'Melon' || pk.id === 'Garlic') && pk.uses > 0) {
      pk.uses--;
      this.emit({ e: 'perkUsed', t: pet.uid, id: pk.id });
    }
  }
};

Battle.prototype.givePerk = function (pet, id, uses) {
  if (!pet || pet.hp <= 0) return;
  pet.perks.push({ id: id, uses: uses == null ? 1 : uses });
  this.emit({ e: 'perk', t: pet.uid, id: id });
};

// 召唤：index 为插入位置
Battle.prototype.summon = function (side, index, defId, opts) {
  opts = opts || {};
  const pet = makePet(defId, opts.lvl || 1, { atk: opts.atk, hp: opts.hp });
  pet.side = side;
  const team = this.sides[side];
  const idx = Math.max(0, Math.min(index == null ? team.length : index, team.length));
  team.splice(idx, 0, pet);
  this.emit({ e: 'summon', t: pet.uid, side: side, pos: idx, defId: defId, atk: pet.atk, hp: pet.hp, lvl: pet.lvl });

  // 友方被召唤时的触发（Horse / Dog 等）
  const team2 = this.sides[side];
  for (let i = 0; i < team2.length; i++) {
    if (team2[i] !== pet && team2[i].hp > 0) {
      this.triggerOn('friendSummoned', team2[i], { target: pet });
    }
  }
  return pet;
};

/* ---- 位置辅助 ---- */
// 自己之后（更靠后）的第 n 个友方，n 从 1 开始
Battle.prototype.behind = function (pet, n) {
  const team = this.sides[pet.side];
  const i = team.indexOf(pet);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < team.length && out.length < n; k++) out.push(team[k]);
  return out;
};
// 自己之前（更靠前）的第 n 个友方
Battle.prototype.ahead = function (pet, n) {
  const team = this.sides[pet.side];
  const i = team.indexOf(pet);
  if (i < 0) return [];
  const out = [];
  for (let k = i - 1; k >= 0 && out.length < n; k--) out.push(team[k]);
  return out;
};
Battle.prototype.friends = function (pet) {
  return this.sides[pet.side].filter(function (p) { return p !== pet; });
};
Battle.prototype.foes = function (pet) {
  return this.sides[1 - pet.side].slice();
};

Battle.prototype.random = function (arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
};

/* ------------------------------------------------------------
 *  触发系统
 *  hook 名与 data.js 中宠物技能的 hooks 键一一对应
 * ---------------------------------------------------------- */
Battle.prototype.triggerOn = function (hook, pet, ctx) {
  if (!pet) return;
  // 注意：faint（遗言）必须在宠物血量归零后依然能触发，所以这里放行
  if (hook !== 'faint' && pet.hp <= 0) return;
  const def = pet.def;
  if (!def || !def.hooks || !def.hooks[hook]) return;
  ctx = Object.assign({ self: pet, lvl: pet.lvl }, ctx || {});
  this.emit({ e: 'ability', t: pet.uid, hook: hook });
  def.hooks[hook](this, ctx);
};

// 对某一阵营全体触发（按队伍从前到后）
Battle.prototype.triggerSide = function (hook, side, ctx) {
  const team = this.sides[side].slice();
  for (let i = 0; i < team.length; i++) this.triggerOn(hook, team[i], ctx);
};

/* ------------------------------------------------------------
 *  死亡结算（含遗言链）
 *  宠物 hp<=0 时：先触发 faint 技能，再从队伍移除
 * ---------------------------------------------------------- */
Battle.prototype.resolveDeaths = function () {
  let guard = 0;
  while (guard++ < 60) {
    let dead = null, side = -1, idx = -1;
    for (let s = 0; s < 2 && !dead; s++) {
      for (let i = 0; i < this.sides[s].length; i++) {
        if (this.sides[s][i].hp <= 0) { dead = this.sides[s][i]; side = s; idx = i; break; }
      }
    }
    if (!dead) break;

    // 1) 标记死亡 + 记录「前排阵亡」给后面的宠物
    this.emit({ e: 'faint', t: dead.uid, side: side, pos: idx });
    const behindList = this.sides[side].slice(idx + 1);

    // 2) 遗言类技能
    this.triggerOn('faint', dead, {});

    // 3) Honey 之类：死亡时召唤
    for (let k = 0; k < dead.perks.length; k++) {
      const pk = dead.perks[k];
      if (pk.id === 'Honey' && pk.uses > 0) {
        pk.uses--;
        this.summon(side, idx, 'Bee', { atk: 1, hp: 1, lvl: 1 });
      }
    }

    // 4) 真正移除（后排补位）
    const pos = this.sides[side].indexOf(dead);
    if (pos >= 0) this.sides[side].splice(pos, 1);

    // 5) 后方见证者：前排阵亡
    for (let k = 0; k < behindList.length; k++) {
      if (behindList[k].hp > 0) this.triggerOn('aheadFaint', behindList[k], { dead: dead });
    }
  }
};

/* ------------------------------------------------------------
 *  单次交锋：双方前排【同时】互殴
 * ---------------------------------------------------------- */
Battle.prototype.exchange = function (a, b) {
  a = this.sides[a.side][0];
  b = this.sides[b.side][0];
  if (!a || !b || a.hp <= 0 || b.hp <= 0) return;

  const dmgToB = this.calcDamage(b, a.atk);
  const dmgToA = this.calcDamage(a, b.atk);

  // 同时结算
  a.hp -= dmgToA;
  b.hp -= dmgToB;
  this.emit({ e: 'attack', a: a.uid, b: b.uid, dmgA: dmgToA, dmgB: dmgToB });

  this.consumeDefensive(a);
  this.consumeDefensive(b);

  // 受伤触发
  if (dmgToA > 0) this.triggerOn('hurt', a, { dmg: dmgToA });
  if (dmgToB > 0) this.triggerOn('hurt', b, { dmg: dmgToB });

  // 攻击者自身触发
  this.triggerOn('selfAttack', a, {});
  this.triggerOn('selfAttack', b, {});

  // 死亡（含遗言链）
  this.resolveDeaths();

  // 后排见证：前排攻击过了
  const behindA = this.sides[a.side][1];
  if (behindA) this.triggerOn('aheadAttack', behindA, { ahead: a });
  const behindB = this.sides[b.side][1];
  if (behindB) this.triggerOn('aheadAttack', behindB, { ahead: b });

  // 攻击后（如 Elephant）
  if (a.hp > 0) this.triggerOn('afterAttack', a, {});
  if (b.hp > 0) this.triggerOn('afterAttack', b, {});

  this.resolveDeaths();
};

/* ------------------------------------------------------------
 *  主循环
 * ---------------------------------------------------------- */
Battle.prototype.run = function () {
  this.emit({ e: 'battleStart' });

  // ---- 阶段 1：开战技能 ----
  this.triggerSide('startOfBattle', 0);
  this.triggerSide('startOfBattle', 1);
  this.resolveDeaths();

  let phase = 1;
  let guard = 0;

  while (guard++ < 80) {
    if (!this.sides[0].length || !this.sides[1].length) break;

    this.emit({ e: 'phase', n: phase });

    const a = this.sides[0][0];
    const b = this.sides[1][0];
    if (!a || !b) break;

    // ---- 阶段 2：攻击前 ----
    this.triggerOn('beforeAttack', a, {});
    this.triggerOn('beforeAttack', b, {});
    this.resolveDeaths();

    if (!this.sides[0].length || !this.sides[1].length) break;

    // ---- 阶段 3：互殴 ----
    const a2 = this.sides[0][0];
    const b2 = this.sides[1][0];
    if (a2 && b2) this.exchange(a2, b2);

    phase++;
  }

  const win0 = this.sides[0].length > 0;
  const win1 = this.sides[1].length > 0;
  let winner;
  if (win0 && win1) winner = 'draw';
  else if (win0) winner = 0;
  else if (win1) winner = 1;
  else winner = 'draw';

  this.emit({ e: 'battleEnd', winner: winner });
  return { winner: winner, log: this.log, final: this.sides };
};

/* 便捷入口 */
function runBattle(teamA, teamB) {
  return new Battle(teamA, teamB).run();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makePet: makePet, Battle: Battle, runBattle: runBattle, EXP_BONUS: EXP_BONUS };
}
