'use strict';
/* ============================================================
 *  data.js — 宠物与道具数据
 *
 *  ★ 加宠物只需要在这里加一条数据，不用动引擎。
 *
 *  数据来源：官方 wiki (superautopets.wiki.gg)，Turtle Pack Tier 1-3。
 *  技能 hooks 键说明：
 *    战斗内：startOfBattle / beforeAttack / hurt / faint / selfAttack
 *            afterAttack / aheadAttack / aheadFaint / friendSummoned
 *    商店内：buy / sell / levelUp / startTurn / endTurn / friendlyAteFood
 *
 *  技能函数签名 (g, c)：
 *    g = 环境（战斗中为 Battle 引擎，商店中为 ShopEnv，两者 API 一致）
 *    c = { self: 宠物实例, lvl: 等级, ...额外上下文 }
 *
 *  等级数值：lvl1/2/3 的属性 = 基础 + {0, 2, 5}（每点经验 +1/+1）
 * ============================================================ */

/* 等级换算成技能强度时用的系数 */
const LVL_MUL = [0, 0.5, 1, 1.5];   // 用于 "50%/100%/150%" 类技能

/* ------------------------------------------------------------
 *  代币宠物（由技能召唤，不出现在商店）
 * ---------------------------------------------------------- */
const TOKEN_PETS = {
  ZombieCricket: { name: 'Zombie Cricket', cn: '僵尸蟋蟀', tier: 0, atk: 1, hp: 1, token: true },
  DirtyRat:      { name: 'Dirty Rat',      cn: '脏老鼠',     tier: 0, atk: 1, hp: 1, token: true },
  Ram:           { name: 'Ram',            cn: '公羊',       tier: 0, atk: 2, hp: 2, token: true },
  Bee:           { name: 'Bee',            cn: '蜜蜂',       tier: 0, atk: 1, hp: 1, token: true }
};

/* ------------------------------------------------------------
 *  宠物
 * ---------------------------------------------------------- */
