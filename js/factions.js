'use strict';
/* ============================================================
 *  factions.js — 阵营 / 羁绊（自创机制，官方没有）
 *
 *  ⚠️ 【每个包一套阵营】（2026-09-28 重构；此前是两包共用一套）
 *
 *  旧做法的问题：阵营成员和门槛都按【两包并集】定，注释还写着「成员越少越难凑，
 *  效果就给得越强」。但一局只玩一个包，并集的数字在单包里没有意义。实测：
 *    · 龟包史前只有 2 只成员（渡渡鸟 T3 + 猛犸 T6），2 档门槛却是 4 → 永远凑不齐
 *    · 龟包灵长只有 2 只（猴子 T5 + 大猩猩 T6），门槛 3 → 同样凑不齐
 *    · 星包虫豸 6 只里 4 只是 T1，门槛 4 → 第 1 回合就能满 2 档（+9 全体生命）
 *
 *  现在：阵营的「身份」（名字/图标）两包共用；【成员、门槛、档位说明】每包各一套。
 *
 *  门槛怎么定：先看「凑满第 2 档所需的【最低星级】」，再折算成回合。
 *    商店解锁：T1→回合1 · T2→3 · T3→5 · T4→7 · T5→9 · T6→11
 *  ⚠️ 一局最多 12 回合（CFG.WIN_TARGET 10 / LOSE_MAX 3），而 T6 要到第 11 回合
 *     才解锁 —— 所以【要 T6 才能凑齐的门槛等于不存在】。任何阵营的第 2 档都必须
 *     能在 T5（第 9 回合）之前达成，否则它在实战里就是个死羁绊。
 *
 *  计数按【只数】（同名宠买不到第二只：buyPet 必合并、幽灵也不抽同名）。
 *
 *  加成刻意做成不同性格，避免同质化：
 *    虫豸=局部(只强同阵营) · 水生=全体攻血 · 飞禽=回合成长
 *    巨兽=强化最壮的 2 只 · 小兽=减伤 · 爬行=溅射
 *    史前=玻璃大炮(攻防互换) · 灵长=按等级缩放
 *
 *  ⚠️ 【效果数值按包分开】（2026-09-29）：见下方 SYNERGY_FX。
 *     两包的对手集合不同（龟包 6 阵营 / 星包 8 阵营），同一数值的循环赛胜率
 *     能差 7-20pp，所以每个包各有一套数字，用 faction_power.js 逐包校准。
 * ============================================================ */

/* 阵营身份：两包共用。只有名字和图标 —— 门槛/成员/说明都是按包定义的 */
const FACTION_META = {
  bug:     { cn: '虫豸', icon: '🐜' },
  aqua:    { cn: '水生', icon: '🐟' },
  bird:    { cn: '飞禽', icon: '🐦' },
  beast:   { cn: '巨兽', icon: '🐘' },
  critter: { cn: '小兽', icon: '🐾' },
  reptile: { cn: '爬行', icon: '🦎' },
  prehist: { cn: '史前', icon: '🦴' },
  primate: { cn: '灵长', icon: '🐒' }
};

/* 每包一套阵营。字段：
 *   tiers   — 门槛（升序）。允许只有 1 项：凑够就直接满档，没有中间态。
 *   desc    — 档位说明，【长度必须等于 tiers 长度】（UI 按下标取）
 *   members — 成员 defId
 *
 * ⚠️ 成员表按包分开写，不是"从并集里筛"—— 两包可以有不同的阵营集合
 *    （龟包没有史前/灵长：各只有 2 只成员，凑不齐）。 */
