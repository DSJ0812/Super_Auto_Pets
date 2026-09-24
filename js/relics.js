'use strict';
/* ============================================================
 *  relics.js — 遗物系统
 *
 *  玩法：每 3 回合（回合 3/6/9/12…）给你一次「三选一」的机会，
 *        选中的遗物全局生效、永久保留。
 *
 *  设计：遗物只通过几个明确的挂载点生效，不改引擎，
 *        所以两种模式（经典 / 8 人混战）都能直接用。
 * ============================================================ */

const RELICS = {

  /* ---- 经济类 ---- */
  vault: {
    name: 'Vault', cn: '金库', icon: '💰', tag: '经济',
    desc: '每回合额外获得 3 金',
    income: 3
  },
  bank: {
    name: 'Bank', cn: '钱庄', icon: '🏦', tag: '经济',
    desc: '利息上限 +3（攒钱更划算）｜仅 8 人混战（经典模式没有利息机制）',
    // ⚠️ 只有 TFT 经济（8 人混战）有利息。经典模式是 SAP 经济（每回合固定
    //    发钱、不累积、无利息），抽到它就是白给 —— 所以这里标上只适用于 tft。
    economy: 'tft',
    interestMax: 3
  },
  broker: {
    name: 'Broker', cn: '批发商', icon: '📦', tag: '经济',
    desc: '买宠物便宜 1 金（最低 1 金）',
    petDiscount: 1
  },
  chef: {
    name: 'Chef', cn: '营养师', icon: '🥗', tag: '经济',
    desc: '商店食物便宜 1 金（最低 0 金）',
    foodDiscount: 1
  },
  pawnshop: {
    name: 'Pawnshop', cn: '当铺', icon: '🏪', tag: '经济',
    desc: '出售宠物多得 1 金',
    sellBonus: 1
  },

  /* ---- 成长类 ---- */
  gym: {
    name: 'Gym', cn: '训练场', icon: '🏋️', tag: '成长',
    desc: '每回合开始，给最前排的友方 +1/+1',
    onTurnStart: function (g) {
      // ⚠️ 这里收到的 g 是 ShopEnv（不是 Game）—— ShopEnv.team 是个【方法】，
      //    队伍要从 g.game.team 拿。以前写成 g.team[0] 拿到的是 undefined，
      //    于是「训练场」在三个模式里一直是个白板遗物（buff 静默 return）。
      const team = relicTeamOf(g);
      if (team.length) g.buff(team[0], 1, 1);
    }
  },
  incubator: {
    name: 'Incubator', cn: '孵化器', icon: '🥚', tag: '成长',
    desc: '升星奖励改为出现 3 个「下一星级」宠物',
    tierRewardCount: 1        // 在原基础上 +1
  },
  discount: {
    name: 'Talent Scout', cn: '星探', icon: '⭐', tag: '成长',
    desc: '商店等级提前 1 回合解锁',
    tierEarly: 1
  },

  /* ---- 战斗类 ---- */
  banner: {
    name: 'Banner', cn: '战旗', icon: '🚩', tag: '战斗',
    desc: '开战时，全体友方 +4 生命',
    onBattleStart: function (team) {
      for (const p of team) { p.hp += 4; }
    }
  },
  fangs: {
    name: 'Fangs', cn: '獠牙', icon: '🦷', tag: '战斗',
    desc: '开战时，全体友方 +2 攻击',
    onBattleStart: function (team) {
      for (const p of team) { p.atk += 2; }
    }
  },
  armor: {
    name: 'Armor', cn: '铁甲', icon: '🛡️', tag: '战斗',
    desc: '开战时，全体友方获得「椰子」效果（免疫首次伤害）',
    onBattleStart: function (team) {
      for (const p of team) {
        if (!p.perks.length) p.perks = [{ id: 'Coconut', uses: 1 }];
      }
    }
  },
  mark: {
    name: 'Hunter\'s Mark', cn: '猎杀标记', icon: '🎯', tag: '战斗',
    desc: '开战时，对敌方最前排造成 3 点伤害',
    onBattleStartFoe: function (foe) {
      if (foe.length) foe[0].hp -= 3;
    }
  },
  medic: {
    name: 'Medic', cn: '急救包', icon: '💊', tag: '成长',
    // ⚠️ 以前这条写的是「每场战斗结束后回复 2 生命」，但本作战斗跑在队伍副本上，
    //    战斗内的属性变化根本不回写商店 —— 所以那句话是不可能实现的，
    //    实现上退化成了「开战时全队 +2 生命」，**和「战旗」完全重复**（只是弱化版）。
    //    现在改成一条真正独立、且两种经济模式都有效的成长效果。
    desc: '每回合开始，全体友方 +1 生命（永久；和训练场「只加最前排」互补）',
    onTurnStart: function (g) {
      const team = relicTeamOf(g);
      for (const p of team) g.buff(p, 0, 1);
    }
  }
};