const PETS = {

  /* ==================== Tier 1 ==================== */

  Ant: {
    name: 'Ant', cn: '蚂蚁', tier: 1, atk: 2, hp: 2,
    texts: ['阵亡：给随机 1 个友方 +1/+1', '阵亡：给随机 1 个友方 +2/+2', '阵亡：给随机 1 个友方 +3/+3'],
    hooks: {
      faint: function (g, c) {
        const t = g.random(g.friends(c.self), 1);
        if (t[0]) g.buff(t[0], c.lvl, c.lvl);
      }
    }
  },

  Beaver: {
    name: 'Beaver', cn: '海狸', tier: 1, atk: 3, hp: 2,
    texts: ['出售：给随机 2 个友方 +1 攻击', '出售：给随机 2 个友方 +2 攻击', '出售：给随机 2 个友方 +3 攻击'],
    hooks: {
      sell: function (g, c) {
        const t = g.random(g.friends(c.self), 2);
        for (const p of t) g.buff(p, c.lvl, 0);
      }
    }
  },

  Cricket: {
    name: 'Cricket', cn: '蟋蟀', tier: 1, atk: 1, hp: 3,
    texts: ['阵亡：召唤 1 个 1/1 僵尸蟋蟀', '阵亡：召唤 1 个 2/2 僵尸蟋蟀', '阵亡：召唤 1 个 3/3 僵尸蟋蟀'],
    hooks: {
      faint: function (g, c) {
        g.summon(c.self.side, g.indexOf(c.self), 'ZombieCricket', { atk: c.lvl, hp: c.lvl, lvl: c.lvl });
      }
    }
  },

  Duck: {
    name: 'Duck', cn: '鸭子', tier: 1, atk: 2, hp: 3,
    texts: ['出售：给商店宠物 +1 生命', '出售：给商店宠物 +2 生命', '出售：给商店宠物 +3 生命'],
    hooks: {
      sell: function (g, c) { g.buffShop(c.lvl, 0); }
    }
  },

  Fish: {
    name: 'Fish', cn: '鱼', tier: 1, atk: 2, hp: 3,
    texts: ['升级：给随机 2 个友方 +1/+1', '升级：给随机 2 个友方 +2/+2', '无技能'],
    hooks: {
      levelUp: function (g, c) {
        if (c.lvl >= 3) return;              // 3 级无技能（官方规则）
        const t = g.random(g.friends(c.self), 2);
        for (const p of t) g.buff(p, c.lvl, c.lvl);
      }
    }
  },

  Horse: {
    name: 'Horse', cn: '马', tier: 1, atk: 2, hp: 1,
    texts: ['友方被召唤：给它 +1 攻击（本场战斗）', '友方被召唤：给它 +2 攻击（本场战斗）', '友方被召唤：给它 +3 攻击（本场战斗）'],
    hooks: {
      friendSummoned: function (g, c) { g.buff(c.target, c.lvl, 0); }
    }
  },

  Mosquito: {
    name: 'Mosquito', cn: '蚊子', tier: 1, atk: 2, hp: 2,
    texts: ['开战：对随机 1 个敌人造成 1 伤害', '开战：对随机 2 个敌人造成 1 伤害', '开战：对随机 3 个敌人造成 1 伤害'],
    hooks: {
      startOfBattle: function (g, c) {
        const t = g.random(g.foes(c.self), c.lvl);
        for (const p of t) g.hit(p, 1);
      }
    }
  },

  Otter: {
    name: 'Otter', cn: '水獭', tier: 1, atk: 1, hp: 3,
    texts: ['购买：给随机 1 个友方 +1 生命', '购买：给随机 2 个友方 +1 生命', '购买：给随机 3 个友方 +1 生命'],
    hooks: {
      buy: function (g, c) {
        const t = g.random(g.friends(c.self), c.lvl);
        for (const p of t) g.buff(p, 0, 1);
      }
    }
  },

  Pig: {
    name: 'Pig', cn: '猪', tier: 1, atk: 4, hp: 1,
    texts: ['出售：获得 +1 金币', '出售：获得 +2 金币', '出售：获得 +3 金币'],
    hooks: {
      sell: function (g, c) { g.addGold(c.lvl); }
    }
  },

  Pigeon: {
    name: 'Pigeon', cn: '鸽子', tier: 1, atk: 3, hp: 1,
    // 简化：原版库存 Bread Crumbs，本版统一用苹果（效果等价于 +1/+1 道具）
    texts: ['出售：库存 1 个免费苹果', '出售：库存 2 个免费苹果', '出售：库存 3 个免费苹果'],
    hooks: {
      sell: function (g, c) {
        for (let i = 0; i < c.lvl; i++) g.stock('Apple', 0);
      }
    }
  },

  Sloth: {
    name: 'Sloth', cn: '树懒', tier: 1, atk: 1, hp: 1,
    texts: ['无技能。「树懒没有特殊能力。战斗力有点可怜。但它真的相信你！」',
            '无技能。「树懒没有特殊能力。战斗力有点可怜。但它真的相信你！」',
            '无技能。「树懒没有特殊能力。战斗力有点可怜。但它真的相信你！」']
  },

  /* ==================== Tier 2 ==================== */

  Crab: {
    name: 'Crab', cn: '螃蟹', tier: 2, atk: 4, hp: 1,
    texts: ['开战：复制最健康友方 50% 的生命', '开战：复制最健康友方 100% 的生命', '开战：复制最健康友方 150% 的生命'],
    hooks: {
      startOfBattle: function (g, c) {
        const fs = g.friends(c.self);
        if (!fs.length) return;
        let maxHp = 0;
        for (const p of fs) maxHp = Math.max(maxHp, p.hp);
        const val = Math.floor(maxHp * LVL_MUL[c.lvl]);
        if (val > c.self.hp) {
          const delta = val - c.self.hp;
          c.self.hp = val;
          g.emit({ e: 'buff', t: c.self.uid, atk: 0, hp: delta });
        }
      }
    }
  },

  Flamingo: {
    name: 'Flamingo', cn: '火烈鸟', tier: 2, atk: 3, hp: 2,
    texts: ['阵亡：给后方最近 2 个友方 +1/+1', '阵亡：给后方最近 2 个友方 +2/+2', '阵亡：给后方最近 2 个友方 +3/+3'],
    hooks: {
      faint: function (g, c) {
        const t = g.behind(c.self, 2);
        for (const p of t) g.buff(p, c.lvl, c.lvl);
      }
    }
  },

  Hedgehog: {
    name: 'Hedgehog', cn: '刺猬', tier: 2, atk: 4, hp: 2,
    texts: ['阵亡：对所有宠物造成 2 伤害', '阵亡：对所有宠物造成 4 伤害', '阵亡：对所有宠物造成 6 伤害'],
    hooks: {
      faint: function (g, c) {
        const dmg = c.lvl * 2;
        const all = g.allPets().filter(function (p) { return p !== c.self && p.hp > 0; });
        for (const p of all) g.hit(p, dmg);
      }
    }
  },

  Kangaroo: {
    name: 'Kangaroo', cn: '袋鼠', tier: 2, atk: 2, hp: 3,
    texts: ['前方友方攻击时：获得 +1/+1', '前方友方攻击时：获得 +2/+2', '前方友方攻击时：获得 +3/+3'],
    hooks: {
      aheadAttack: function (g, c) { g.buff(c.self, c.lvl, c.lvl); }
    }
  },

  Peacock: {
    name: 'Peacock', cn: '孔雀', tier: 2, atk: 2, hp: 5,
    texts: ['受伤时：获得 +4 攻击', '受伤时：获得 +8 攻击', '受伤时：获得 +12 攻击'],
    hooks: {
      hurt: function (g, c) { g.buff(c.self, c.lvl * 4, 0); }
    }
  },

  Rat: {
    name: 'Rat', cn: '老鼠', tier: 2, atk: 3, hp: 6,
    texts: ['阵亡：在敌方前排召唤 1 个 1/1 脏老鼠', '阵亡：在敌方前排召唤 2 个 1/1 脏老鼠', '阵亡：在敌方前排召唤 3 个 1/1 脏老鼠'],
    hooks: {
      faint: function (g, c) {
        const foeSide = 1 - c.self.side;
        for (let i = 0; i < c.lvl; i++) {
          g.summon(foeSide, i, 'DirtyRat', { atk: 1, hp: 1, lvl: 1 });
        }
      }
    }
  },

  Snail: {
    name: 'Snail', cn: '蜗牛', tier: 2, atk: 2, hp: 2,
    texts: ['回合结束：若上场战斗失败，给前方最近 3 个友方 +1 攻击',
            '回合结束：若上场战斗失败，给前方最近 3 个友方 +2 攻击',
            '回合结束：若上场战斗失败，给前方最近 3 个友方 +3 攻击'],
    hooks: {
      endTurn: function (g, c) {
        if (!g.lastBattleLost) return;
        const t = g.ahead(c.self, 3);
        for (const p of t) g.buff(p, c.lvl, 0);
      }
    }
  },

  Spider: {
    name: 'Spider', cn: '蜘蛛', tier: 2, atk: 2, hp: 2,
    texts: ['阵亡：召唤 1 个 1 级 3 阶宠物，属性为 2/2',
            '阵亡：召唤 1 个 2 级 3 阶宠物，属性为 4/4',
            '阵亡：召唤 1 个 3 级 3 阶宠物，属性为 6/6'],
    hooks: {
      faint: function (g, c) {
        const pool = Object.keys(PETS).filter(function (k) {
          return PETS[k].tier === 3 && !PETS[k].token;
        });
        if (!pool.length) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        g.summon(c.self.side, g.indexOf(c.self), pick, { atk: c.lvl * 2, hp: c.lvl * 2, lvl: c.lvl });
      }
    }
  },

  Swan: {
    name: 'Swan', cn: '天鹅', tier: 2, atk: 1, hp: 2,
    texts: ['回合开始：获得 +1 金币', '回合开始：获得 +2 金币', '回合开始：获得 +3 金币'],
    hooks: {
      startTurn: function (g, c) { g.addGold(c.lvl); }
    }
  },

  Worm: {
    name: 'Worm', cn: '虫子', tier: 2, atk: 1, hp: 3,
    texts: ['回合开始：库存 1 个 2 金苹果', '回合开始：库存 1 个 2 金优质苹果', '回合开始：库存 1 个 2 金顶级苹果'],
    hooks: {
      startTurn: function (g, c) {
        const f = c.lvl === 1 ? 'Apple' : (c.lvl === 2 ? 'BetterApple' : 'BestApple');
        g.stock(f, 2);
      }
    }
  },

  /* ==================== Tier 3 ==================== */

  Badger: {
    name: 'Badger', cn: '獾', tier: 3, atk: 6, hp: 3,
    texts: ['阵亡：对相邻宠物造成 50% 攻击力伤害', '阵亡：对相邻宠物造成 100% 攻击力伤害', '阵亡：对相邻宠物造成 150% 攻击力伤害'],
    hooks: {
      faint: function (g, c) {
        const team = g.team(c.self.side);
        const i = team.indexOf(c.self);
        const dmg = Math.floor(c.self.atk * LVL_MUL[c.lvl]);
        const targets = [team[i - 1], team[i + 1]];
        for (const p of targets) if (p && p.hp > 0) g.hit(p, dmg);
      }
    }
  },

  Camel: {
    name: 'Camel', cn: '骆驼', tier: 3, atk: 3, hp: 4,
    texts: ['受伤时：给后方最近友方 +1 攻击 +2 生命', '受伤时：给后方最近友方 +2 攻击 +4 生命', '受伤时：给后方最近友方 +3 攻击 +6 生命'],
    hooks: {
      hurt: function (g, c) {
        const b = g.behind(c.self, 1)[0];
        if (b) g.buff(b, c.lvl, c.lvl * 2);
      }
    }
  },

  Dodo: {
    name: 'Dodo', cn: '渡渡鸟', tier: 3, atk: 4, hp: 2,
    texts: ['开战：把 50% 攻击力给前方最近友方', '开战：把 100% 攻击力给前方最近友方', '开战：把 150% 攻击力给前方最近友方'],
    hooks: {
      startOfBattle: function (g, c) {
        const a = g.ahead(c.self, 1)[0];
        if (a) g.buff(a, Math.floor(c.self.atk * LVL_MUL[c.lvl]), 0);
      }
    }
  },

  Dog: {
    name: 'Dog', cn: '狗', tier: 3, atk: 3, hp: 2,
    texts: ['友方被召唤：获得 +2/+1（本场战斗）', '友方被召唤：获得 +4/+2（本场战斗）', '友方被召唤：获得 +6/+3（本场战斗）'],
    hooks: {
      friendSummoned: function (g, c) { g.buff(c.self, c.lvl * 2, c.lvl); }
    }
  },

  Dolphin: {
    name: 'Dolphin', cn: '海豚', tier: 3, atk: 4, hp: 3,
    texts: ['开战：对生命最低的敌人造成 4 伤害', '开战：对生命最低的敌人造成 4 伤害，触发 2 次', '开战：对生命最低的敌人造成 4 伤害，触发 3 次'],
    hooks: {
      startOfBattle: function (g, c) {
        for (let i = 0; i < c.lvl; i++) {
          const foes = g.foes(c.self).filter(function (p) { return p.hp > 0; });
          if (!foes.length) return;
          foes.sort(function (x, y) { return x.hp - y.hp; });
          g.hit(foes[0], 4);
        }
      }
    }
  },

  Elephant: {
    name: 'Elephant', cn: '大象', tier: 3, atk: 3, hp: 7,
    texts: ['攻击后：对后方最近友方造成 1 伤害', '攻击后：对后方最近友方造成 1 伤害，触发 2 次', '攻击后：对后方最近友方造成 1 伤害，触发 3 次'],
    hooks: {
      afterAttack: function (g, c) {
        for (let i = 0; i < c.lvl; i++) {
          const b = g.behind(c.self, 1)[0];
          if (!b || b.hp <= 0) return;
          g.hit(b, 1);
        }
      }
    }
  },

  Giraffe: {
    name: 'Giraffe', cn: '长颈鹿', tier: 3, atk: 1, hp: 2,
    texts: ['回合结束：给前方最近 1 个友方 +1/+1', '回合结束：给前方最近 2 个友方 +1/+1', '回合结束：给前方最近 3 个友方 +1/+1'],
    hooks: {
      endTurn: function (g, c) {
        const t = g.ahead(c.self, c.lvl);
        for (const p of t) g.buff(p, 1, 1);
      }
    }
  },

  Ox: {
    name: 'Ox', cn: '牛', tier: 3, atk: 1, hp: 3,
    texts: ['前方友方阵亡：获得西瓜效果和 +1 攻击，每回合 1 次',
            '前方友方阵亡：获得西瓜效果和 +1 攻击，每回合 2 次',
            '前方友方阵亡：获得西瓜效果和 +1 攻击，每回合 3 次'],
    hooks: {
      aheadFaint: function (g, c) {
        c.self._ox = (c.self._ox || 0) + 1;
        if (c.self._ox > c.lvl) return;
        g.givePerk(c.self, 'Melon', 1);
        g.buff(c.self, 1, 0);
      }
    }
  },

  Rabbit: {
    name: 'Rabbit', cn: '兔子', tier: 3, atk: 1, hp: 2,
    texts: ['友方吃食物：给它 +1 生命，每回合 4 次', '友方吃食物：给它 +2 生命，每回合 4 次', '友方吃食物：给它 +3 生命，每回合 4 次'],
    hooks: {
      friendlyAteFood: function (g, c) {
        c.self._rabbit = (c.self._rabbit || 0) + 1;
        if (c.self._rabbit > 4) return;
        g.buff(c.eater, 0, c.lvl);
      }
    }
  },

  Sheep: {
    name: 'Sheep', cn: '羊', tier: 3, atk: 2, hp: 2,
    texts: ['阵亡：召唤 2 个 2/2 公羊', '阵亡：召唤 2 个 4/4 公羊', '阵亡：召唤 2 个 6/6 公羊'],
    hooks: {
      faint: function (g, c) {
        const idx = g.indexOf(c.self);
        g.summon(c.self.side, idx, 'Ram', { atk: c.lvl * 2, hp: c.lvl * 2, lvl: 1 });
        g.summon(c.self.side, idx + 1, 'Ram', { atk: c.lvl * 2, hp: c.lvl * 2, lvl: 1 });
      }
    }
  }
};

