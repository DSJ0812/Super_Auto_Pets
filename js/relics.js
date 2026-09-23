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
    desc: '利息上限 +3（攒钱更划算）',
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
      if (g.team.length) g.buff(g.team[0], 1, 1);
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
    name: 'Medic', cn: '急救包', icon: '💊', tag: '战斗',
    desc: '每场战斗结束后，你的宠物回复 2 生命（不会超过战斗前的值）',
    // 说明：本作战斗不保留属性变化，这条实际效果是「战斗中的友方 +2 生命」
    onBattleStart: function (team) {
      for (const p of team) { p.hp += 2; }
    }
  }
};

/* 可以抽到的遗物 id 列表 */
const RELIC_IDS = Object.keys(RELICS);

/* 从池子里随机抽 n 个（排除已拥有的） */
function rollRelics(owned, n) {
  const pool = RELIC_IDS.filter(function (id) { return owned.indexOf(id) < 0; });
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
