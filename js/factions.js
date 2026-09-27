'use strict';
/* ============================================================
 *  factions.js — 阵营 / 羁绊（自创机制，官方没有）
 *
 *  玩法：每只宠物属于一个阵营。队伍里有 N 只该阵营的宠物时，激活一档
 *        加成（阈值 2 和 3/4）。队伍只有 5 格，所以典型配置是
 *        3 + 2 两个阵营，或者 4 个同阵营吃满第二档。
 *
 *  ⚠️ 计数按【只数】。以前这里按 defId 去重，理由写的是「否则 3 只同名蚂蚁
 *     也能凑满」。但那个前提根本不成立 —— 同名宠是凑不出来的：
 *       · 商店买同名【必定合并】（game.js 的 buyPet，官方规则）
 *       · 幽灵组队也不抽同名（game.js 的 makeOpponent）
 *     所以去重是多余的，两种算法结果完全一样。改成按只数写更直白，
 *     也不会在将来某天悄悄把某只宠物的贡献丢掉。
 *
 *  一共有 8 个阵营，按体型/生态分（括号里是成员数）：
 *    虫豸(14) 水生(21) 飞禽(26) 巨兽(27) 小兽(25) 爬行(9) 史前(11) 灵长(5)
 *
 *  ⚠️ 数值按「凑齐难度」排：成员越少越难凑，效果就给得越强。
 *     最强的反而是成员最少的灵长(5) 和虫豸(14)，最弱的给最容易凑的巨兽(27)。
 *
 *  加成刻意做成 8 种不同性格，避免同质化：
 *    虫豸=血量 · 水生=前排 · 飞禽=回合成长 · 巨兽=攻击 · 小兽=减伤
 *    爬行=溅射 · 史前=玻璃大炮(攻防互换) · 灵长=按等级缩放
 * ============================================================ */

const FACTIONS = {
  bug: {
    cn: '虫豸', icon: '🐜', tiers: [2, 4],
    desc: ['开战：全体友方 +4 生命', '开战：全体友方 +9 生命']
  },  aqua: {
    cn: '水生', icon: '🐟', tiers: [2, 4],
    desc: ['开战：全体友方 +2/+2', '开战：全体友方 +4/+4']
  },
  bird: {
    /* ⚠️ 门槛原来写的是 [2, 3]，而其它阵营都是 [2, 4] —— 于是 3 只时飞禽已经吃到
     *    2 档、别人还在 1 档，实测 81% 碾压。灵长用 [2,3] 是因为它总共只有 5 个
     *    成员（3/5 才凑得动），飞禽有 26 个成员，没有任何理由放宽。 */
    cn: '飞禽', icon: '🐦', tiers: [2, 4],
    desc: ['每回合开始：随机 3 个友方 +1/+1', '每回合开始：随机 2 个友方 +3/+3']
  },
  beast: {
    cn: '巨兽', icon: '🐘', tiers: [2, 4],
    desc: ['开战：全体友方 +4 攻击', '开战：全体友方 +8 攻击']
  },
  /* ⚠️ 小兽原来是「2 只就全队拿西瓜」—— 2 只的低门槛 + 全队减 20 太超模。
   *    现在 1 档只给【最前排】，全队要 4 只。 */
  critter: {
    cn: '小兽', icon: '🐾', tiers: [2, 4],
    desc: ['开战：最前排获得西瓜（减伤 20，一次），全体友方 +1/+1', '开战：前 3 只获得西瓜，全体友方 +1/+1']
  },
  /* ⚠️ 爬行同理：原来 2 只就全队辣椒，现在 1 档只给最前排。 */
  reptile: {
    cn: '爬行', icon: '🦎', tiers: [2, 4],
    desc: ['开战：最前排获得辣椒（溅射 5），全体友方 +1/+1', '开战：全体获得辣椒（溅射 5），全体友方 +1/+1']
  },
  /* 史前：把血换成攻的「玻璃大炮」。不需要新引擎原语，也不看脸。 */
  prehist: {
    cn: '史前', icon: '🦴', tiers: [2, 4],
    desc: ['开战：全体友方 +5 攻击、-1 生命', '开战：全体友方 +12 攻击、-2 生命']
  },
  /* 灵长：唯一按【等级】缩放的阵营 —— 和本作「同名合成升级」的核心玩法呼应，
   * 越早成型越强。成员只有 5 只，所以 2 档的门槛也最低（3）。
   * ⚠️ 2 档原来写的是「等级×2」（3 级 = +6/+6），实测 91% —— 爆表。
   *    现在只 +1 级（3 级 = +4/+4），回到中位。 */
  primate: {
    cn: '灵长', icon: '🐒', tiers: [2, 3],
    desc: ['开战：最前 3 只 +等级/+等级', '开战：全体友方 +（等级+1）/（等级+1）']
  }
};