/* 遗物的「回合开始」钩子收到的是 ShopEnv，不是 Game。
 * ShopEnv.team 是个方法（team(side) 返回队伍数组），所以不能直接 g.team[0]。
 * 这里统一取出队伍，避免每个遗物各写一遍、再踩同一个坑。 */
function relicTeamOf(g) {
  if (!g) return [];
  if (g.game && Array.isArray(g.game.team)) return g.game.team;
  if (Array.isArray(g.team)) return g.team;
  return [];
}

/* 可以抽到的遗物 id 列表 */
const RELIC_IDS = Object.keys(RELICS);

/* 从池子里随机抽 n 个（排除已拥有的、以及不适用于当前经济模式的）
 * ⚠️ economy: 'sap'（经典，无利息）/'tft'（8 人混战，有利息）。
 *    不带 economy 字段的遗物两种模式都能用。
 *    之前没过滤，经典模式会抽到「钱庄（利息上限 +3）」—— 经典模式根本没利息，
 *    等于白送一个空遗物位。 */
function rollRelics(owned, n, economy) {
  const eco = economy || CFG.ECONOMY;
  const pool = RELIC_IDS.filter(function (id) {
    if (owned.indexOf(id) >= 0) return false;
    const r = RELICS[id];
    return !r.economy || r.economy === eco;
  });
  const out = [];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = RNG.int(i + 1);
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  for (let i = 0; i < n && i < pool.length; i++) out.push(pool[i]);
  return out;
}

/* ------------------------------------------------------------
 *  遗物效果的应用（供 game.js / melee.js 调用）
 * ---------------------------------------------------------- */

/* 某个数值型加成的合计（income / interestMax / petDiscount / foodDiscount / sellBonus / tierRewardCount / tierEarly） */
function relicSum(game, key) {
  let sum = 0;
  for (const id of (game.relics || [])) {
    const r = RELICS[id];
    if (r && typeof r[key] === 'number') sum += r[key];
  }
  return sum;
}

/* 回合开始类效果 */
function applyRelicTurnStart(game, env) {
  for (const id of (game.relics || [])) {
    const r = RELICS[id];
    if (r && r.onTurnStart) r.onTurnStart(env || game);
  }
}

/* 战斗开始类效果（作用于传入的队伍副本，不影响商店里的原队伍） */
function applyRelicBattleStart(game, myTeam, foeTeam) {
  for (const id of (game.relics || [])) {
    const r = RELICS[id];
    if (!r) continue;
    if (r.onBattleStart) r.onBattleStart(myTeam);
    if (r.onBattleStartFoe && foeTeam) r.onBattleStartFoe(foeTeam);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RELICS: RELICS, RELIC_IDS: RELIC_IDS, rollRelics: rollRelics,
                     relicSum: relicSum, applyRelicTurnStart: applyRelicTurnStart,
                     applyRelicBattleStart: applyRelicBattleStart };
}