/* 合并代币宠物 */
for (const k in TOKEN_PETS) PETS[k] = TOKEN_PETS[k];

/* ------------------------------------------------------------
 *  显示名：优先用中文，找不到就退回英文（UI 与游戏消息统一走这里）
 * ---------------------------------------------------------- */
function petName(def) {
  if (!def) return '?';
  return def.cn || def.name || '?';
}

/* ------------------------------------------------------------
 *  道具（食物）
 *  buff: [攻击, 生命]；perk: 挂在宠物身上的被动效果
 * ---------------------------------------------------------- */
const FOODS = {
  Apple:       { name: 'Apple',       cn: '苹果',     cost: 3, buff: [1, 1], text: '给一只宠物 +1/+1' },
  BetterApple: { name: 'Better Apple', cn: '优质苹果', cost: 3, buff: [2, 2], text: '给一只宠物 +2/+2', token: true },
  BestApple:   { name: 'Best Apple',  cn: '顶级苹果', cost: 3, buff: [3, 3], text: '给一只宠物 +3/+3', token: true },
  Honey:       { name: 'Honey',       cn: '蜂蜜',     cost: 3, perk: 'Honey',   text: '宠物阵亡时召唤一只 1/1 蜜蜂' },
  Melon:       { name: 'Melon',       cn: '西瓜',     cost: 3, perk: 'Melon',   text: '受到伤害减少 20（生效 1 次）' }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PETS: PETS, FOODS: FOODS, TOKEN_PETS: TOKEN_PETS, LVL_MUL: LVL_MUL };
}
