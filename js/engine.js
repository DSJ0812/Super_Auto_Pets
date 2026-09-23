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
  const pet = {
    uid: ++__uid,
    defId: defId,
    def: def,
    lvl: lvl,
    atk: opts.atk != null ? opts.atk : ((def ? def.atk : 1) + bonus),
    hp:  opts.hp  != null ? opts.hp  : ((def ? def.hp  : 1) + bonus),
    perks: opts.perks ? opts.perks.map(function (p) { return { id: p.id, uses: p.uses }; }) : [],
    side: -1,
  };
  // 有些召唤物自带 Perk（例如 Deer 召唤的巴士带辣椒）
  if (def && def.perk && !pet.perks.length) pet.perks = [{ id: def.perk, uses: 1 }];
  return pet;
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
    side: p.side,
    copyDefId: p.copyDefId,     // Parrot 复制的技能来源
    swallowed: p.swallowed      // Whale 吞下去的友方
  };
}

function cloneTeam(team) {
  return team.filter(Boolean).map(function (p) {
    const cp = clonePet(p);
    // Parrot：本场战斗中以「复制来的那只宠物」的技能行动
    if (cp.copyDefId && typeof PETS !== 'undefined' && PETS[cp.copyDefId]) {
      cp.def = PETS[cp.copyDefId];
    }
    return cp;
  });
}

/* ------------------------------------------------------------
 *  战斗
 * ---------------------------------------------------------- */
