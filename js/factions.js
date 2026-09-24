'use strict';
/* ============================================================
 *  factions.js — 阵营 / 羁绊（自创机制，官方没有）
 *
 *  玩法：每只宠物属于一个阵营。队伍里有 N 个【不同】的该阵营宠物时，
 *        激活一档加成（阈值 2 和 3/4）。队伍只有 5 格，所以典型配置是
 *        3 + 2 两个阵营，或者 4 个同阵营吃满第二档。
 *
 *  为什么按「不同宠物」数：否则 3 只同名蚂蚁也能凑满，而 SAP 里同名是
 *  会合成升级的，按数量数会被滥用。按 defId 去重才是真实阵容强度。
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
    desc: ['开战：全体友方 +3 生命', '开战：全体友方 +7 生命']
  },  aqua: {
    cn: '水生', icon: '🐟', tiers: [2, 4],
    desc: ['开战：最前排 +3/+3', '开战：全体友方 +3/+3']
  },
  bird: {
    cn: '飞禽', icon: '🐦', tiers: [2, 3],
    desc: ['每回合开始：随机 2 个友方 +2/+2', '每回合开始：全体友方 +2/+2']
  },
  beast: {
    cn: '巨兽', icon: '🐘', tiers: [2, 4],
    desc: ['开战：全体友方 +2 攻击', '开战：全体友方 +5 攻击']
  },
  /* ⚠️ 小兽原来是「2 只就全队拿西瓜」—— 2 只的低门槛 + 全队减 20 太超模。
   *    现在 1 档只给【最前排】，全队要 4 只。 */
  critter: {
    cn: '小兽', icon: '🐾', tiers: [2, 4],
    desc: ['开战：最前排获得西瓜（减伤 20，一次）', '开战：全体友方获得西瓜（减伤 20，一次）']
  },
  /* ⚠️ 爬行同理：原来 2 只就全队辣椒，现在 1 档只给最前排。 */
  reptile: {
    cn: '爬行', icon: '🦎', tiers: [2, 4],
    desc: ['开战：最前排获得辣椒（溅射 5）', '开战：全体友方获得辣椒（溅射 5）']
  },
  /* 史前：把血换成攻的「玻璃大炮」。不需要新引擎原语，也不看脸。 */
  prehist: {
    cn: '史前', icon: '🦴', tiers: [2, 4],
    desc: ['开战：全体友方 +4 攻击、-2 生命', '开战：全体友方 +8 攻击、-3 生命']
  },
  /* 灵长：唯一按【等级】缩放的阵营 —— 和本作「同名合成升级」的核心玩法呼应，
   * 越早成型越强。成员只有 5 只，所以 2 档的门槛也最低（3）。 */
  primate: {
    cn: '灵长', icon: '🐒', tiers: [2, 3],
    desc: ['开战：全体友方 +等级/+等级', '开战：全体友方 +（等级×2）/（等级×2）']
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
 * 返回 [{ id, n, lvl, tiers, next }]，next = 还差几只到下一档（已满则为 0） */
function teamFactions(team) {
  const seen = {};
  for (const p of (team || [])) {
    const f = factionOf(p && p.defId);
    if (!f) continue;
    if (!seen[f]) seen[f] = {};
    seen[f][p.defId] = 1;              // 按 defId 去重，不是按只数
  }
  const out = [];
  for (const id of Object.keys(FACTIONS)) {
    const n = seen[id] ? Object.keys(seen[id]).length : 0;
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

  // 🐜 虫豸：全体加生命（成员最少之一，所以数值给得高）
  const bug = lvl('bug');
  if (bug >= 1) for (const p of myTeam) p.hp += (bug >= 2 ? 7 : 3);

  // 🐟 水生：2 档强化全体，1 档只强化最前排
  const aqua = lvl('aqua');
  if (aqua >= 2) { for (const p of myTeam) { p.atk += 3; p.hp += 3; } }
  else if (aqua === 1 && myTeam[0]) { myTeam[0].atk += 3; myTeam[0].hp += 3; }

  // 🐘 巨兽：全体加攻击（成员最多、最好凑，所以数值最低）
  const beast = lvl('beast');
  if (beast >= 1) for (const p of myTeam) p.atk += (beast >= 2 ? 5 : 2);

  // 🐾 小兽：防御类 Perk（已有 Perk 的不覆盖，和遗物「铁甲」同一原则）
  //          1 档只给最前排，2 档才全队 —— 门槛也提到了 3/4
  const critter = lvl('critter');
  if (critter >= 2) {
    for (const p of myTeam) if (!p.perks.length) p.perks = [{ id: 'Melon', uses: 1 }];
  } else if (critter === 1 && myTeam[0] && !myTeam[0].perks.length) {
    myTeam[0].perks = [{ id: 'Melon', uses: 1 }];
  }

  // 🦎 爬行：1 档只给最前排辣椒，2 档才全队
  const reptile = lvl('reptile');
  if (reptile >= 2) {
    for (const p of myTeam) if (!p.perks.length) p.perks = [{ id: 'Chili', uses: 1 }];
  } else if (reptile === 1 && myTeam[0] && !myTeam[0].perks.length) {
    myTeam[0].perks = [{ id: 'Chili', uses: 1 }];
  }

  // 🦴 史前：玻璃大炮 —— 全体加攻、减血（不会减死，最低留 1）
  const prehist = lvl('prehist');
  if (prehist >= 1) {
    const addAtk = prehist >= 2 ? 8 : 4;
    const loseHp = prehist >= 2 ? 3 : 2;
    for (const p of myTeam) { p.atk += addAtk; p.hp = Math.max(1, p.hp - loseHp); }
  }

  // 🐒 灵长：唯一按【等级】缩放的阵营 —— 越早合成升级越强
  const primate = lvl('primate');
  if (primate >= 1) {
    const mul = primate >= 2 ? 2 : 1;
    for (const p of myTeam) {
      const n = (p.lvl || 1) * mul;
      p.atk += n; p.hp += n;
    }
  }
}

/* ---- 回合开始：飞禽是唯一在商店阶段生效的阵营 ---- */
function applySynergyTurnStart(game) {
  if (!game || !game.team || !game.team.length) return [];
  const fs = teamFactions(game.team);
  const bird = (fs.filter(function (f) { return f.id === 'bird'; })[0] || { lvl: 0 }).lvl;
  if (bird < 1) return [];

  if (bird >= 2) {
    for (const p of game.team) { p.atk += 2; p.hp += 2; }
    return ['🐦 飞禽：全体友方 +2/+2'];
  }
  // 1 档：随机 2 个（原来只给 1 个，和 2 档差距太大）
  const picked = [];
  const pool = game.team.slice();
  for (let i = 0; i < 2 && pool.length; i++) {
    const t = pool.splice(RNG.int(pool.length), 1)[0];
    t.atk += 2; t.hp += 2;
    picked.push(petName(t.def));
  }
  return ['🐦 飞禽：' + picked.join('、') + ' +2/+2'];
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
