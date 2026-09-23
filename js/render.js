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

/* ------------------------------------------------------------
 *  队伍格子的点击语义（经典 / 混战 / 联机 三处共用）
 *
 *  为什么要「点选 → 点目标」这套：HTML5 的 dragstart/drop 在触屏上
 *  根本不触发（iOS/Android 都忽略 draggable），手机上就没法调站位。
 *  点击是所有设备都有的，所以再给一套点击式操作，拖动仍然保留给鼠标。
 *
 *  state = { sel: 当前选中的队伍索引（-1 = 没选）, pendingFood: 是否在等选道具目标 }
 *  i     = 点到的格子索引（可能落在空位上）
 *  teamLen = 当前队伍只数（i >= teamLen 说明点到空位）
 *
 *  返回 { act, from, to }，act ∈ food | sell | move | select | none
 * ---------------------------------------------------------- */
function teamTapAction(state, i, teamLen) {
  const sel = (state && state.sel >= 0) ? state.sel : -1;

  // 有道具待用 → 这一下是「选目标」，优先级最高
  if (state && state.pendingFood) return { act: 'food', from: -1, to: i };

  // 点到空位：把选中的挪过去；没选中就什么也不做
  if (i >= teamLen) {
    return (sel >= 0) ? { act: 'move', from: sel, to: i } : { act: 'none', from: -1, to: i };
  }

  // 点自己 → 出售
  if (sel === i) return { act: 'sell', from: i, to: i };

  // 选中了别的 → 挪过去（这是手机上换站位的唯一途径）
  if (sel >= 0) return { act: 'move', from: sel, to: i };

  // 什么都没选 → 选中它
  return { act: 'select', from: -1, to: i };
}

/* 是不是触屏输入（触屏上拖拽不可用，提示文案要换一套） */
function isTouchUI() {
  try {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return true;
  } catch (e) { /* 老浏览器没有 matchMedia，往下走 */ }
  return ((typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0) > 0;
}

/* 队伍操作提示（两种输入方式给出各自真正能做到的说明） */
function teamHintText() {
  return isTouchUI()
    ? '点商店宠物购买 · 点队伍里的宠物选中，再点另一只/空位就能换站位 · 再点自己出售'
    : '点击购买 · 拖动或「点选→点目标」调整站位 · 点两次出售 · 可攒钱吃利息';
}

/* ============================================================
 *  阵营羁绊条（三种界面共用）
 *  显示当前队伍里每个阵营的人数和档位；已激活的排在前面并高亮。
 * ============================================================ */
function renderSynergyBar(box, team) {
  if (!box) return;
  if (typeof activeFactions !== 'function') { box.innerHTML = ''; return; }
  const list = activeFactions(team || []);
  if (!list.length) {
    box.innerHTML = '<span class="sy-empty">还没有阵营羁绊' +
      '（同一个阵营的【不同】宠物凑够 2 只就激活）</span>';
    return;
  }
  let html = '';
  for (const f of list) {
    const info = FACTIONS[f.id];
    const on = f.lvl > 0;
    html += '<span class="sy-chip' + (on ? ' on' : '') + '" title="' +
              esc(info.cn + '：' + info.desc.join(' → ')) + '">' +
              info.icon + ' ' + esc(info.cn) + ' <b>' + f.n + '</b>' +
              (on ? '<span class="sy-lv">' + f.lvl + '档</span>'
                  : '<span class="sy-next">还差' + f.next + '</span>') +
            '</span>';
  }
  const on2 = list.filter(function (f) { return f.lvl > 0; });
  if (on2.length) {
    html += '<span class="sy-effect">' + on2.map(function (f) {
      return FACTIONS[f.id].icon + ' ' + esc(factionDesc(f));
    }).join(' ・ ') + '</span>';
  }
  box.innerHTML = html;
}

/* ============================================================
 *  种子（每日挑战 / 分享同一局）
 * ============================================================ */

/* 初始化这一局的种子。
 * ⚠️ 必须在 new Game() 之前调用 —— 种子要赶在第一次 rollShop 之前设好。
 * 返回 { seed, daily, dateKey } */
function initSeed() {
  let p = null;
  try {
    p = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  } catch (e) { p = null; }

  const daily = !!(p && p.get('daily') === '1');
  let seed = p ? p.get('seed') : null;
  let dateKey = null;

  // 宠物包：?pack=star。⚠️ 目前只在地址栏生效，主页还没放选择入口 ——
  // 星包只做到 T1，选了会是个残包，等 6 个星级都齐了再开放。
  const pack = p ? p.get('pack') : null;
  if (pack && typeof PACKS !== 'undefined' && PACKS[pack]) CFG.PACK = pack;

  if (daily) {
    dateKey = RNG.dailySeed();          // daily-2026-09-23，同一天所有人都一样
    seed = dateKey;
  } else if (!seed) {
    seed = RNG.randomSeed();            // 每局都有种子，好玩的一局才能发给别人
  }
  RNG.seed(seed);
  return { seed: seed, daily: daily, dateKey: dateKey, pack: activePack() };
}

/* 分享用的地址。file:// 打开的页面没有能分享的地址，就退回种子本身 */
function seedLink(seed) {
  try {
    if (location.protocol === 'file:') return seed;
    return location.origin + location.pathname + '?seed=' + encodeURIComponent(seed);
  } catch (e) { return seed; }
}

/* 复制到剪贴板（没有 clipboard API 时退回 execCommand） */
function copyText(text) {
  return new Promise(function (resolve) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); },
                                                 function () { resolve(fallbackCopy(text)); });
        return;
      }
    } catch (e) { /* 往下走回退方案 */ }
    resolve(fallbackCopy(text));
  });
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