/* 宠物 → 阵营。⚠️ 每一只可购买宠物都必须在这里，
 *    factions.js 的测试会核对覆盖率（漏一只就报错）。 */
const FACTION_MEMBERS = {
  bug: ['Ant', 'Cricket', 'Mosquito', 'Spider', 'Worm', 'Snail', 'Scorpion', 'Fly',
        'Cockroach', 'Firefly', 'Termite', 'Leech', 'Pillbug', 'PrayingMantis'],
  aqua: ['Fish', 'Crab', 'Dolphin', 'Blowfish', 'Whale', 'Seal', 'Shark',
         'Bass', 'Jellyfish', 'Seahorse', 'Eel', 'Tuna', 'Clownfish', 'SeaAnemone', 'Blobfish',
         'HammerheadShark', 'Orca', 'Piranha', 'Platypus', 'Penguin', 'Starfish'],
  bird: ['Duck', 'Pigeon', 'Flamingo', 'Peacock', 'Swan', 'Parrot', 'Rooster', 'Turkey',
         'Duckling', 'Hummingbird', 'Kiwi', 'AtlanticPuffin', 'Dove', 'Stork', 'Cardinal',
         'Cassowary', 'Crow', 'Hawk', 'Sparrow', 'Shoebill', 'Vulture', 'Woodpecker',
         'HarpyEagle', 'Ostrich', 'Roadrunner', 'RacketTail'],
  beast: ['Horse', 'Pig', 'Elephant', 'Giraffe', 'Ox', 'Bison', 'Deer', 'Hippo', 'Rhino', 'Boar',
          'Leopard', 'Tiger', 'Wolverine', 'Lion', 'PolarBear', 'Zebra',
          'Elk', 'Yak', 'Camel', 'Kangaroo', 'Panda', 'Anteater', 'Cow', 'Donkey', 'Alpaca',
          'Reindeer', 'Ibex'],
  critter: ['Beaver', 'Otter', 'Sloth', 'Hedgehog', 'Rat', 'Badger', 'Dog', 'Rabbit', 'Sheep',
            'Skunk', 'Squirrel', 'Armadillo', 'Cat', 'Chihuahua',
            'Mouse', 'GuineaPig', 'Capybara', 'Okapi', 'Pug', 'Fossa', 'Fox',
            'Hamster', 'SiberianHusky', 'Koala', 'FairyArmadillo'],
  // 龙、乌龟、鳄鱼都算爬行 —— 它们在分类上本来就是爬行动物。
  // 乌龟/鳄鱼放这里是为了让龟包里的爬行阵营从 T4 起就能凑到（否则龟包里
  // 爬行只有 T6 的蛇和龙，等于永远激活不了）。
  reptile: ['Snake', 'Iguana', 'Salamander', 'Toad', 'Frog', 'Komodo', 'Dragon',
            'Turtle', 'Crocodile'],
  /* 🦴 史前：已灭绝/化石动物。从巨兽/爬行/飞禽/水生里各挖了一点过来。
   *    龟包里只有 Mammoth(T6) + Dodo(T3) 两只 —— 刚好凑到 1 档；星包里就很多了。 */
  prehist: ['Mammoth', 'SabertoothTiger', 'Triceratops', 'Stegosaurus', 'Spinosaurus',
            'Velociraptor', 'RealVelociraptor', 'Therizinosaurus', 'Dodo', 'TerrorBird',
            'Ammonite'],
  /* 🐒 灵长：成员最少（5 只），所以门槛也最低、效果给得最强。
   *    龟包：Monkey(T5) + Gorilla(T6)；星包：Gibbon/Marmoset(T1) + Orangutan(T3) + Monkey(T5)。 */
  primate: ['Monkey', 'Gorilla', 'Gibbon', 'Marmoset', 'Orangutan']
};

/* 反查表（宠物 → 阵营 id） */
const PET_FACTION = (function () {
  const m = {};
  for (const f of Object.keys(FACTION_MEMBERS)) {
    for (const p of FACTION_MEMBERS[f]) m[p] = f;
  }
  return m;
})();