const FACTIONS_BY_PACK = {
  /* ---------------- 🐢 龟包（61 只 → 6 个阵营） ---------------- */
  turtle: {
    bug: {
      tiers: [2, 4],
      desc: ['开战：每只虫豸 +1/+1', '开战：每只虫豸 +4/+4，全体友方 +1 生命'],
      members: ['Ant', 'Cricket', 'Mosquito', 'Spider', 'Worm', 'Snail', 'Scorpion', 'Fly']
    },
    aqua: {
      tiers: [2, 4],
      desc: ['开战：全体友方 +2/+2', '开战：全体友方 +4/+4'],
      members: ['Fish', 'Crab', 'Dolphin', 'Blowfish', 'Whale', 'Seal', 'Shark', 'Penguin']
    },
    bird: {
      tiers: [2, 4],
      desc: ['每回合开始：随机 3 个友方 +1/+1', '每回合开始：随机 2 个友方 +3/+3'],
      members: ['Duck', 'Pigeon', 'Flamingo', 'Peacock', 'Swan', 'Parrot', 'Rooster', 'Turkey', 'Dodo']
    },
    beast: {
      tiers: [2, 4],
      desc: ['开战：血量最高的 2 只友方 +4/+4', '开战：血量最高的 2 只友方 +8/+8'],
      members: ['Horse', 'Pig', 'Kangaroo', 'Camel', 'Elephant', 'Giraffe', 'Ox', 'Bison', 'Deer',
                'Hippo', 'Cow', 'Rhino', 'Boar', 'Leopard', 'Tiger', 'Wolverine', 'Mammoth', 'Gorilla']
    },
    critter: {
      tiers: [2, 4],
      desc: ['开战：最前排获得西瓜（减伤 20，一次），全体友方 +1/+1',
             '开战：前 3 只获得西瓜，全体友方 +1/+1'],
      members: ['Beaver', 'Otter', 'Sloth', 'Hedgehog', 'Rat', 'Badger', 'Dog', 'Rabbit', 'Sheep',
                'Skunk', 'Squirrel', 'Armadillo', 'Monkey', 'Cat']
    },
    /* ⚠️ 龟包爬行只有 4 只（乌龟 T4 / 鳄鱼 T5 / 蛇 T6 / 龙 T6），第 4 只最低是 T6。
     *    门槛 4 等于永远凑不齐；就算降到 [2,3]，第 3 只还是 T6 = 第 11 回合，
     *    那时游戏基本结束了。所以这里改成【单档】：凑 2 只就吃满。
     *    2 只最早是 T4+T5 = 第 9 回合 —— 这是这 4 只宠物能给出的最早时点。 */
    reptile: {
      tiers: [2],
      desc: ['开战：全体获得辣椒（溅射 5），全体友方 +1/+1，最前排 2 只再 +1/+1'],
      members: ['Turtle', 'Crocodile', 'Snake', 'Dragon']
    }
  },

  /* ---------------- ⭐ 星包（77 只 → 8 个阵营） ---------------- */
  star: {
    /* ⚠️ 星包虫豸 6 只里有 4 只是 T1 —— 门槛 4 的话第 1 回合就能满 2 档，
     *    滚雪球太强。提到 5：第 5 低是水蛭 T3 = 第 5 回合。 */
    bug: {
      tiers: [2, 5],
      desc: ['开战：每只虫豸 +1/+1', '开战：每只虫豸 +4/+4'],
      members: ['Pillbug', 'Cockroach', 'Firefly', 'Termite', 'Leech', 'PrayingMantis']
    },
    aqua: {
      tiers: [2, 4],
      desc: ['开战：全体友方 +2/+2', '开战：全体友方 +4/+4'],
      /* ⚠️ 鸭嘴兽（Platypus）划给史前了 —— 见下面 prehist 的说明 */
      members: ['Bass', 'Seahorse', 'Jellyfish', 'Eel', 'Tuna', 'Clownfish', 'SeaAnemone',
                'Blobfish', 'Starfish', 'HammerheadShark', 'Orca', 'Piranha']
    },
    bird: {
      tiers: [2, 4],
      desc: ['每回合开始：随机 3 个友方 +1/+1', '每回合开始：随机 1 个友方 +6/+6'],
      /* ⚠️ 几维鸟（Kiwi）划给史前了 —— 见下面 prehist 的说明 */
      members: ['Duckling', 'Hummingbird', 'AtlanticPuffin', 'Dove', 'Stork', 'Roadrunner', 'Cardinal',
                'Cassowary', 'Crow', 'Hawk', 'Sparrow', 'RacketTail', 'Shoebill', 'Vulture',
                'Woodpecker', 'HarpyEagle', 'Ostrich']
    },
    beast: {
      tiers: [2, 4],
      desc: ['开战：血量最高的 2 只友方 +5/+5', '开战：血量最高的 2 只友方 +9/+9'],
      members: ['Yak', 'Panda', 'Anteater', 'Elk', 'Donkey', 'Ibex', 'Lion', 'PolarBear', 'Zebra',
                'Alpaca', 'Reindeer']
    },
    critter: {
      tiers: [2, 4],
      desc: ['开战：最前排获得西瓜（减伤 20，一次），全体友方 +1/+1',
             '开战：前 3 只获得西瓜，全体友方 +1 攻击'],
      members: ['Chihuahua', 'Mouse', 'GuineaPig', 'Koala', 'Capybara', 'Okapi', 'Pug', 'Fossa',
                'FairyArmadillo', 'Fox', 'Hamster', 'SiberianHusky']
    },
    reptile: {
      tiers: [2, 4],
      desc: ['开战：最前排获得辣椒（溅射 5），全体友方 +1/+1',
             '开战：全体获得辣椒（溅射 5），全体友方 +1/+1'],
      members: ['Frog', 'Iguana', 'Salamander', 'Toad', 'Komodo']
    },
    /* 🦴 史前：已灭绝 / 化石物种。
     *    ⚠️ 星包原版 9 只里 8 只是 T6（只有三角龙是 T5），任何门槛都要等到
     *       第 11 回合 —— 而一局最多 12 回合，等于这个阵营根本用不上。
     *       所以把两只公认的「活化石」划进来，给前期一个入口：
     *         · 几维鸟（Kiwi）   —— 古老鸟类的孑遗，新西兰的活化石
     *         · 鸭嘴兽（Platypus）—— 单孔目，哺乳动物里最原始的类群
     *       这样成员是 T1/T4/T5/T6×8，门槛 [2,3] 时第 3 低 = T5 = 第 9 回合。 */
    prehist: {
      tiers: [2, 3],
      desc: ['开战：全体友方 +7 攻击、-1 生命', '开战：全体友方 +15 攻击、-1 生命'],
      members: ['Kiwi', 'Platypus', 'Triceratops', 'SabertoothTiger', 'Stegosaurus', 'Spinosaurus',
                'Velociraptor', 'RealVelociraptor', 'Therizinosaurus', 'TerrorBird', 'Ammonite']
    },
    /* 🐒 灵长：唯一按【等级】缩放的阵营 —— 和本作「同名合成升级」的核心玩法呼应，
     *    越早成型越强。星包只有 3 只（长臂猿 T1 / 狨猴 T1 / 猩猩 T3），
     *    所以 2 档门槛也最低（3）：T1 凑 1 档、T3 就能满 2 档。
     *    「早成型但效果随等级成长」是自洽的 —— 前期等级低，吃到了也不强。 */
    primate: {
      tiers: [2, 3],
      desc: ['开战：最前 3 只 +等级/+等级', '开战：全体友方 +（等级+1）/（等级+1）'],
      members: ['Gibbon', 'Marmoset', 'Orangutan']
    }
  }
};

