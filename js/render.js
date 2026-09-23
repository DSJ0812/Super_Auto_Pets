'use strict';
/* ============================================================
 *  render.js — 公共渲染层
 *
 *  单人模式（solo.html）和 8 人混战（melee.html）共用。
 *  这里只放「无状态的纯函数 + 静态数据」，
 *  任何模式专属的交互逻辑都不放在这里。
 *
 *  依赖：data.js（PETS / petName）
 * ============================================================ */

/* 宠物表情（纯装饰） */
const PET_EMOJI = {
  Ant: '🐜', Beaver: '🦫', Cricket: '🦗', Duck: '🦆', Fish: '🐟', Horse: '🐴',
  Mosquito: '🦟', Otter: '🦦', Pig: '🐷', Pigeon: '🐦', Sloth: '🦥',
  Crab: '🦀', Flamingo: '🦩', Hedgehog: '🦔', Kangaroo: '🦘', Peacock: '🦚',
  Rat: '🐀', Snail: '🐌', Spider: '🕷️', Swan: '🦢', Worm: '🪱',
  Badger: '🦡', Camel: '🐫', Dodo: '🦤', Dog: '🐕', Dolphin: '🐬',
  Elephant: '🐘', Giraffe: '🦒', Ox: '🐂', Rabbit: '🐰', Sheep: '🐑',
  /* Tier 4 */
  Bison: '🦬', Blowfish: '🐡', Deer: '🦌', Hippo: '🦛', Parrot: '🦜',
  Penguin: '🐧', Skunk: '🦨', Squirrel: '🐿️', Turtle: '🐢', Whale: '🐋',
  /* Tier 5 */
  Armadillo: '🦔', Cow: '🐄', Crocodile: '🐊', Monkey: '🐒', Rhino: '🦏',
  Rooster: '🐓', Scorpion: '🦂', Seal: '🦭', Shark: '🦈', Turkey: '🦃',
  /* Tier 6 */
  Boar: '🐗', Cat: '🐈', Dragon: '🐉', Fly: '🪰', Gorilla: '🦍',
  Leopard: '🐆', Mammoth: '🦣', Snake: '🐍', Tiger: '🐅', Wolverine: '🐺',
  /* 召唤物 */
  ZombieCricket: '🧟', DirtyRat: '🐭', Ram: '🐏', Bee: '🐝',
  Bus: '🚌', Chick: '🐤', ZombieFly: '🪳'
};

const PERK_EMOJI = {
  Melon: '🍉', Honey: '🍯', Garlic: '🧄',
  Chili: '🌶️', Peanut: '🥜', Coconut: '🥥'
};

const FOOD_EMOJI = {
  Apple: '🍎', BetterApple: '🍎', BestApple: '🍎',
  Honey: '🍯', Melon: '🍉', Chili: '🌶️', Peanut: '🥜', Coconut: '🥥',
  Milk: '🥛', BetterMilk: '🥛', BestMilk: '🥛', BreadCrumbs: '🍞'
};

const TIER_NAME = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4', 5: 'Tier 5', 6: 'Tier 6' };

/* ------------------------------------------------------------
 *  小工具
 * ---------------------------------------------------------- */
function $(sel) { return document.querySelector(sel); }

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 通用顶部提示条（两种模式共用） */
let __msgTimer = null;
function say(msg, ms) {
  const box = document.getElementById('message');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(__msgTimer);
  __msgTimer = setTimeout(function () { box.classList.remove('show'); }, ms || 2200);
}

/* ------------------------------------------------------------
 *  宠物卡片
 * ---------------------------------------------------------- */

/* 取某等级对应的技能描述（texts 数组在 data.js 里，索引 = 等级-1） */
function skillTextOf(def, lvl) {
  if (!def || !def.texts) return '';
  const i = Math.min(Math.max(lvl || 1, 1), 3) - 1;
  return def.texts[i] || def.texts[0] || '';
}

