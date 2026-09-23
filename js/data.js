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
  Bee:           { name: 'Bee',            cn: '蜜蜂',       tier: 0, atk: 1, hp: 1, token: true },
  // T4-T6 扩展带来的新召唤物
  Bus:           { name: 'Bus',            cn: '巴士',       tier: 5, atk: 5, hp: 3, token: true, perk: 'Chili' },
  Chick:         { name: 'Chick',          cn: '小鸡',       tier: 0, atk: 1, hp: 1, token: true },
  ZombieFly:     { name: 'Zombie Fly',     cn: '僵尸苍蝇',   tier: 0, atk: 4, hp: 4, token: true }
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
  },

  /* ==================== Tier 4 ==================== */

  Bison: {
    name: 'Bison', cn: '野牛', tier: 4, atk: 4, hp: 4,
    texts: ['回合结束：若有 3 级友方，获得 +1/+2', '回合结束：若有 3 级友方，获得 +2/+4', '回合结束：若有 3 级友方，获得 +3/+6'],
    hooks: {
      endTurn: function (g, c) {
        const has = g.friends(c.self).some(function (p) { return p.lvl >= 3; });
        if (has) g.buff(c.self, c.lvl, c.lvl * 2);
      }
    }
  },

  Blowfish: {
    name: 'Blowfish', cn: '河豚', tier: 4, atk: 3, hp: 6,
    texts: ['受伤时：对随机 1 个敌人造成 3 伤害', '受伤时：对随机 1 个敌人造成 3 伤害', '受伤时：对随机 1 个敌人造成 3 伤害'],
    hooks: {
      hurt: function (g, c) {
        const t = g.random(g.foes(c.self).filter(function (p) { return p.hp > 0; }), 1);
        if (t[0]) g.hit(t[0], 3);
      }
    }
  },

  Deer: {
    name: 'Deer', cn: '鹿', tier: 4, atk: 2, hp: 2,
    texts: ['阵亡：召唤 1 个带辣椒的 5/3 巴士', '阵亡：召唤 1 个带辣椒的 5/3 巴士', '阵亡：召唤 1 个带辣椒的 5/3 巴士'],
    hooks: {
      faint: function (g, c) {
        g.summon(c.self.side, g.indexOf(c.self), 'Bus', { atk: 5, hp: 3, lvl: 1 });
      }
    }
  },

  Hippo: {
    name: 'Hippo', cn: '河马', tier: 4, atk: 4, hp: 5,
    texts: ['击倒敌人时：获得 +3/+3', '击倒敌人时：获得 +6/+6', '击倒敌人时：获得 +9/+9'],
    hooks: {
      knockOut: function (g, c) { g.buff(c.self, c.lvl * 3, c.lvl * 3); }
    }
  },

  Parrot: {
    name: 'Parrot', cn: '鹦鹉', tier: 4, atk: 4, hp: 2,
    texts: ['回合结束：复制前方最近友方的技能（按 1 级），持续到本场战斗结束',
            '回合结束：复制前方最近友方的技能（按 1 级），持续到本场战斗结束',
            '回合结束：复制前方最近友方的技能（按 1 级），持续到本场战斗结束'],
    hooks: {
      endTurn: function (g, c) {
        const a = g.ahead(c.self, 1)[0];
        if (a) c.self.copyDefId = a.defId;   // 战斗中以它的技能行动
      }
    }
  },

  Penguin: {
    name: 'Penguin', cn: '企鹅', tier: 4, atk: 1, hp: 3,
    texts: ['回合结束：给 2 个 2 级或以上的友方 +1/+1', '回合结束：给 2 个 2 级或以上的友方 +1/+1', '回合结束：给 2 个 2 级或以上的友方 +1/+1'],
    hooks: {
      endTurn: function (g, c) {
        const cands = g.friends(c.self).filter(function (p) { return p.lvl >= 2; });
        const t = g.random(cands, 2);
        for (const p of t) g.buff(p, 1, 1);
      }
    }
  },

  Skunk: {
    name: 'Skunk', cn: '臭鼬', tier: 4, atk: 3, hp: 5,
    texts: ['开战：把生命最高的敌人生命削减 33%', '开战：把生命最高的敌人生命削减 33%', '开战：把生命最高的敌人生命削减 33%'],
    hooks: {
      startOfBattle: function (g, c) {
        const foes = g.foes(c.self).filter(function (p) { return p.hp > 0; });
        if (!foes.length) return;
        foes.sort(function (x, y) { return y.hp - x.hp; });
        const target = foes[0];
        const cut = Math.floor(target.hp / 3);
        if (cut > 0) g.hit(target, cut);
      }
    }
  },

  Squirrel: {
    name: 'Squirrel', cn: '松鼠', tier: 4, atk: 2, hp: 5,
    texts: ['回合开始：本回合商店食物打 1 折（便宜 1 金）', '回合开始：本回合商店食物打 1 折（便宜 1 金）', '回合开始：本回合商店食物打 1 折（便宜 1 金）'],
    hooks: {
      startTurn: function (g, c) { g.discountFood(1); }
    }
  },

  Turtle: {
    name: 'Turtle', cn: '乌龟', tier: 4, atk: 2, hp: 5,
    texts: ['阵亡：给后方最近的友方西瓜', '阵亡：给后方最近的友方西瓜', '阵亡：给后方最近的友方西瓜'],
    hooks: {
      faint: function (g, c) {
        const b = g.behind(c.self, 1)[0];
        if (b && b.hp > 0) g.givePerk(b, 'Melon', 1);
      }
    }
  },

  Whale: {
    name: 'Whale', cn: '鲸鱼', tier: 4, atk: 3, hp: 7,
    texts: ['开战：吞掉前方最近的友方，自己阵亡时按 1 级把它吐出来',
            '开战：吞掉前方最近的友方，自己阵亡时按 2 级把它吐出来',
            '开战：吞掉前方最近的友方，自己阵亡时按 3 级把它吐出来'],
    hooks: {
      startOfBattle: function (g, c) {
        const a = g.ahead(c.self, 1)[0];
        if (!a || a.hp <= 0) return;
        c.self.swallowed = { defId: a.defId, atk: a.atk, hp: a.hp, lvl: c.lvl };
        const team = g.team(c.self.side);
        const i = team.indexOf(a);
        if (i >= 0) team.splice(i, 1);
      },
      faint: function (g, c) {
        const s = c.self.swallowed;
        if (!s) return;
        const idx = Math.min(g.indexOf(c.self), g.team(c.self.side).length);
        g.summon(c.self.side, idx, s.defId, { atk: s.atk, hp: s.hp, lvl: s.lvl });
      }
    }
  },

  /* ==================== Tier 5 ==================== */

  Armadillo: {
    name: 'Armadillo', cn: '犰狳', tier: 5, atk: 2, hp: 6,
    texts: ['开战：给所有宠物 +8 生命', '开战：给所有宠物 +8 生命', '开战：给所有宠物 +8 生命'],
    hooks: {
      startOfBattle: function (g, c) {
        const all = g.allPets().filter(function (p) { return p.hp > 0; });
        for (const p of all) g.buff(p, 0, 8);
      }
    }
  },

  Cow: {
    name: 'Cow', cn: '奶牛', tier: 5, atk: 4, hp: 6,
    texts: ['购买：把食物商店换成 2 个免费牛奶', '购买：换成 2 个免费优质牛奶', '购买：换成 2 个免费顶级牛奶'],
    hooks: {
      buy: function (g, c) {
        const f = c.lvl === 1 ? 'Milk' : (c.lvl === 2 ? 'BetterMilk' : 'BestMilk');
        g.replaceFoodShop(f);
      }
    }
  },

  Crocodile: {
    name: 'Crocodile', cn: '鳄鱼', tier: 5, atk: 8, hp: 4,
    texts: ['开战：对最后一名敌人造成 8 伤害', '开战：对最后一名敌人造成 8 伤害', '开战：对最后一名敌人造成 8 伤害'],
    hooks: {
      startOfBattle: function (g, c) {
        const foes = g.foes(c.self).filter(function (p) { return p.hp > 0; });
        if (!foes.length) return;
        g.hit(foes[foes.length - 1], 8);
      }
    }
  },

  Monkey: {
    name: 'Monkey', cn: '猴子', tier: 5, atk: 1, hp: 2,
    texts: ['回合结束：给最前排的友方 +2/+2', '回合结束：给最前排的友方 +2/+2', '回合结束：给最前排的友方 +2/+2'],
    hooks: {
      endTurn: function (g, c) {
        const team = g.team(c.self.side);
        if (team.length) g.buff(team[0], 2, 2);
      }
    }
  },

  Rhino: {
    name: 'Rhino', cn: '犀牛', tier: 5, atk: 6, hp: 9,
    texts: ['击倒敌人时：对第一名敌人造成 4 伤害（对 1 级宠物翻倍）',
            '击倒敌人时：对第一名敌人造成 4 伤害（对 1 级宠物翻倍）',
            '击倒敌人时：对第一名敌人造成 4 伤害（对 1 级宠物翻倍）'],
    hooks: {
      knockOut: function (g, c) {
        const foes = g.foes(c.self).filter(function (p) { return p.hp > 0; });
        if (!foes.length) return;
        const t = foes[0];
        g.hit(t, t.lvl === 1 ? 8 : 4);
      }
    }
  },

  Rooster: {
    name: 'Rooster', cn: '公鸡', tier: 5, atk: 6, hp: 4,
    texts: ['阵亡：召唤 1 只小鸡（1 血，攻击为自身的 50%）',
            '阵亡：召唤 1 只小鸡（1 血，攻击为自身的 50%）',
            '阵亡：召唤 1 只小鸡（1 血，攻击为自身的 50%）'],
    hooks: {
      faint: function (g, c) {
        const atk = Math.max(1, Math.floor(c.self.atk / 2));
        g.summon(c.self.side, g.indexOf(c.self), 'Chick', { atk: atk, hp: 1, lvl: 1 });
      }
    }
  },

  Scorpion: {
    name: 'Scorpion', cn: '蝎子', tier: 5, atk: 1, hp: 1,
    texts: ['被召唤时：获得花生（秒杀）', '被召唤时：获得花生（秒杀）', '被召唤时：获得花生（秒杀）'],
    hooks: {
      summoned: function (g, c) { g.givePerk(c.self, 'Peanut', 1); }
    }
  },

  Seal: {
    name: 'Seal', cn: '海豹', tier: 5, atk: 3, hp: 8,
    texts: ['友方吃食物时：给随机 3 个友方 +1 攻击', '友方吃食物时：给随机 3 个友方 +1 攻击', '友方吃食物时：给随机 3 个友方 +1 攻击'],
    hooks: {
      friendlyAteFood: function (g, c) {
        const t = g.random(g.friends(c.self), 3);
        for (const p of t) g.buff(p, 1, 0);
      }
    }
  },

  Shark: {
    name: 'Shark', cn: '鲨鱼', tier: 5, atk: 2, hp: 2,
    texts: ['友方阵亡时：获得 +2/+2', '友方阵亡时：获得 +4/+4', '友方阵亡时：获得 +6/+6'],
    hooks: {
      friendFaints: function (g, c) { g.buff(c.self, c.lvl * 2, c.lvl * 2); }
    }
  },

  Turkey: {
    name: 'Turkey', cn: '火鸡', tier: 5, atk: 3, hp: 4,
    texts: ['友方被召唤时：给它 +3/+1', '友方被召唤时：给它 +3/+1', '友方被召唤时：给它 +3/+1'],
    hooks: {
      friendSummoned: function (g, c) { g.buff(c.target, 3, 1); }
    }
  },

  /* ==================== Tier 6 ==================== */

  Boar: {
    name: 'Boar', cn: '野猪', tier: 6, atk: 10, hp: 6,
    texts: ['攻击前：获得 +4/+2', '攻击前：获得 +8/+4', '攻击前：获得 +12/+6'],
    hooks: {
      beforeAttack: function (g, c) { g.buff(c.self, c.lvl * 4, c.lvl * 2); }
    }
  },

  Cat: {
    name: 'Cat', cn: '猫', tier: 6, atk: 4, hp: 5,
    texts: ['食物效果翻倍，每回合 2 次', '食物效果翻倍，每回合 2 次', '食物效果翻倍，每回合 2 次'],
    hooks: {}
  },

  Dragon: {
    name: 'Dragon', cn: '龙', tier: 6, atk: 6, hp: 8,
    texts: ['购买 1 级友方时：给全体友方 +1/+1', '购买 1 级友方时：给全体友方 +2/+2', '购买 1 级友方时：给全体友方 +3/+3'],
    hooks: {
      friendBought: function (g, c) {
        if (!c.bought || c.bought.lvl !== 1) return;
        const t = g.friends(c.self);
        for (const p of t) g.buff(p, c.lvl, c.lvl);
      }
    }
  },

  Fly: {
    name: 'Fly', cn: '苍蝇', tier: 6, atk: 5, hp: 5,
    texts: ['友方阵亡时：在原地召唤 1 个 4/4 僵尸苍蝇，每场 3 次',
            '友方阵亡时：在原地召唤 1 个 4/4 僵尸苍蝇，每场 3 次',
            '友方阵亡时：在原地召唤 1 个 4/4 僵尸苍蝇，每场 3 次'],
    hooks: {
      friendFaints: function (g, c) {
        c.self._fly = (c.self._fly || 0) + 1;
        if (c.self._fly > 3) return;
        const team = g.team(c.self.side);
        g.summon(c.self.side, team.length, 'ZombieFly', { atk: 4, hp: 4, lvl: 1 });
      }
    }
  },

  Gorilla: {
    name: 'Gorilla', cn: '大猩猩', tier: 6, atk: 7, hp: 10,
    texts: ['受伤时：获得椰子（每场战斗 1 次）', '受伤时：获得椰子（每场战斗 1 次）', '受伤时：获得椰子（每场战斗 1 次）'],
    hooks: {
      hurt: function (g, c) {
        if (c.self._gorilla) return;
        c.self._gorilla = 1;
        g.givePerk(c.self, 'Coconut', 1);
      }
    }
  },

  Leopard: {
    name: 'Leopard', cn: '豹', tier: 6, atk: 10, hp: 4,
    texts: ['开战：对随机 1 个敌人造成自身攻击力 50% 的伤害',
            '开战：对随机 1 个敌人造成自身攻击力 50% 的伤害',
            '开战：对随机 1 个敌人造成自身攻击力 50% 的伤害'],
    hooks: {
      startOfBattle: function (g, c) {
        const t = g.random(g.foes(c.self).filter(function (p) { return p.hp > 0; }), 1);
        if (t[0]) g.hit(t[0], Math.floor(c.self.atk / 2));
      }
    }
  },

  Mammoth: {
    name: 'Mammoth', cn: '猛犸', tier: 6, atk: 4, hp: 12,
    texts: ['阵亡：给全体友方 +2/+2', '阵亡：给全体友方 +4/+4', '阵亡：给全体友方 +6/+6'],
    hooks: {
      faint: function (g, c) {
        const t = g.friends(c.self);
        for (const p of t) g.buff(p, c.lvl * 2, c.lvl * 2);
      }
    }
  },

  Snake: {
    name: 'Snake', cn: '蛇', tier: 6, atk: 6, hp: 6,
    texts: ['前方友方攻击时：对随机 1 个敌人造成 5 伤害',
            '前方友方攻击时：对随机 1 个敌人造成 5 伤害',
            '前方友方攻击时：对随机 1 个敌人造成 5 伤害'],
    hooks: {
      aheadAttack: function (g, c) {
        const t = g.random(g.foes(c.self).filter(function (p) { return p.hp > 0; }), 1);
        if (t[0]) g.hit(t[0], 5);
      }
    }
  },

  Tiger: {
    name: 'Tiger', cn: '老虎', tier: 6, atk: 6, hp: 4,
    texts: ['前方友方的技能在战斗中会重复触发一次（按 1 级）',
            '前方友方的技能在战斗中会重复触发一次（按 1 级）',
            '前方友方的技能在战斗中会重复触发一次（按 1 级）'],
    hooks: {}
  },

  Wolverine: {
    name: 'Wolverine', cn: '狼獾', tier: 6, atk: 5, hp: 4,
    texts: ['每有 4 个友方受伤：所有敌人 -2 生命', '每有 4 个友方受伤：所有敌人 -2 生命', '每有 4 个友方受伤：所有敌人 -2 生命'],
    hooks: {
      friendHurt: function (g, c) {
        c.self._wolv = (c.self._wolv || 0) + 1;
        if (c.self._wolv % 4 !== 0) return;
        const foes = g.foes(c.self).filter(function (p) { return p.hp > 0; });
        for (const p of foes) g.hit(p, 2);
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
 *  Food Perk 规则（官方 wiki 原文）：
 *  "A pet can only have 1 Food Perk at a time; if they gain another
 *   perk through any means, the old one will be overridden."
 *  → 一只宠物同时只能带 1 个 Perk，新的直接覆盖旧的
 * ---------------------------------------------------------- */
function setPerk(pet, id, uses) {
  if (!pet) return;
  pet.perks = [{ id: id, uses: uses == null ? 1 : uses }];
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
  Melon:       { name: 'Melon',       cn: '西瓜',     cost: 3, perk: 'Melon',   text: '受到伤害减少 20（生效 1 次）' },
  // ---- T4-T6 扩展新增 ----
  Chili:       { name: 'Chili',       cn: '辣椒',     cost: 3, perk: 'Chili',   text: '攻击时对第二个敌人造成 5 伤害' },
  Peanut:      { name: 'Peanut',      cn: '花生',     cost: 3, perk: 'Peanut',  text: '秒杀被它攻击并受伤的宠物' },
  Coconut:     { name: 'Coconut',     cn: '椰子',     cost: 3, perk: 'Coconut', text: '无视一次伤害' },
  // 牛奶由 Cow 的技能提供（免费，逐级更强）
  Milk:        { name: 'Milk',        cn: '牛奶',     cost: 0, buff: [1, 2], text: '给一只宠物 +1/+2', token: true },
  BetterMilk:  { name: 'Better Milk', cn: '优质牛奶', cost: 0, buff: [2, 4], text: '给一只宠物 +2/+4', token: true },
  BestMilk:    { name: 'Best Milk',   cn: '顶级牛奶', cost: 0, buff: [3, 6], text: '给一只宠物 +3/+6', token: true }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PETS: PETS, FOODS: FOODS, TOKEN_PETS: TOKEN_PETS, LVL_MUL: LVL_MUL };
}