/* ---- 每包一套【效果数值】 ----
 *
 * ⚠️ 2026-09-29：数值从「两包共用」改成「按包分开」。
 *    实测原因：两包的【对手集合】不同（龟包 6 个阵营 / 星包 8 个），
 *    同一个数值在两包的循环赛胜率差很多 —— 虫豸同效果，龟包 44.6%、星包 59.6%；
 *    飞禽 44.0% / 39.9%。硬凑共用数值只会两头不讨好。
 *    效果【逻辑】仍然共用（都在 applySynergyBattleStart 里），只有数字按包取。
 *
 * 字段含义（数组 = [1 档值, 2 档值]；单档阵营只给 1 项）：
 *   bug     n=每只虫豸 +n/+n        m=另外全体 +m 生命
 *   aqua    a=全体 +a/+a
 *   bird    cnt=随机 cnt 只          g=每只 +g/+g（每回合累积）
 *   beast   a=血量最高的 2 只 +a/+a
 *   critter k=前 k 只获得西瓜（另全体 +1/+1）
 *   reptile all=1 全体辣椒 / 0 最前排辣椒   a=全体 +a/+a   f=最前排额外 +f/+f
 *   prehist atk=全体 +atk 攻击       hp=全体 -hp 生命
 *   primate k=1 档只给最前 k 只（2 档给全体），都按等级缩放
 */
