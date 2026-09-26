'use strict';
/* ============================================================
 *  petart.js — 宠物图标（emoji 表 + 预留的图片接口）
 *
 *  为什么单独一个文件：
 *    排行榜要在主页（index.html）显示阵容图标，而主页【不加载 render.js】
 *    （render.js 依赖 data.js / pack.js 一大串），于是 petArtHtml 未定义、
 *    所有图标 fallback 成 🐾 —— 榜上每只宠物长得一模一样。
 *
 *  ⚠️ 本文件【自包含】：不依赖 PETS，也不依赖 render.js 的 esc()。
 *     所以任何页面加一行 <script src="js/petart.js"> 就能用。
 *     render.js 也用同一份（加载顺序：petart.js 要在 render.js 之前）。
 *
 *  依赖：无
 * ============================================================ */

/* 极简 HTML 转义（自包含，不引 render.js 的 esc） */
function petArtEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PET_EMOJI = {
  /* ---- 龟包 Tier 1 ---- */
  Ant: '🐜', Beaver: '🦫', Cricket: '🦗', Duck: '🦆', Fish: '🐟', Horse: '🐴',
  Mosquito: '🦟', Otter: '🦦', Pig: '🐷', Pigeon: '🐦', Sloth: '🦥',
  /* ---- 龟包 Tier 2 ---- */
  Crab: '🦀', Flamingo: '🦩', Hedgehog: '🦔', Kangaroo: '🦘', Peacock: '🦚',
  Rat: '🐀', Snail: '🐌', Spider: '🕷️', Swan: '🦢', Worm: '🪱',
  /* ---- 龟包 Tier 3 ---- */
  Badger: '🦡', Camel: '🐫', Dodo: '🦤', Dog: '🐕', Dolphin: '🐬',
  Elephant: '🐘', Giraffe: '🦒', Ox: '🐂', Rabbit: '🐰', Sheep: '🐑',
  /* ---- 龟包 Tier 4 ---- */
  Bison: '🦬', Blowfish: '🐡', Deer: '🦌', Hippo: '🦛', Parrot: '🦜',
  Penguin: '🐧', Skunk: '🦨', Squirrel: '🐿️', Turtle: '🐢', Whale: '🐋',
  /* ---- 龟包 Tier 5 ---- */
  Armadillo: '🦔', Cow: '🐄', Crocodile: '🐊', Monkey: '🐒', Rhino: '🦏',
  Rooster: '🐓', Scorpion: '🦂', Seal: '🦭', Shark: '🦈', Turkey: '🦃',
  /* ---- 龟包 Tier 6 ---- */
  Boar: '🐗', Cat: '🐈', Dragon: '🐉', Fly: '🪰', Gorilla: '🦍',
  Leopard: '🐆', Mammoth: '🦣', Snake: '🐍', Tiger: '🐅', Wolverine: '🐺',

  /* ---- 星包 Tier 1 ---- */
  Pillbug: '🪲', Chihuahua: '🐕', Cockroach: '🪳', Duckling: '🐤', Firefly: '✨',
  Frog: '🐸', Gibbon: '🐒', Hummingbird: '🐦', Kiwi: '🥝', Marmoset: '🐒',
  Mouse: '🐭', Termite: '🐜',
  /* ---- 星包 Tier 2 ---- */
  AtlanticPuffin: '🐧', Bass: '🐟', Dove: '🕊️', GuineaPig: '🐹', Iguana: '🦎',
  Jellyfish: '🪼', Panda: '🐼', Salamander: '🦎', Seahorse: '🐠', Stork: '🐦',
  Yak: '🐂', Roadrunner: '🐦', Koala: '🐨',
  /* ---- 星包 Tier 3 ---- */
  Anteater: '🐜', Capybara: '🐹', Cardinal: '🐦', Cassowary: '🦤', Eel: '🐍',
  Leech: '🪱', Okapi: '🦓', Orangutan: '🦧', Pug: '🐕', Toad: '🐸', Tuna: '🐟',
  /* ---- 星包 Tier 4 ---- */
  Clownfish: '🐠', Crow: '🐦', Donkey: '🫏', Elk: '🦌', Fossa: '🐆',
  Hawk: '🦅', Platypus: '🦫', SeaAnemone: '🪸', Sparrow: '🐦', PrayingMantis: '🦗',
  RacketTail: '🐦', FairyArmadillo: '🦔',
  /* ---- 星包 Tier 5 ---- */
  Ibex: '🐐', Blobfish: '🐡', Fox: '🦊', Hamster: '🐹', Lion: '🦁',
  PolarBear: '🐻', Shoebill: '🐦', SiberianHusky: '🐕', Starfish: '⭐',
  Triceratops: '🦕', Vulture: '🦅', Woodpecker: '🐦', Zebra: '🦓',
  /* ---- 星包 Tier 6 ---- */
  Alpaca: '🦙', HammerheadShark: '🦈', HarpyEagle: '🦅', Komodo: '🦎',
  Orca: '🐋', Ostrich: '🦤', Piranha: '🐟', RealVelociraptor: '🦖',
  Reindeer: '🦌', SabertoothTiger: '🐯', Spinosaurus: '🦖', Stegosaurus: '🦕',
  Velociraptor: '🦖', TerrorBird: '🦤', Therizinosaurus: '🦖', Ammonite: '🐚',

  /* ---- 召唤物 ---- */
  ZombieCricket: '🧟', DirtyRat: '🐭', Ram: '🐏', Bee: '🐝',
  Bus: '🚌', Chick: '🐤', ZombieFly: '🪳', CookedRoach: '🪳',
  FairyBall: '🔮', MimicOctopus: '🐙'
}