function factionOf(defId) { return PET_FACTION[defId] || null; }
function factionInfo(id) { return FACTIONS[id] || null; }

/* 算出一支队伍里每个阵营的人数和当前档位
 * 返回 [{ id, n, lvl, tiers, next }]，next = 还差几只到下一档（已满则为 0）
 *
 * ⚠️ 按【只数】计，不是按 defId 去重。
 *    以前这里是 `seen[f][p.defId] = 1`（注释还明写「不是按只数」），
 *    等于把「同名最多一只」当成了前提。现在那个前提由两处保证：
 *      · buyPet —— 买同名必定合并（官方规则）
 *      · makeOpponent —— 幽灵组队也抽不重复的
 *    所以两种写法现在结果完全一样；但按只数写，才不会在将来某天
 *    悄悄把某只宠物的贡献丢掉（而且它本来就该是按只数算的）。 */
function teamFactions(team) {
  const count = {};
  for (const p of (team || [])) {
    const f = factionOf(p && p.defId);
    if (!f) continue;
    count[f] = (count[f] || 0) + 1;
  }
  const out = [];
  for (const id of Object.keys(FACTIONS)) {
    const n = count[id] || 0;
    const tiers = FACTIONS[id].tiers;
    let lvl = 0;
    for (let i = 0; i < tiers.length; i++) if (n >= tiers[i]) lvl = i + 1;
    const next = (lvl >= tiers.length) ? 0 : (tiers[lvl] - n);
    out.push({ id: id, n: n, lvl: lvl, tiers: tiers, next: next });
  }
  // 已激活的排前面，其次按人数
  out.sort(function (a, b) { return (b.lvl - a.lvl) || (b.n - a.n); });
  return out;
}

/* 只保留「有 1 只以上」的阵营，给界面用 */
function activeFactions(team) {
  return teamFactions(team).filter(function (f) { return f.n > 0; });
}

/* 某一档的文字说明 */
function factionDesc(f) {
  const info = FACTIONS[f.id];
  if (!info || f.lvl < 1) return '';
  return info.desc[f.lvl - 1];
}