const SYNERGY_FX = {
  turtle: {
    bug:     { n: [1, 4], m: [0, 1] },
    aqua:    { a: [2, 4] },
    bird:    { cnt: [3, 2], g: [1, 3] },
    beast:   { a: [4, 8] },
    critter: { k: [1, 3], a: [1, 1], h: [1, 1] },
    reptile: { all: [1], a: [1], f: [1], fk: [2] }
  },
  star: {
    /* ⚠️ 星包虫豸是 5 只成团（龟包 4 只），局部型吃加成的人更多 → 天然更强，
     *    实测 60.9%。去掉 m 的全体 +1 生命后落回 ~51%（局部型在纯阵营队里
     *    等于全体型，所以「每只 +n」的杠杆比「全体 +m」大得多）。 */
    bug:     { n: [1, 4], m: [0, 0] },
    aqua:    { a: [2, 4] },
    bird:    { cnt: [3, 1], g: [1, 6] },
    beast:   { a: [5, 9] },
    /* ⚠️ 星包小兽 4 只成团时前 3 只西瓜 = 53.7%，超易档上界；前 2 只 = 33.7%，
     *    又是 20pp 的粗格点。所以保持前 3 只西瓜，把「全体 +1/+1」的【攻击】
     *    去掉（只 +1 生命）—— 小兽本来就是防御定位，加血比加攻更贴题。 */
    critter: { k: [1, 3], a: [1, 1], h: [1, 0] },
    reptile: { all: [0, 1], a: [1, 1], f: [0, 0], fk: [3, 2] },
    prehist: { atk: [7, 15], hp: [1, 1] },
    primate: { k: [3] }
  }
};

/* 当前包的效果数值表 */
function activeFx() {
  const p = (typeof activePack === 'function') ? activePack() : 'turtle';
  return SYNERGY_FX[p] || SYNERGY_FX.turtle;
}

/* 反查表（宠物 → 阵营 id）。
 *
 * ⚠️ 这张表【故意是全局唯一的】，不带包维度 —— 因为两包的宠物池完全不重叠
 *    （龟包 61 + 星包 77，共有 0 只），所以一只宠物只会出现在一个包的成员表里，
 *    不存在歧义。将来若某个包与老包共享宠物（官方就是这样的），只要约定
 *    「同一只宠物在所有包里属于同一阵营」，这张表依然成立；
 *    真要「同一只宠物在不同包算不同阵营」，再给 factionOf 加 pack 参数即可。 */
const PET_FACTION = (function () {
  const m = {};
  for (const pack of Object.keys(FACTIONS_BY_PACK)) {
    const table = FACTIONS_BY_PACK[pack];
    for (const f of Object.keys(table)) {
      for (const p of table[f].members) m[p] = f;
    }
  }
  return m;
})();

/* 当前生效的阵营表（默认跟着 activePack()） */
function factionPack(pack) {
  const p = pack || (typeof activePack === 'function' ? activePack() : 'turtle');
  return FACTIONS_BY_PACK[p] || FACTIONS_BY_PACK.turtle;
}

/* 当前包里所有阵营的 id（顺序稳定，UI 图鉴按它遍历） */
function factionIds(pack) { return Object.keys(factionPack(pack)); }

function factionOf(defId) { return PET_FACTION[defId] || null; }

/* 取阵营信息。返回的是【合并后的视图对象】—— 名字/图标来自全局身份表，
 * 门槛/说明/成员来自当前包。查不到（比如这个包没有该阵营）返回 null。 */
function factionInfo(id, pack) {
  const e = factionPack(pack)[id];
  const meta = FACTION_META[id];
  if (!e || !meta) return null;
  return { id: id, cn: meta.cn, icon: meta.icon, tiers: e.tiers, desc: e.desc, members: e.members };
}

/* 算出一支队伍里每个阵营的人数和当前档位
 * 返回 [{ id, n, lvl, tiers, next }]，next = 还差几只到下一档（已满则为 0）
 *
 * ⚠️ 只统计【当前包里存在的】阵营 —— 换个包之后，队伍里可能有该包没有的阵营
 *    （比如从星包切到龟包，队里还留着星包宠物），那些直接忽略。 */