/* 每日挑战的成绩记录（存在本机浏览器里） */
function dailyRecordKey(dateKey) { return 'sap_daily_' + dateKey; }

function dailyRecord(dateKey) {
  try {
    return JSON.parse(localStorage.getItem(dailyRecordKey(dateKey)) || '{}') || {};
  } catch (e) { return {}; }
}

/* 记一局成绩。首次成绩和最好成绩分开存 ——
 * 允许反复重玩，但「首次」才是每日挑战真正有意义的那个数 */
function dailySave(dateKey, wins, losses, win) {
  const rec = dailyRecord(dateKey);
  rec.plays = (rec.plays || 0) + 1;
  if (!rec.first) rec.first = { wins: wins, losses: losses, win: !!win };
  if (!rec.best || wins > rec.best.wins) rec.best = { wins: wins, losses: losses, win: !!win };
  try { localStorage.setItem(dailyRecordKey(dateKey), JSON.stringify(rec)); } catch (e) {}
  return rec;
}

function dailyNoteText(rec) {
  if (!rec || !rec.plays) return '今天还没玩过';
  let s = '今天玩了 ' + rec.plays + ' 局';
  if (rec.first) s += ' · 首次 ' + rec.first.wins + ' 胜' + (rec.first.win ? '（通关）' : '');
  if (rec.best && rec.best.wins !== (rec.first ? rec.first.wins : -1)) s += ' · 最好 ' + rec.best.wins + ' 胜';
  return s;
}

/* 渲染顶部那条种子栏
 * opts.canEdit = false 时不给「换种子」（联机时种子归服务器管） */
function renderSeedBar(box, info, noteText, opts) {
  if (!box) return;
  opts = opts || {};
  const canEdit = opts.canEdit !== false;
  box.innerHTML =
    '<span class="seed-icon">' + (info.daily ? '📅' : '🎲') + '</span>' +
    '<span class="seed-label">' + (opts.label || (info.daily ? '每日挑战' : '种子')) + '</span>' +
    '<code class="seed-val">' + esc(info.daily ? info.dateKey : info.seed) + '</code>' +
    '<button class="btn tiny" data-seed="copy">🔗 ' + (info.daily ? '复制链接' : '分享这局') + '</button>' +
    (canEdit ? '<button class="btn tiny" data-seed="edit">✏️ 换种子</button>' : '') +
    (noteText ? '<span class="seed-note">' + esc(noteText) + '</span>' : '');
  box.classList.toggle('daily', !!info.daily);
}