/* ---- 战斗开始：作用于「队伍副本」，不影响商店里的队伍 ---- */
function applySynergyBattleStart(game, myTeam) {
  if (!myTeam || !myTeam.length) return;
  const fs = teamFactions(myTeam);
  const lvl = function (id) {
    const hit = fs.filter(function (f) { return f.id === id; })[0];
    return hit ? hit.lvl : 0;
  };

  /* ⚠️ 下面这些数值不是拍脑袋来的，是用 faction_power.js 的「汇率表」反推的：
   *    基准 = 全体 +4/+4（循环赛里的中位强度），把每个效果拿去和它对撞，
   *    胜率落在 40-60% 才算等价。
   *    为什么要这么麻烦：战斗模型是滚雪球的 —— 均匀加成每差 1 点，
   *    循环赛胜率就摆动约 25pp。所以「看着差不多」的数值实际能差出 70% 胜率。 */

  // 🐜 虫豸：全体加生命。纯生命比同点数的攻+血弱，所以要给得更多（+9 ≈ +4/+4）
  const bug = lvl('bug');
  if (bug >= 1) for (const p of myTeam) p.hp += (bug >= 2 ? 9 : 4);

  // 🐟 水生：2 档强化全体，1 档强化得少一些（1 档「只给最前排 +4/+4」实测只有 30%）
  const aqua = lvl('aqua');
  if (aqua >= 2) { for (const p of myTeam) { p.atk += 4; p.hp += 4; } }
  else if (aqua === 1) { for (const p of myTeam) { p.atk += 2; p.hp += 2; } }

  // 🐘 巨兽：全体加攻击。纯攻击同样偏弱，+8 ≈ +4/+4
  const beast = lvl('beast');
  if (beast >= 1) for (const p of myTeam) p.atk += (beast >= 2 ? 8 : 4);

  // 🐾 小兽：防御类 Perk（已有 Perk 的不覆盖，和遗物「铁甲」同一原则）
  //    2 档【不能】给满 5 只 —— 实测「全体西瓜」等价于 +5/+5 左右，远超中位；
  //    改成前 3 只西瓜 + 全体 +1/+1 之后才落回带内。
  const critter = lvl('critter');
  if (critter >= 2) {
    for (let i = 0; i < myTeam.length; i++) {
      const p = myTeam[i];
      if (i < 3 && !p.perks.length) p.perks = [{ id: 'Melon', uses: 1 }];
      p.atk += 1; p.hp += 1;
    }
  } else if (critter === 1) {
    for (let i = 0; i < myTeam.length; i++) {
      const p = myTeam[i];
      if (i === 0 && !p.perks.length) p.perks = [{ id: 'Melon', uses: 1 }];
      p.atk += 1; p.hp += 1;
    }
  }

  // 🦎 爬行：辣椒（溅射 5）本身太弱 —— 实测「全体辣椒」只有 +4/+4 的三分之一，
  //    所以 2 档必须搭一点属性，只给辣椒怎么调都进不了带内。
  const reptile = lvl('reptile');
  if (reptile >= 2) {
    for (const p of myTeam) {
      if (!p.perks.length) p.perks = [{ id: 'Chili', uses: 1 }];
      p.atk += 1; p.hp += 1;
    }
  } else if (reptile === 1) {
    for (let i = 0; i < myTeam.length; i++) {
      const p = myTeam[i];
      if (i === 0 && !p.perks.length) p.perks = [{ id: 'Chili', uses: 1 }];
      p.atk += 1; p.hp += 1;
    }
  }

  // 🦴 史前：玻璃大炮 —— 全体加攻、减血（不会减死，最低留 1）
  //    ⚠️ 减血特别值钱：减 1 点血 ≈ 少 1 点属性，胜负就差一档。
  //       「+8 攻 −3 血」实测只有中位强度的三成，改成 +10 −2 才等价。
  const prehist = lvl('prehist');
  if (prehist >= 1) {
    const addAtk = prehist >= 2 ? 12 : 5;
    const loseHp = prehist >= 2 ? 2 : 1;
    for (const p of myTeam) { p.atk += addAtk; p.hp = Math.max(1, p.hp - loseHp); }
  }

  // 🐒 灵长：唯一按【等级】缩放的阵营 —— 越早合成升级越强
  //    ⚠️ 原来 2 档是「等级×2」（3 级 = +6/+6），实测 91% —— 直接爆表。
  //       改成「等级+1」（3 级 = +4/+4）正好落在中位。
  const primate = lvl('primate');
  if (primate >= 1) {
    if (primate >= 2) {
      for (const p of myTeam) {
        const n = (p.lvl || 1) + 1;
        p.atk += n; p.hp += n;
      }
    } else {
      // 1 档只给最前面的 3 只。
      // 实测：全体给 77%（太强）、只给最前 2 只 35%（太弱）—— 3 只才落在中位。
      for (let i = 0; i < 3 && i < myTeam.length; i++) {
        const p = myTeam[i];
        const n = (p.lvl || 1);
        p.atk += n; p.hp += n;
      }
    }
  }
}

/* ---- 回合开始：飞禽是唯一在商店阶段生效的阵营 ---- */
function applySynergyTurnStart(game) {
  if (!game || !game.team || !game.team.length) return [];
  const fs = teamFactions(game.team);
  const bird = (fs.filter(function (f) { return f.id === 'bird'; })[0] || { lvl: 0 }).lvl;
  if (bird < 1) return [];

  /* ⚠️ 2 档【不能】做成「全体 +2/+2」。
   *    飞禽是唯一在商店阶段生效的阵营，加成是【永久】累积的 ——
   *    3 个回合下来就是全体 +6/+6，实测 92%（几乎必胜），而且回合越多越离谱。
   *    改成「随机 2 个 +3/+3」之后落在 47%，正好在中位附近。
   *    1 档维持「随机 2 个 +2/+2」，这样两档是同一个形状、只差强度。 */
  const gain = bird >= 2 ? 3 : 1;
  const cnt  = bird >= 2 ? 2 : 3;
  const picked = [];
  const pool = game.team.slice();
  for (let i = 0; i < cnt && pool.length; i++) {
    const t = pool.splice(RNG.int(pool.length), 1)[0];
    t.atk += gain; t.hp += gain;
    picked.push(petName(t.def));
  }
  return ['🐦 飞禽：' + picked.join('、') + ' +' + gain + '/+' + gain];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FACTIONS: FACTIONS, FACTION_MEMBERS: FACTION_MEMBERS, PET_FACTION: PET_FACTION,
    factionOf: factionOf, factionInfo: factionInfo, teamFactions: teamFactions,
    activeFactions: activeFactions, factionDesc: factionDesc,
    applySynergyBattleStart: applySynergyBattleStart,
    applySynergyTurnStart: applySynergyTurnStart
  };
}