function petCard(p, opts) {
  opts = opts || {};
  const def = p.def || PETS[p.defId] || { name: p.defId, cn: '', tier: 0 };
  const card = el('div', 'pet');
  card.dataset.uid = p.uid;
  card.dataset.side = p.side;
  card.dataset.tier = def.tier || 0;

  if (opts.selectable) card.classList.add('selectable');
  if (opts.selected) card.classList.add('selected');
  if (opts.small) card.classList.add('small');
  if (p.hp <= 0) card.classList.add('dead');

  let perkHtml = '';
  for (const pk of (p.perks || [])) {
    if (pk.uses > 0) perkHtml += `<span class="perk" title="${esc(pk.id)}">${PERK_EMOJI[pk.id] || '🎁'}</span>`;
  }

  const skill = skillTextOf(def, p.lvl);

  card.innerHTML =
    // 星级只用边框颜色表达（data-tier 驱动 CSS），不显示文字徽章
    '<div class="pet-top">' +
      '<span class="pet-emoji">' + (PET_EMOJI[p.defId] || '🐾') + '</span>' +
      '<span class="pet-lvl">' + p.lvl + '级</span>' +
    '</div>' +
    '<div class="pet-name">' + esc(petName(def)) + '</div>' +
    '<div class="pet-stats">' +
      '<span class="stat atk">' + p.atk + '</span>' +
      '<span class="slash">/</span>' +
      '<span class="stat hp">' + p.hp + '</span>' +
    '</div>' +
    '<div class="pet-perks">' + perkHtml + '</div>' +
    (skill ? '<div class="pet-skill" title="' + esc(skill) + '">' + esc(skill) + '</div>' : '');
  return card;
}

/* 商店里的宠物槽（单人模式与 8 人模式样式一致） */
function shopPetSlot(p, opts) {
  opts = opts || {};
  const wrap = el('div', 'shop-slot');
  if (opts.frozen) wrap.classList.add('frozen');
  if (opts.selected) wrap.classList.add('selected');
  const c = petCard(p);
  if (opts.slotAttr != null) c.dataset[opts.slotAttr] = opts.slotIndex;
  c.draggable = !!opts.draggable;
  wrap.appendChild(c);
  wrap.appendChild(el('div', 'price', opts.priceHtml != null
    ? opts.priceHtml
    : (opts.affordable ? (opts.cost + ' 金') : '<span class="no">' + opts.cost + ' 金</span>')));
  const fz = el('button', 'freeze', opts.frozen ? '❄ 已冻结' : '❄ 冻结');
  if (opts.freezeAttr != null) fz.dataset[opts.freezeAttr] = opts.slotIndex;
  wrap.appendChild(fz);
  return wrap;
}

/* 道具槽 */
function foodSlot(f, g, opts) {  opts = opts || {};
  if (!f) return el('div', 'shop-slot empty');
  const d = FOODS[f.id];
  const wrap = el('div', 'shop-slot food');
  if (opts.frozen) wrap.classList.add('frozen');
  if (opts.selected) wrap.classList.add('selected');
  wrap.innerHTML =
    '<div class="food-emoji">' + (FOOD_EMOJI[f.id] || '🎁') + '</div>' +
    '<div class="food-name">' + esc(d.cn || d.name) + '</div>' +
    '<div class="food-text">' + esc(d.text) + '</div>';
  if (opts.slotAttr != null) wrap.dataset[opts.slotAttr] = opts.slotIndex;
  const cost = opts.cost != null ? opts.cost : g.foodCost(f);
  wrap.appendChild(el('div', 'price', cost === 0
    ? '<span class="free">免费</span>'
    : (g.gold >= cost ? cost + ' 金' : '<span class="no">' + cost + ' 金</span>')));
  const fz = el('button', 'freeze', opts.frozen ? '❄ 已冻结' : '❄ 冻结');
  if (opts.freezeAttr != null) fz.dataset[opts.freezeAttr] = opts.slotIndex;
  wrap.appendChild(fz);
  return wrap;
}

/* ------------------------------------------------------------
 *  遗物（两种模式共用）
 * ---------------------------------------------------------- */

/* 已获得遗物的小图标条 */
function renderRelicBar(box, relics) {
  if (!box) return;
  if (!relics || !relics.length) {
    box.innerHTML = '<span class="relic-empty">还没有遗物（回合 3/6/9… 会给你三选一）</span>';
    return;
  }
  let html = '';
  for (const id of relics) {
    const r = RELICS[id];
    if (!r) continue;
    html += '<span class="relic-chip" title="' + esc(r.cn + '：' + r.desc) + '">' +
            r.icon + ' ' + esc(r.cn) + '</span>';
  }
  box.innerHTML = html;
}

/* 三选一面板的内容 */
function renderRelicChoices(box, ids) {
  if (!box) return;
  let html = '';
  for (const id of ids) {
    const r = RELICS[id];
    if (!r) continue;
    html += '<button class="relic-option" data-relic="' + esc(id) + '">' +
              '<div class="ro-icon">' + r.icon + '</div>' +
              '<div class="ro-name">' + esc(r.cn) + '</div>' +
              '<div class="ro-tag">' + esc(r.tag) + '</div>' +
              '<div class="ro-desc">' + esc(r.desc) + '</div>' +
            '</button>';
  }
  box.innerHTML = html;
}