/* 种子栏上的两个按钮（三个界面共用） */
function bindSeedBar(box, info, opts) {
  if (!box) return;
  opts = opts || {};
  box.onclick = function (e) {
    const b = e.target.closest('[data-seed]');
    if (!b) return;

    if (b.dataset.seed === 'copy') {
      const what = typeof opts.copyValue === 'function' ? opts.copyValue() : seedLink(info.seed);
      copyText(what).then(function (ok) {
        say(ok ? ('已复制：' + what) : ('复制失败，手动记下：' + what));
      });
      return;
    }

    if (b.dataset.seed === 'edit') {
      const want = prompt('输入种子（同一个种子 = 同一局）：', info.seed);
      if (want === null) return;
      const s = String(want).trim();
      if (!s) return;
      // 换种子等于重开一局：带参数重新加载最省事，也最不容易出错
      try {
        const u = new URL(location.href);
        u.searchParams.delete('daily');
        u.searchParams.set('seed', s);
        location.href = u.toString();
      } catch (err) { say('换种子失败：' + err.message); }
    }
  };
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

/* ============================================================
 *  图鉴（两种模式共用）
 *
 *  内容：可购买宠物（按星级）/ 召唤物 / 道具 / 遗物（按类别）
 *  两种模式调同一个 renderCodexInto()，保证内容永远一致。
 * ============================================================ */

/* 遗物类别的展示顺序 */
const RELIC_TAG_ORDER = ['经济', '成长', '战斗'];

/* ---- 图鉴：宠物卡片 ---- */
function codexPetCard(id) {
  const d = PETS[id];
  if (!d) return '';
  let rows = '';
  if (d.texts && d.texts.length) {
    for (let i = 0; i < 3; i++) {
      const txt = d.texts[i] || d.texts[0] || '';
      rows += '<div class="codex-row"><span class="codex-lv">' + (i + 1) + '级</span>' +
              '<span>' + esc(txt) + '</span></div>';
    }
  } else {
    rows = '<div class="codex-row"><span>—</span></div>';
  }
  return '<div class="codex-card" data-tier="' + (d.tier || 0) + '">' +
      '<div class="codex-top">' +
        '<span class="codex-emoji">' + (PET_EMOJI[id] || '🐾') + '</span>' +
        '<span class="codex-name">' + esc(petName(d)) + '</span>' +
        '<span class="codex-en">' + esc(d.name) + '</span>' +
        '<span class="codex-base">' +
          '<span class="atk">' + d.atk + '</span>' +
          '<span class="slash">/</span>' +
          '<span class="hp">' + d.hp + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="codex-ability">' + rows + '</div>' +
    '</div>';
}

/* ---- 图鉴：道具卡片（FOOD_EMOJI 见本文件顶部）---- */
function codexFoodCard(id) {
  const f = FOODS[id];
  if (!f) return '';
  return '<div class="codex-card food" data-tier="0">' +
      '<div class="codex-top">' +
        '<span class="codex-emoji">' + (FOOD_EMOJI[id] || '🎁') + '</span>' +
        '<span class="codex-name">' + esc(f.cn || f.name) + '</span>' +
        '<span class="codex-en">' + esc(f.name) + '</span>' +
        '<span class="codex-base">' + f.cost + ' 金</span>' +
      '</div>' +
      '<div class="codex-ability">' +
        '<div class="codex-row"><span>' + esc(f.text) + '</span></div>' +
      '</div>' +
    '</div>';
}

/* ---- 图鉴：遗物卡片 ---- */
function codexRelicCard(id) {
  const r = RELICS[id];
  if (!r) return '';
  return '<div class="codex-card relic" data-tag="' + esc(r.tag) + '">' +
      '<div class="codex-top">' +
        '<span class="codex-emoji">' + r.icon + '</span>' +
        '<span class="codex-name">' + esc(r.cn) + '</span>' +
        '<span class="codex-en">' + esc(r.name) + '</span>' +
        '<span class="codex-tag">' + esc(r.tag) + '</span>' +
      '</div>' +
      '<div class="codex-ability">' +
        '<div class="codex-row"><span>' + esc(r.desc) + '</span></div>' +
      '</div>' +
    '</div>';
}

/* 把整个图鉴渲染进 bodyEl，并回填计数到 subEl */
function renderCodexInto(bodyEl, subEl) {
  if (!bodyEl) return;
  let html = '';
  let nPet = 0, nToken = 0, nFood = 0, nRelic = 0;

  /* ---- 可购买宠物：先按宠物包分组，再按星级 ----
   * 两个包混在一起看会很乱（同一个 Tier 1 里既有龟包也有星包），
   * 所以先给一行包标题，再列各星级。 */
  const ids = Object.keys(PETS).filter(function (k) {
    const d = PETS[k];
    return !d.token && d.tier >= 1;
  }).sort(function (a, b) {
    const A = PETS[a], B = PETS[b];
    if (A.tier !== B.tier) return A.tier - B.tier;
    return (A.cn || A.name).localeCompare(B.cn || B.name, 'zh-CN');
  });

  const packIds = (typeof PACKS !== 'undefined') ? Object.keys(PACKS) : ['turtle'];
  for (const pk of packIds) {
    const mine = ids.filter(function (id) { return packOf(id) === pk; });
    if (!mine.length) continue;
    const info = (typeof PACKS !== 'undefined' && PACKS[pk]) || { cn: pk, icon: '' };

    // 只有一个包有宠物时不显示包标题，免得白占一行
    if (packIds.filter(function (q) { return ids.some(function (id) { return packOf(id) === q; }); }).length > 1) {
      html += '<div class="codex-pack">' + info.icon + ' ' + esc(info.cn) +
              ' · ' + mine.length + ' 只</div>';
    }

    const byTier = {};
    for (const id of mine) (byTier[PETS[id].tier] = byTier[PETS[id].tier] || []).push(id);
    for (const t of Object.keys(byTier).sort(function (a, b) { return a - b; })) {
      html += '<div class="codex-tier">' + (TIER_NAME[t] || 'Tier ' + t) +
              ' · ' + byTier[t].length + ' 只</div><div class="codex-grid">';
      for (const id of byTier[t]) html += codexPetCard(id);
      html += '</div>';
      nPet += byTier[t].length;
    }
  }

  /* ---- 召唤物 ---- */
  const tokens = Object.keys(PETS).filter(function (k) { return PETS[k].token; })
    .sort(function (a, b) {
      return (PETS[a].cn || a).localeCompare(PETS[b].cn || b, 'zh-CN');
    });
  if (tokens.length) {
    html += '<div class="codex-tier">召唤物 · ' + tokens.length +
            ' 只（只能由技能召唤，不会出现在商店）</div><div class="codex-grid">';
    for (const id of tokens) html += codexPetCard(id);
    html += '</div>';
    nToken = tokens.length;
  }

  /* ---- 道具 ---- */
  const foods = Object.keys(FOODS).sort(function (a, b) {
    const ta = FOODS[a].token ? 1 : 0, tb = FOODS[b].token ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return (FOODS[a].cn || a).localeCompare(FOODS[b].cn || b, 'zh-CN');
  });
  if (foods.length) {
    html += '<div class="codex-tier">道具 · ' + foods.length +
            ' 种（每只宠物同时只能带 1 个）</div><div class="codex-grid">';
    for (const id of foods) html += codexFoodCard(id);
    html += '</div>';
    nFood = foods.length;
  }

  /* ---- 遗物：按类别分组（保持 relics.js 里的声明顺序）---- */
  const relicIds = (typeof RELIC_IDS !== 'undefined' ? RELIC_IDS : Object.keys(RELICS));
  const tags = RELIC_TAG_ORDER.concat(
    Object.keys(RELICS).map(function (k) { return RELICS[k].tag; })
      .filter(function (t, i, arr) { return RELIC_TAG_ORDER.indexOf(t) < 0 && arr.indexOf(t) === i; })
  );
  let relicFirst = true;
  for (const tag of tags) {
    const arr = relicIds.filter(function (id) { return RELICS[id] && RELICS[id].tag === tag; });
    if (!arr.length) continue;
    html += '<div class="codex-tier">遗物 · ' + esc(tag) + ' · ' + arr.length + ' 件' +
            (relicFirst ? '（回合 3/6/9… 三选一，永久生效）' : '') +
            '</div><div class="codex-grid">';
    for (const id of arr) html += codexRelicCard(id);
    html += '</div>';
    nRelic += arr.length;
    relicFirst = false;
  }

  bodyEl.innerHTML = html;
  if (subEl) {
    subEl.textContent = '宠物 ' + nPet + ' 只 · 召唤物 ' + nToken + ' 只 · 道具 ' +
      nFood + ' 种 · 遗物 ' + nRelic + ' 件 · 点空白处或按 Esc 关闭';
  }
}

/* 打开 / 关闭图鉴（两种模式各有一套遮罩，但行为一致） */
function openCodex(overlaySel, bodySel) {
  const ov = $(overlaySel);
  if (!ov) return;
  renderCodexInto($(bodySel), $('#codexSub'));
  ov.style.display = 'flex';
}
function closeCodex(overlaySel) {
  const ov = $(overlaySel);
  if (ov) ov.style.display = 'none';
}
/* 遮罩关了没（给点击处理器用） */
function codexOpen(overlaySel) {
  const ov = $(overlaySel);
  return !!ov && ov.style.display === 'flex';
}