function teamFactions(team, pack) {
  const table = factionPack(pack);
  const count = {};
  for (const p of (team || [])) {
    const f = factionOf(p && p.defId);
    if (!f || !table[f]) continue;
    count[f] = (count[f] || 0) + 1;
  }
  const out = [];
  for (const id of Object.keys(table)) {
    const n = count[id] || 0;
    const tiers = table[id].tiers;
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
function activeFactions(team, pack) {
  return teamFactions(team, pack).filter(function (f) { return f.n > 0; });
}

/* 某一档的文字说明 */
function factionDesc(f, pack) {
  const info = factionInfo(f.id, pack);
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
  /* 按【当前包】取效果数值（两包数值不同，见 SYNERGY_FX 的说明） */
  const V = activeFx();

  /* ⚠️ 下面这些数值不是拍脑袋来的，是用 faction_power.js 的「汇率表」反推的：
   *    基准 = 全体 +4/+4（循环赛里的中位强度），把每个效果拿去和它对撞，
   *    胜率落在【该阵营所属难度档的目标区间】才算等价。
   *    为什么要这么麻烦：战斗模型是滚雪球的 —— 均匀加成每差 1 点，
   *    循环赛胜率就摆动约 25pp。所以「看着差不多」的数值实际能差出 70% 胜率。
   *
   * ⚠️ 2026-09-29 起：数值【按包分开】（见上方 SYNERGY_FX 的说明），验收标准是
   *    「按凑齐难度分三档补偿」（易 42-51 / 中 46-55 / 难 50-59）——
   *    好凑的给弱效果、难凑的给强效果，补偿它成型晚的劣势。
   *    所以每个阵营按【自己包的难度档】分别校准，不再是一刀切 40-60%。
   *    某个包没有的阵营（龟包没有史前/灵长），lvl() 会返回 0，自动跳过。 */

  // 🐜 虫豸：【局部】只加强同阵营的成员自己，不加强别的阵营。
  //    依据 dota 自走棋「2 巨魔 → 只给巨魔棋子加攻速」的局部设计（官方 wiki 明示）。
  //    ⚠️ 和「全体型」的强度曲线形状不同：全体型只在门槛处阶梯跳变，
  //       局部型是【随队伍里的虫豸数量单调上升】—— 2 只只有 2 只吃到、5 只全吃到。
  //       这正是「局部」的定义：鼓励纯阵营队。混编时偏弱是设计意图，不是 bug。
  //    ⚠️ 数值用「每只虫豸 +n/+n」+「全体 +m 生命」两级微调：
  //       纯局部加成的阶梯太粗（4 只时 +4/+4 → 35.8%、+5/+5 → 61.9%，
  //       每 1 点属性摆动约 3.3pp，44-49% 中间没有整数落点），
  //       所以主加成取整数、再用一点全体生命把胜率拉进目标区间。
  const bug = lvl('bug');
  if (bug >= 1) {
    const n = V.bug.n[bug - 1], m = V.bug.m[bug - 1];
    for (const p of myTeam) {
      if (factionOf(p.defId) === 'bug') { p.atk += n; p.hp += n; }
      p.hp += m;
    }
  }

  // 🐟 水生：2 档强化全体，1 档强化得少一些（1 档「只给最前排 +4/+4」实测只有 30%）
  const aqua = lvl('aqua');
  if (aqua >= 1) {
    const a = V.aqua.a[aqua - 1];
    for (const p of myTeam) { p.atk += a; p.hp += a; }
  }

  // 🐘 巨兽：【强化最壮的 2 只】血量最高的 2 只友方 +X/+X。
  //    ⚠️ 这里踩过一个坑，必须记下来：最早设计成「血量【最低】的 2 只 +X 攻击」
  //       （参考三国自走棋「猛兽：血量越低攻击越高」），实测【完全无效】——
  //       给血量最低的加攻击，从 +8 一路加到 +40，胜率只有 2.1% → 3.0%。
  //       原因：血量最低的那只【开战就注定先死】，根本没机会出手，加成全浪费。
  //       同样是「给 2 只 +8/+8」，换成血量【最高】的 2 只：38.1% → 55.3%。
  //       → 硬规律：这个战斗模型里，强化「能活的」远优于强化「快死的」。
  //       三国自走棋的猛兽能成立，是因为那是【战斗内动态触发】（受伤时加攻，
  //       那时它还没死）；本作只有开战前 / 回合开始两个静态钩子，做不出那效果。
  //    ⚠️ 这是【条件型】：加成只落在最壮的 2 只身上，和「全体加攻」完全不同。
  const beast = lvl('beast');
  if (beast >= 1) {
    const n = V.beast.a[beast - 1];
    const byHp = myTeam.slice().sort(function (a, b) { return b.hp - a.hp; });
    for (let i = 0; i < 2 && i < byHp.length; i++) { byHp[i].atk += n; byHp[i].hp += n; }
  }

  // 🐾 小兽：防御类 Perk（已有 Perk 的不覆盖，和遗物「铁甲」同一原则）
  //    2 档【不能】给满 5 只 —— 实测「全体西瓜」等价于 +5/+5 左右，远超中位；
  //    改成前 3 只西瓜 + 全体 +1/+1 之后才落回带内。
  const critter = lvl('critter');
  if (critter >= 1) {
    const k = V.critter.k[critter - 1];
    /* ⚠️ 西瓜（减伤 20）是 20pp 级的粗格点：前 3 只 53.7% / 前 2 只 33.7%，
     *    中间没有落点。所以把「全体 +a/+h」也提成可调项 —— 只给血不给攻
     *    （小兽是防御定位），就能把胜率从 53.7 拉进 42-51 带内。 */
    const ca = V.critter.a ? V.critter.a[critter - 1] : 1;
    const ch = V.critter.h ? V.critter.h[critter - 1] : 1;
    for (let i = 0; i < myTeam.length; i++) {
      const p = myTeam[i];
      if (i < k && !p.perks.length) p.perks = [{ id: 'Melon', uses: 1 }];
      p.atk += ca; p.hp += ch;
    }
  }

  // 🦎 爬行：辣椒（溅射 5）本身太弱 —— 实测「全体辣椒」只有 +4/+4 的三分之一，
  //    所以 2 档必须搭一点属性，只给辣椒怎么调都进不了带内。
  //    ⚠️ 龟包爬行是【单档】（tiers 只有 [2]），凑 2 只就是满档 —— 必须按满档给，
  //       不能套用「1 档只给最前排」的弱化版。所以这里用「lvl >= tiers.length」
  //       判断满档，而不是写死 lvl >= 2。将来哪个包再出现单档阵营也自动正确。
  const reptileHit = fs.filter(function (f) { return f.id === 'reptile'; })[0];
  const reptile = reptileHit ? reptileHit.lvl : 0;
  if (reptile >= 1) {
    const all = V.reptile.all[reptile - 1];   // 1=全体辣椒 / 0=最前排辣椒
    const a = V.reptile.a[reptile - 1];
    const f = V.reptile.f[reptile - 1];
    const fk = V.reptile.fk ? V.reptile.fk[reptile - 1] : 1;   // 前 fk 只额外 +f/+f
    for (let i = 0; i < myTeam.length; i++) {
      const p = myTeam[i];
      if ((all || i === 0) && !p.perks.length) p.perks = [{ id: 'Chili', uses: 1 }];
      const b = a + (i < fk ? f : 0);
      p.atk += b; p.hp += b;
    }
  }

  // 🦴 史前：玻璃大炮 —— 全体加攻、减血（不会减死，最低留 1）
  //    ⚠️ 减血特别值钱：减 1 点血 ≈ 少 1 点属性，胜负就差一档。
  //       「+8 攻 −3 血」实测只有中位强度的三成，改成 +10 −2 才等价。
  const prehist = lvl('prehist');
  if (prehist >= 1) {
    const addAtk = V.prehist.atk[prehist - 1];
    const loseHp = V.prehist.hp[prehist - 1];
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
      const k = V.primate.k[0];
      for (let i = 0; i < k && i < myTeam.length; i++) {
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
   *    所以做成「随机 cnt 只 +g/+g」这种形状，数值按包在 SYNERGY_FX.bird 里取。 */
  const V = activeFx();
  const gain = V.bird.g[bird - 1];
  const cnt  = V.bird.cnt[bird - 1];
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
    FACTION_META: FACTION_META, FACTIONS_BY_PACK: FACTIONS_BY_PACK,
    PET_FACTION: PET_FACTION,
    factionPack: factionPack, factionIds: factionIds,
    factionOf: factionOf, factionInfo: factionInfo, teamFactions: teamFactions,
    activeFactions: activeFactions, factionDesc: factionDesc,
    applySynergyBattleStart: applySynergyBattleStart,
    applySynergyTurnStart: applySynergyTurnStart
  };
}