function Battle(teamA, teamB, opts) {
  opts = opts || {};
  this.tier = opts.tier || 1;      // 当前商店等级（星包鹳要「上一星级」）
  this.rolls = opts.rolls || 0;    // 本回合刷新次数（星包马岛长尾狸猫）
  this.turn = opts.turn || 1;      // 当前回合数（星包剑龙按回合数放大）
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

// 造成伤害（含减伤计算），返回实际伤害。opts.friendly 见 calcDamage
Battle.prototype.hit = function (pet, amount, opts) {
  if (!pet || pet.hp <= 0) return 0;
  const dmg = this.pepperGuard(pet, this.calcDamage(pet, amount, opts));
  pet.hp -= dmg;
  this.consumeUsedDefensive(pet);        // 技能伤害也要消耗掉减伤 Perk（否则西瓜能无限挡）
  this.emit({ e: 'dmg', t: pet.uid, n: dmg });
  return dmg;
};

/* 消耗「这一次实际生效的那个」防御 Perk（由 calcDamage 记在 pet._defUsed 上）。
 * 只消耗生效的那个，所以桉树叶挡不了友方伤害时也不会被白白浪费。 */
Battle.prototype.consumeUsedDefensive = function (pet) {
  const id = pet && pet._defUsed;
  if (!id) return false;
  pet._defUsed = null;
  const pk = pet.perks.filter(function (x) { return x.id === id && x.uses > 0; })[0];
  if (!pk) return false;
  pk.uses--;
  this.emit({ e: 'perkUsed', t: pet.uid, id: id });
  return true;
};

/* 星包胡椒：生命不会低于 1，受到伤害后该 Perk 消失。
 * 只在「这一下会打死」时才介入，所以返回的是调整后的伤害。 */
Battle.prototype.pepperGuard = function (pet, dmg) {
  if (!pet || dmg <= 0 || pet.hp <= 0) return dmg;
  if (!this.hasPerk(pet, 'Pepper')) return dmg;
  if (pet.hp - dmg >= 1) return dmg;           // 打不死就不用管
  const pk = pet.perks.filter(function (x) { return x.id === 'Pepper'; })[0];
  if (pk) pk.uses = 0;
  this.emit({ e: 'perkUsed', t: pet.uid, id: 'Pepper' });
  return Math.max(0, pet.hp - 1);              // 留 1 点生命
};

/* 消耗一次某个 Perk（星包奶酪） */
Battle.prototype.usePerk = function (pet, id) {
  if (!pet) return false;
  const pk = pet.perks.filter(function (x) { return x.id === id && x.uses > 0; })[0];
  if (!pk) return false;
  pk.uses--;
  this.emit({ e: 'perkUsed', t: pet.uid, id: id });
  return true;
};

// 伤害计算：Melon 减 20、Garlic 减 2、Eucalyptus 减 4、Coconut 完全免疫一次；否则最低 1
// 注意：Perk 只能带一个，但这里仍用「只吃第一个」的写法做双保险，
//       避免任何情况下出现减伤叠加（red += 会变成减 40）
// opts.friendly = true 表示这是【友方】造成的伤害：桉树叶挡不了（官方原文如此）
Battle.prototype.calcDamage = function (pet, raw, opts) {
  const friendly = !!(opts && opts.friendly);
  let dmg = null;
  let used = null;
  for (let i = 0; i < pet.perks.length; i++) {
    const pk = pet.perks[i];
    if (pk.uses === 0) continue;
    if (pk.id === 'Melon')   { dmg = Math.max(0, raw - 20); used = pk.id; break; }
    if (pk.id === 'Garlic')  { dmg = Math.max(0, raw - 2); used = pk.id; break; }
    if (pk.id === 'Eucalyptus') { if (friendly) continue; dmg = Math.max(0, raw - 4); used = pk.id; break; }
    if (pk.id === 'Coconut') { dmg = 0; used = pk.id; break; }   // 官方：Ignore damage once
  }
  // 记下「这一次实际吃掉了哪个防御 Perk」，好让调用方精确消耗它。
  // ⚠️ 以前只有 exchange()（普通攻击）会消耗，导致技能伤害能无限次吃西瓜减伤
  //    —— 实测西瓜能连挡两次 10 点技能伤害都不消失。这里补上。
  if (used) pet._defUsed = used;
  if (dmg === null) dmg = Math.max(1, raw);
  // 星包麻雀给的一次性减伤（和 Food Perk 无关，所以单独记一个字段）
  if (pet.reduceOnce > 0) {
    dmg = Math.max(0, dmg - pet.reduceOnce);
    pet.reduceOnce = 0;
  }
  // 异常状态「虚弱」：受到 +3 伤害（官方 Ailments 页原文 "Take +3 damage"）
  if (pet.weak) dmg += 3;
  return dmg;
};

/* 施加异常状态「虚弱」。官方规则：宠物同时只能有 1 个异常状态，
 * 而获得新的异常状态或 Food Perk 都会覆盖旧的 —— 所以两边互相清除。 */
Battle.prototype.inflictWeak = function (pet) {
  if (!pet || pet.hp <= 0) return;
  pet.perks = [];              // 异常状态顶掉 Food Perk
  pet.weak = true;
  this.emit({ e: 'weak', t: pet.uid });
};

// 消耗一次性防御道具（Melon / Garlic / Eucalyptus / Coconut）
Battle.prototype.consumeDefensive = function (pet) {
  pet._defUsed = null;             // 清掉标记：上面已经全消耗过了，别让 hit() 再消耗一次
  for (let i = 0; i < pet.perks.length; i++) {
    const pk = pet.perks[i];
    if ((pk.id === 'Melon' || pk.id === 'Garlic' ||
         pk.id === 'Eucalyptus' || pk.id === 'Coconut') && pk.uses > 0) {
      pk.uses--;
      this.emit({ e: 'perkUsed', t: pet.uid, id: pk.id });
    }
  }
};

// 宠物是否带着某个还有效的 Perk
Battle.prototype.hasPerk = function (pet, id) {
  if (!pet) return false;
  for (let i = 0; i < pet.perks.length; i++) {
    if (pet.perks[i].id === id && pet.perks[i].uses > 0) return true;
  }
  return false;
};

Battle.prototype.givePerk = function (pet, id, uses) {
  if (!pet || pet.hp <= 0) return;
  // 官方规则：一只宠物同时只能带 1 个 Food Perk，新的覆盖旧的
  pet.perks = [{ id: id, uses: uses == null ? 1 : uses }];
  pet.weak = false;                       // Food Perk 会顶掉异常状态
  this.emit({ e: 'perk', t: pet.uid, id: id });
  this.notifyPerkGained(pet, id);
};

/* 友方获得 Perk 时（星包鹤鸵） */
Battle.prototype.notifyPerkGained = function (pet, perkId) {
  const mates = this.sides[pet.side];
  for (let i = 0; i < mates.length; i++) {
    if (mates[i] !== pet && mates[i].hp > 0) {
      this.triggerOn('friendGainedPerk', mates[i], { target: pet, perk: perkId });
    }
  }
};

/* 移除某个 Perk（星包海鹦 / 鸽子要把草莓标记「花掉」）。返回是否真的移除了 */
Battle.prototype.removePerk = function (pet, id) {
  if (!pet) return false;
  const before = pet.perks.length;
  pet.perks = pet.perks.filter(function (p) { return p.id !== id; });
  if (pet.perks.length === before) return false;
  pet._lostPerk = id;
  this.emit({ e: 'perkLost', t: pet.uid, id: id });
  // 友方失去 Perk 时（星包真迅猛龙）
  const mates = this.sides[pet.side];
  for (let i = 0; i < mates.length; i++) {
    if (mates[i] !== pet && mates[i].hp > 0) {
      this.triggerOn('friendLostPerk', mates[i], { target: pet, perk: id });
    }
  }
  return true;
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

  // 自己被召唤时的触发（Scorpion「被召唤时获得花生」）
  this.triggerOn('summoned', pet, {});

  // 友方被召唤时的触发（Horse / Dog / Turkey 等）
  const team2 = this.sides[side];
  for (let i = 0; i < team2.length; i++) {
    if (team2[i] !== pet && team2[i].hp > 0) {
      this.triggerOn('friendSummoned', team2[i], { target: pet });
    }
  }

  // 敌方被召唤时的触发（星包鬣蜥）
  const foes = this.sides[1 - side];
  for (let i = 0; i < foes.length; i++) {
    if (foes[i].hp > 0) this.triggerOn('foeSummoned', foes[i], { target: pet });
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
    out.push(pool.splice(RNG.int(pool.length), 1)[0]);
  }
  return out;
};

/* ---- 推位 ----
 * 把 pet 朝「前排方向」（索引 0）推 spaces 格。星包的吉娃娃 / 海马等用。
 * 必须记日志：回放靠它把展示镜像里的顺序也改掉，否则回放位置会错。 */
Battle.prototype.push = function (pet, spaces) {
  if (!pet || pet.hp <= 0 || spaces <= 0) return;
  const team = this.sides[pet.side];
  const from = team.indexOf(pet);
  if (from < 0) return;
  const to = Math.max(0, from - spaces);
  if (to === from) return;
  team.splice(from, 1);
  team.splice(to, 0, pet);
  this.emit({ e: 'push', t: pet.uid, side: pet.side, from: from, to: to });

  // 敌方被推时的触发（星包鬣蜥）
  const foes = this.sides[1 - pet.side];
  for (let i = 0; i < foes.length; i++) {
    if (foes[i].hp > 0) this.triggerOn('foePushed', foes[i], { target: pet });
  }
};

/* ---- N 格内范围伤害 ----
 * 萤火虫「对 N 格内所有宠物造成伤害」。
 * 战场是一条线：我方索引 0 是最前排，敌方索引 0 也是其最前排，两者相邻。
 * 所以：同侧距离 = |i - myIdx|，对面距离 = myIdx + k + 1（相邻记 1 格）。 */
Battle.prototype.within = function (pet, spaces) {
  if (!pet) return [];
  const side = pet.side;
  const my = this.sides[side].indexOf(pet);
  if (my < 0) return [];
  const out = [];
  this.sides[side].forEach(function (p, i) {
    if (Math.abs(i - my) <= spaces) out.push(p);
  });
  this.sides[1 - side].forEach(function (p, k) {
    if (my + k + 1 <= spaces) out.push(p);
  });
  return out;
};

Battle.prototype.hitWithin = function (pet, spaces, dmg) {
  const targets = this.within(pet, spaces);
  for (const t of targets) this.hit(t, dmg);
  return targets;
};

/* ---- 战斗内给经验（每 1 点经验 = +1/+1，够了就升级）----
 * 蟑螂「召唤熟蟑螂并给它 +N 经验」用。 */
Battle.prototype.grantExp = function (pet, n) {
  if (!pet) return;
  let gained = 0;
  for (let i = 0; i < n; i++) {
    if (pet.lvl >= 3) break;              // 已满级就不再吃经验
    pet.exp = (pet.exp || 0) + 1;
    pet.atk += 1;
    pet.hp  += 1;
    gained++;
    if (pet.exp >= EXP_BONUS[pet.lvl + 1]) {
      pet.lvl += 1;
      // 友方升级（星包水母）
      const mates = this.sides[pet.side];
      for (let k = 0; k < mates.length; k++) {
        if (mates[k] !== pet && mates[k].hp > 0) {
          this.triggerOn('friendLevelUp', mates[k], { target: pet });
        }
      }
    }
  }
  if (gained) this.emit({ e: 'buff', t: pet.uid, atk: gained, hp: gained });
};

/* ------------------------------------------------------------
 *  触发系统
 *  hook 名与 data.js 中宠物技能的 hooks 键一一对应
 * ---------------------------------------------------------- */
Battle.prototype.triggerOn = function (hook, pet, ctx) {
  if (!pet) return;
  // 有些钩子必须在血量归零后仍然触发：
  //  · faint（遗言）—— 这是它的定义
  //  · hurt（受伤）—— 受伤发生在伤害那一刻，死亡是之后单独结算的。
  //    挡住的话「致命一击不算受伤」，像星包金枪鱼这种按受伤次数结算的就会少数一次
  //    （被秒杀时甚至数为 0）。实测 turtle 包原有宠物不受影响。
  if (hook !== 'faint' && hook !== 'hurt' && pet.hp <= 0) return;
  const def = pet.def;
  if (!def || !def.hooks || !def.hooks[hook]) return;
  ctx = Object.assign({ self: pet, lvl: pet.lvl }, ctx || {});
  this.emit({ e: 'ability', t: pet.uid, hook: hook });
  def.hooks[hook](this, ctx);

  // Tiger：「紧邻后方有老虎」时，这只宠物的技能会额外重复一次（按 1 级结算）
  // 排除 faint 避免遗言链出现意外重复
  if (hook !== 'faint') {
    const behind = this.sides[pet.side][this.sides[pet.side].indexOf(pet) + 1];
    if (behind && behind.defId === 'Tiger' && behind.hp > 0) {
      this.emit({ e: 'ability', t: pet.uid, hook: hook });
      def.hooks[hook](this, Object.assign({}, ctx, { lvl: 1 }));
    }
  }
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

    // 3) Honey / Popcorn 之类：死亡时召唤
    for (let k = 0; k < dead.perks.length; k++) {
      const pk = dead.perks[k];
      if (pk.id === 'Honey' && pk.uses > 0) {
        pk.uses--;
        this.summon(side, idx, 'Bee', { atk: 1, hp: 1, lvl: 1 });
      } else if (pk.id === 'Popcorn' && pk.uses > 0) {
        // 星包爆米花：阵亡后召唤 1 个【同星级】的随机宠物
        // ⚠️ 用召唤物自己的基础属性 —— 不能沿用 dead 的属性，因为 dead.hp 已经是
        //    负的（刚被打死），照抄会召出一只「生下来就死了」的宠物
        pk.uses--;
        const t = (dead.def || {}).tier || 1;
        const pool = petsOfTier(t);
        if (pool.length) this.summon(side, idx, RNG.pick(pool), { lvl: 1 });
      }
    }

    // 4) 真正移除（后排补位）
    const pos = this.sides[side].indexOf(dead);
    if (pos >= 0) this.sides[side].splice(pos, 1);

    // 5) 后方见证者：前排阵亡
    for (let k = 0; k < behindList.length; k++) {
      if (behindList[k].hp > 0) this.triggerOn('aheadFaint', behindList[k], { dead: dead });
    }

    // 6) 全体友方见证：有同伴阵亡（Shark / Fly 用）
    const rest = this.sides[side].slice();
    for (let k = 0; k < rest.length; k++) {
      if (rest[k].hp > 0) this.triggerOn('friendFaints', rest[k], { dead: dead });
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

  let dmgToB = this.calcDamage(b, a.atk);
  let dmgToA = this.calcDamage(a, b.atk);

  // 星包奶酪：攻击时伤害翻倍，一次（先乘再交给花生，顺序不影响结果）
  if (dmgToB > 0 && this.hasPerk(a, 'Cheese')) { dmgToB *= 2; this.usePerk(a, 'Cheese'); }
  if (dmgToA > 0 && this.hasPerk(b, 'Cheese')) { dmgToA *= 2; this.usePerk(b, 'Cheese'); }

  // Peanut：带花生的宠物「秒杀」被它攻击并受伤的目标（血量 > 1 时直接归零）
  if (dmgToB > 0 && this.hasPerk(a, 'Peanut') && b.hp > 1) dmgToB = b.hp;
  if (dmgToA > 0 && this.hasPerk(b, 'Peanut') && a.hp > 1) dmgToA = a.hp;

  // 星包胡椒：生命不会低于 1（攻击路径也要过一遍，和 hit() 一致）
  dmgToA = this.pepperGuard(a, dmgToA);
  dmgToB = this.pepperGuard(b, dmgToB);

  // 同时结算
  a.hp -= dmgToA;
  b.hp -= dmgToB;
  this.emit({ e: 'attack', a: a.uid, b: b.uid, dmgA: dmgToA, dmgB: dmgToB });

  this.consumeDefensive(a);
  this.consumeDefensive(b);

  // Chili：攻击时对「第二个敌人」额外 5 点伤害
  if (this.hasPerk(a, 'Chili')) {
    const t2 = this.sides[1 - a.side][1];
    if (t2 && t2.hp > 0) this.hit(t2, 5);
  }
  if (this.hasPerk(b, 'Chili')) {
    const t2 = this.sides[1 - b.side][1];
    if (t2 && t2.hp > 0) this.hit(t2, 5);
  }

  // 受伤触发
  if (dmgToA > 0) {
    this.triggerOn('hurt', a, { dmg: dmgToA });
    // 友方受伤的见证者（Wolverine）
    for (const fp of this.sides[a.side].slice()) {
      if (fp !== a && fp.hp > 0) this.triggerOn('friendHurt', fp, { hurt: a });
    }
    // 敌方受伤时（星包蟾蜍）
    for (const fp of this.sides[1 - a.side].slice()) {
      if (fp.hp > 0) this.triggerOn('foeHurt', fp, { hurt: a });
    }
  }
  if (dmgToB > 0) {
    this.triggerOn('hurt', b, { dmg: dmgToB });
    for (const fp of this.sides[b.side].slice()) {
      if (fp !== b && fp.hp > 0) this.triggerOn('friendHurt', fp, { hurt: b });
    }
    // 敌方受伤时（星包蟾蜍「敌人受伤 → 使它虚弱」）
    for (const fp of this.sides[1 - b.side].slice()) {
      if (fp.hp > 0) this.triggerOn('foeHurt', fp, { hurt: b });
    }
  }

  // 攻击者自身触发
  this.triggerOn('selfAttack', a, {});
  this.triggerOn('selfAttack', b, {});

  // 任意友方攻击时（星包海鹦「友方攻击时…」）
  for (const fp of this.sides[a.side].slice()) {
    if (fp !== a && fp.hp > 0) this.triggerOn('friendAttack', fp, { attacker: a });
  }
  for (const fp of this.sides[b.side].slice()) {
    if (fp !== b && fp.hp > 0) this.triggerOn('friendAttack', fp, { attacker: b });
  }

  // 击倒触发（Hippo / Rhino）：必须在死亡结算前，宠物还活着才能吃到加成
  if (b.hp <= 0) this.triggerOn('knockOut', a, { target: b });
  if (a.hp <= 0) this.triggerOn('knockOut', b, { target: a });

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
function runBattle(teamA, teamB, opts) {
  return new Battle(teamA, teamB, opts).run();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makePet: makePet, Battle: Battle, runBattle: runBattle, EXP_BONUS: EXP_BONUS };
}