/* ------------------------------------------------------------
 *  宠物图片接口（预留）
 *
 *  现在用 emoji 顶着，但整套渲染都走 petArtHtml()，所以以后要换成真图
 *  只需要在这里加一行、把图片丢进 assets/pets/ 就行 —— 三种模式、
 *  商店、队伍、战斗、图鉴会一起生效，不用改任何别的地方。
 *
 *  用法（示例，注释掉的那行就是格式）：
 *      const PET_ART = {
 *        Ant: 'assets/pets/ant.png',
 *        Beaver: 'assets/pets/beaver.png',
 *      };
 *  没在这里登记的宠物会自动退回 emoji，所以可以一张一张慢慢加。
 * ---------------------------------------------------------- */

const PET_ART = {
  // Ant: 'assets/pets/ant.png',
}

function petArtHtml(defId) {
  const src = PET_ART[defId];
  if (src) {
    return '<img class="pet-img" src="' + petArtEsc(src) + '" alt="' +
           petArtEsc((typeof PETS !== 'undefined' && PETS[defId] && PETS[defId].cn) || defId) + '">';
  }
  return PET_EMOJI[defId] || '🐾';
}

/* ------------------------------------------------------------
 *  道具（Perk）图标
 *
 *  ⚠️ 原来在 render.js 里，主页（index.html）不加载 render.js，
 *     而排行榜的「阵容详情」要在主页显示道具，所以和 PET_EMOJI 一样
 *     归到本文件 —— 图标表就该和图标表在一起。
 *     render.js 加载在本文件之后，petCard 里用的是同一个 PERK_EMOJI，只有一份。
 * ---------------------------------------------------------- */
const PERK_EMOJI = {
  Melon: '🍉', Honey: '🍯', Garlic: '🧄',
  Chili: '🌶️', Peanut: '🥜', Coconut: '🥥',
  /* 星包 */
  Strawberry: '🍓', Cucumber: '🥒', Cheese: '🧀', Grapes: '🍇',
  Carrot: '🥕', Pepper: '🧂', Popcorn: '🍿', Eucalyptus: '🌿'
};

/* 道具的中文名直接取自 FOODS（data.js 里唯一的那份），
 * 这里只做兜底 —— 不另存一份名字，免得改名要改两处。 */
function perkCn(id) {
  if (typeof FOODS !== 'undefined' && FOODS[id] && FOODS[id].cn) return FOODS[id].cn;
  return String(id == null ? '' : id);
}
function perkIcon(id) { return PERK_EMOJI[id] || '🎁'; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PET_EMOJI: PET_EMOJI, PET_ART: PET_ART, petArtHtml: petArtHtml,
                     PERK_EMOJI: PERK_EMOJI, perkCn: perkCn, perkIcon: perkIcon };
}
