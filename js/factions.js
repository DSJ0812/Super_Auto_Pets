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
 *  一共有 6 个阵营，按体型/生态分：
 *    虫豸(12) 水生(22) 飞禽(25) 巨兽(29) 小兽(27) 爬行(12)
 *
 *  加成刻意做成 6 种不同性格，避免同质化：
 *    虫豸=血量 · 水生=前排 · 飞禽=成长 · 巨兽=攻击 · 小兽=减伤 · 爬行=爆发
 * ============================================================ */

const FACTIONS = {
  bug: {
    cn: '虫豸', icon: '🐜', tiers: [2, 4],
    desc: ['开战：全体友方 +2 生命', '开战：全体友方 +5 生命']
  },
  aqua: {
    cn: '水生', icon: '🐟', tiers: [2, 4],
    desc: ['开战：最前排 +4/+4', '开战：全体友方 +3/+3']
  },
  bird: {
    cn: '飞禽', icon: '🐦', tiers: [2, 3],
    desc: ['每回合开始：随机 1 个友方 +2/+2', '每回合开始：全体友方 +1/+1']
  },
  beast: {
    cn: '巨兽', icon: '🐘', tiers: [2, 4],
    desc: ['开战：全体友方 +2 攻击', '开战：全体友方 +5 攻击']
  },
  critter: {
    cn: '小兽', icon: '🐾', tiers: [2, 3],
    desc: ['开战：全体友方获得西瓜（减伤 20，一次）', '开战：全体友方获得椰子（免疫一次）']
  },
  reptile: {
    cn: '爬行', icon: '🦎', tiers: [2, 3],
    desc: ['开战：全体友方获得辣椒（溅射 5）', '开战：全体友方 +4/+4']
  }
};

/* 宠物 → 阵营。⚠️ 每一只可购买宠物都必须在这里，
 *    factions.js 的测试会核对覆盖率（漏一只就报错）。 */
const FACTION_MEMBERS = {
  bug: ['Ant', 'Cricket', 'Mosquito', 'Spider', 'Worm', 'Snail', 'Scorpion', 'Fly',
        'Cockroach', 'Firefly', 'Termite', 'Leech'],
  aqua: ['Fish', 'Crab', 'Dolphin', 'Blowfish', 'Turtle', 'Whale', 'Crocodile', 'Seal', 'Shark',
         'Bass', 'Jellyfish', 'Seahorse', 'Eel', 'Tuna', 'Clownfish', 'SeaAnemone', 'Blobfish',
         'HammerheadShark', 'Orca', 'Piranha', 'Platypus', 'Penguin', 'Starfish'],
  bird: ['Duck', 'Pigeon', 'Flamingo', 'Peacock', 'Swan', 'Dodo', 'Parrot', 'Rooster', 'Turkey',
         'Duckling', 'Hummingbird', 'Kiwi', 'AtlanticPuffin', 'Dove', 'Stork', 'Cardinal',
         'Cassowary', 'Crow', 'Hawk', 'Sparrow', 'Shoebill', 'Vulture', 'Woodpecker',
         'HarpyEagle', 'Ostrich'],
  beast: ['Horse', 'Pig', 'Elephant', 'Giraffe', 'Ox', 'Bison', 'Deer', 'Hippo', 'Rhino', 'Boar',
          'Gorilla', 'Leopard', 'Mammoth', 'Tiger', 'Wolverine', 'Lion', 'PolarBear', 'Zebra',
          'Elk', 'Yak', 'Camel', 'Kangaroo', 'Panda', 'Anteater', 'Cow', 'Donkey', 'Alpaca',
          'Reindeer', 'SabertoothTiger'],
  critter: ['Beaver', 'Otter', 'Sloth', 'Hedgehog', 'Rat', 'Badger', 'Dog', 'Rabbit', 'Sheep',
            'Skunk', 'Squirrel', 'Armadillo', 'Monkey', 'Cat', 'Chihuahua', 'Gibbon', 'Marmoset',
            'Mouse', 'GuineaPig', 'Capybara', 'Okapi', 'Orangutan', 'Pug', 'Fossa', 'Fox',
            'Hamster', 'SiberianHusky'],
  // 龙也算爬行 —— 它本来就是蜥蜴
  reptile: ['Snake', 'Iguana', 'Salamander', 'Toad', 'Frog', 'Komodo', 'Triceratops',
            'Stegosaurus', 'Spinosaurus', 'Velociraptor', 'RealVelociraptor', 'Dragon']
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

  // 🐜 虫豸：全体加生命
  const bug = lvl('bug');
  if (bug >= 1) for (const p of myTeam) p.hp += (bug >= 2 ? 5 : 2);

  // 🐟 水生：2 档强化全体，1 档只强化最前排
  const aqua = lvl('aqua');
  if (aqua >= 2) { for (const p of myTeam) { p.atk += 3; p.hp += 3; } }
  else if (aqua === 1 && myTeam[0]) { myTeam[0].atk += 4; myTeam[0].hp += 4; }

  // 🐘 巨兽：全体加攻击
  const beast = lvl('beast');
  if (beast >= 1) for (const p of myTeam) p.atk += (beast >= 2 ? 5 : 2);

  // 🐾 小兽：全体获得防御类 Perk（已有 Perk 的不覆盖，和遗物「铁甲」同一原则）
  const critter = lvl('critter');
  if (critter >= 1) {
    const perk = critter >= 2 ? 'Coconut' : 'Melon';
    for (const p of myTeam) if (!p.perks.length) p.perks = [{ id: perk, uses: 1 }];
  }

  // 🦎 爬行：1 档给辣椒，2 档全体 +4/+4
  const reptile = lvl('reptile');
  if (reptile >= 2) { for (const p of myTeam) { p.atk += 4; p.hp += 4; } }
  else if (reptile === 1) {
    for (const p of myTeam) if (!p.perks.length) p.perks = [{ id: 'Chili', uses: 1 }];
  }
}

/* ---- 回合开始：飞禽是唯一在商店阶段生效的阵营 ---- */
function applySynergyTurnStart(game) {
  if (!game || !game.team || !game.team.length) return [];
  const fs = teamFactions(game.team);
  const bird = (fs.filter(function (f) { return f.id === 'bird'; })[0] || { lvl: 0 }).lvl;
  if (bird < 1) return [];

  if (bird >= 2) {
    for (const p of game.team) { p.atk += 1; p.hp += 1; }
    return ['🐦 飞禽：全体友方 +1/+1'];
  }
  const t = game.team[RNG.int(game.team.length)];
  t.atk += 2; t.hp += 2;
  return ['🐦 飞禽：' + petName(t.def) + ' +2/+2'];
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
