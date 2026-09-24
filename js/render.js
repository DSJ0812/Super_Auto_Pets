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

/* 宠物表情（纯装饰）
 * ⚠️ 每只宠物都必须在这里有一条 —— 否则卡片会 fallback 成 🐾（两个爪爪），
 *    星包刚加进来时就是这样，整包宠物长得一模一样。
 *    有一条测试（emoji.js）会检查「所有宠物/食物都有 emoji」，别再漏了。 */
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
};

const PERK_EMOJI = {
  Melon: '🍉', Honey: '🍯', Garlic: '🧄',
  Chili: '🌶️', Peanut: '🥜', Coconut: '🥥',
  /* 星包 */
  Strawberry: '🍓', Cucumber: '🥒', Cheese: '🧀', Grapes: '🍇',
  Carrot: '🥕', Pepper: '🧂', Popcorn: '🍿', Eucalyptus: '🌿'
};

const FOOD_EMOJI = {
  Apple: '🍎', BetterApple: '🍎', BestApple: '🍎',
  Honey: '🍯', Melon: '🍉', Chili: '🌶️', Peanut: '🥜', Coconut: '🥥',
  Milk: '🥛', BetterMilk: '🥛', BestMilk: '🥛', BreadCrumbs: '🍞',
  /* 星包食物 */
  Strawberry: '🍓', Chocolate: '🍫', Cucumber: '🥒', Cheese: '🧀',
  Grapes: '🍇', Carrot: '🥕', Pepper: '🧂', Popcorn: '🍿',
  Eucalyptus: '🌿', SleepingPill: '💊'
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
  bindFactionClicks();
  const list = activeFactions(team || []);
  if (!list.length) {
    // 一个羁绊都还没凑到：把六个阵营都列出来，玩家能点开看它们分别要谁
    box.innerHTML = '<span class="sy-empty">还没有阵营羁绊' +
      '（同一个阵营的【不同】宠物凑够 2 只就激活）</span>';
    renderFactionLegend(box, team);
    return;
  }
  let html = '';
  for (const f of list) {
    const info = FACTIONS[f.id];
    const on = f.lvl > 0;
    // data-faction = 点击打开羁绊详情（参考金铲铲的羁绊说明）
    html += '<span class="sy-chip' + (on ? ' on' : '') + '" data-faction="' + f.id + '" title="' +
              esc(info.cn + '：' + info.desc.join(' → ') + '（点击看详情和成员）') + '">' +
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

/* 没有羁绊时也列出全部阵营（可点开看详情） */
function renderFactionLegend(box, team) {
  if (!box || typeof FACTIONS === 'undefined') return;
  let h = '<span class="sy-legend">';
  for (const id of Object.keys(FACTIONS)) {
    const info = FACTIONS[id];
    h += '<span class="sy-chip mini" data-faction="' + id + '" title="' +
         esc(info.cn + '（点击看详情和成员）') + '">' + info.icon + ' ' + esc(info.cn) + '</span>';
  }
  h += '</span>';
  box.innerHTML += h;
}

/* ------------------------------------------------------------
 *  羁绊详情弹层（点阵营条上的 chip 打开）
 *  「这个羁绊有什么用、包含哪些宠物、我队里现在有几个」——一次看全。
 * ---------------------------------------------------------- */
function factionDetailHtml(id, team, noClose) {
  const info = (typeof FACTIONS !== 'undefined') ? FACTIONS[id] : null;
  if (!info) return '';
  const members = (typeof FACTION_MEMBERS !== 'undefined' && FACTION_MEMBERS[id]) || [];
  // 队里已经凑了几个（按 defId 去重，和羁绊计数规则一致）
  const mineSet = {};
  for (const p of (team || [])) {
    if (p && typeof factionOf === 'function' && factionOf(p.defId) === id) mineSet[p.defId] = 1;
  }
  const mineN = Object.keys(mineSet).length;

  let h = '<div class="fac-pop-box">';
  h += '<div class="fac-pop-head"><span class="fac-pop-title">' + info.icon + ' ' +
       esc(info.cn) + '</span><span class="fac-pop-count">' + members.length +
       ' 只</span>' + (noClose ? '' : '<span class="fac-pop-close" data-fac-close="1">✕</span>') +
       '</div>';
  h += '<div class="fac-pop-tiers">';
  info.tiers.forEach(function (need, i) {
    const got = mineN >= need;
    h += '<div class="fac-pop-tier' + (got ? ' on' : '') + '">' +
         '<b>' + need + ' 只</b><span>' + esc(info.desc[i] || '') + '</span></div>';
  });
  h += '</div>';
  h += '<div class="fac-pop-sub">你队里现在有 <b class="' + (mineN > 0 ? 'has' : '') + '">' +
       mineN + '</b> 只' +
       (mineN >= info.tiers[info.tiers.length - 1] ? '（已吃满）'
         : '（还差 ' + (info.tiers.filter(function (n) { return n > mineN; })[0] - mineN) + ' 只到下一档）') +
       '</div>';
  h += '<div class="fac-pop-sub">包含的宠物（点卡片可加进筛选）</div>';
  h += '<div class="fac-pop-members">';
  const sorted = members.slice().sort(function (a, b) {
    const A = (typeof PETS !== 'undefined' && PETS[a]) || {}, B = (typeof PETS !== 'undefined' && PETS[b]) || {};
    if ((A.tier || 0) !== (B.tier || 0)) return (A.tier || 0) - (B.tier || 0);
    return String(A.cn || a).localeCompare(String(B.cn || b), 'zh-CN');
  });
  for (const mid of sorted) {
    const d = (typeof PETS !== 'undefined' && PETS[mid]) || null;
    const cn = d ? (d.cn || d.name) : mid;
    const em = (typeof PET_EMOJI !== 'undefined' && PET_EMOJI[mid]) || '🐾';
    const inMine = mineSet[mid] ? ' in' : '';
    h += '<span class="fac-member' + inMine + '" title="' + esc(cn) + '">' + em +
         '<i>T' + ((d && d.tier) || '?') + '</i>' + esc(cn) + '</span>';
  }
  h += '</div></div>';
  return h;
}

/* 惰性创建弹层容器（不用改三个页面的 HTML） */
function ensureFactionPop() {
  if (typeof document === 'undefined' || !document.body) return null;
  let el0 = document.getElementById('facPop');
  if (!el0) {
    el0 = document.createElement('div');
    el0.id = 'facPop';
    el0.className = 'fac-pop';
    el0.style.display = 'none';
    el0.addEventListener('click', function (ev) {
      // 点空白处或 ✕ 关闭（点内容不关）
      if (ev.target === el0 || (ev.target && ev.target.getAttribute &&
          ev.target.getAttribute('data-fac-close'))) {
        el0.style.display = 'none';
      }
    });
    document.body.appendChild(el0);
  }
  return el0;
}

/* 打开羁绊详情。team 用于显示「你队里现在有几个」 */
function showFactionPop(id, team) {
  const pop = ensureFactionPop();
  if (!pop) return;
  const html = factionDetailHtml(id, team);
  if (!html) return;
  pop.innerHTML = html;
  pop.style.display = 'flex';
}

function hideFactionPop() {
  const pop = (typeof document !== 'undefined' && document.getElementById)
    ? document.getElementById('facPop') : null;
  if (pop) pop.style.display = 'none';
}

/* 全局事件委托：点到带 data-faction 的东西就弹详情。
 * 用委托而不是逐个绑定，三个模式共用一份、也不怕重新渲染丢监听。 */
let __facBound = false;
function bindFactionClicks() {
  if (__facBound || typeof document === 'undefined' || !document.addEventListener) return;
  __facBound = true;
  document.addEventListener('click', function (ev) {
    let n = ev.target;
    while (n && n.getAttribute) {
      const fid = n.getAttribute('data-faction');
      if (fid) {
        // 找到「当前正在看的队伍」：优先各模式暴露的 getter，找不到就不显示队内计数
        let team = null;
        try {
          if (typeof MUI !== 'undefined' && MUI.m && MUI.m.human) team = MUI.m.human.game.team;
          else if (typeof OUI !== 'undefined' && OUI.game) team = OUI.game.team;
          else if (typeof UI !== 'undefined' && UI.game) team = UI.game.team;
        } catch (e) { team = null; }
        showFactionPop(fid, team);
        ev.stopPropagation();
        return;
      }
      n = n.parentNode;
    }
  });
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') hideFactionPop();
    });
  }
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

/* 升级进度文字：1 级 1/2 · 2 级 3/5 · 3 级 MAX
 * 官方只显示等级徽章、要玩家自己数；这里直接写出「还差多少经验」，
 * 省得玩家去记「升 2 级要 2 点、升 3 级要 5 点」。 */
function lvlTextOf(p) {
  const lvl = Math.min(Math.max(p.lvl || 1, 1), 3);
  if (lvl >= 3) return '3级 MAX';
  const need = (typeof EXP_BONUS !== 'undefined' && EXP_BONUS[lvl + 1]) || 2;
  const cur = Math.min(p.exp || 0, need);
  return lvl + '级 ' + cur + '/' + need;
}

/* 队伍里有没有「同名且没满级」的宠物 —— 有的话商店里那只买了就能升级，
 * 卡片上会打一个 ⬆ 角标提醒。 */
function canUpgradeFrom(p, team) {
  if (!p || !team) return false;
  return team.some(function (q) {
    return q && q.defId === p.defId && (q.lvl || 1) < 3;
  });
}

function petCard(p, opts) {
  opts = opts || {};
  const def = p.def || PETS[p.defId] || { name: p.defId, cn: '', tier: 0 };
  const card = el('div', 'pet');
  card.dataset.uid = p.uid;
  card.dataset.side = p.side;
  card.dataset.tier = def.tier || 0;
  if (opts.upgradable) {
    card.classList.add('upgradable');
    card.title = '买下它能给队伍里的同名宠物 +1 经验';
  }

  if (opts.selectable) card.classList.add('selectable');
  if (opts.selected) card.classList.add('selected');
  if (opts.small) card.classList.add('small');
  if (p.hp <= 0) card.classList.add('dead');

  let perkHtml = '';
  for (const pk of (p.perks || [])) {
    if (pk.uses > 0) perkHtml += `<span class="perk" title="${esc(pk.id)}">${PERK_EMOJI[pk.id] || '🎁'}</span>`;
  }

  const skill = skillTextOf(def, p.lvl);

  // 阵营（羁绊）徽章 —— 商店/队伍/回放里的卡片都要能看到它属于哪个阵营，
  // 否则玩家得自己背下来哪只宠物算哪个羁绊。点它有详情（见 showFactionPop）。
  const facId = (typeof factionOf === 'function') ? factionOf(p.defId) : null;
  const facInfo = (facId && typeof factionInfo === 'function') ? factionInfo(facId) : null;
  const facHtml = facInfo
    ? '<span class="pet-faction fac-' + facId + '" data-faction="' + facId + '" title="' +
        esc(facInfo.cn + '｜' + facInfo.desc.join(' → ') + '（点击看详情）') + '">' +
        facInfo.icon + esc(facInfo.cn) + '</span>'
    : '';

  card.innerHTML =
    // 星级只用边框颜色表达（data-tier 驱动 CSS），不显示文字徽章
    '<div class="pet-top">' +
      '<span class="pet-emoji">' + (PET_EMOJI[p.defId] || '🐾') + '</span>' +
      '<span class="pet-lvl">' + esc(lvlTextOf(p)) + '</span>' +
    '</div>' +
    '<div class="pet-name">' + esc(petName(def)) + '</div>' +
    (facHtml ? '<div class="pet-fac-row">' + facHtml + '</div>' : '') +
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
  const c = petCard(p, { upgradable: opts.upgradable });
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

/* ------------------------------------------------------------
 *  待用库存
 *  商店只有 2 个食物位，但像「3 级鸽子库存 3 个免费苹果」这种会多出来。
 *  放不下的会攒在 game.pendingFoods 里、等食物位空出来自动补上。
 *  这里把它显示在食物区下面 —— 不显示的话玩家会以为东西丢了。
 *  ⚠️ 容器是动态插到食物区后面的，所以三个页面都不用改 HTML。
 * ---------------------------------------------------------- */
function renderPendingFoods(foodBox, g) {
  if (typeof document === 'undefined' || !foodBox || !foodBox.parentNode) return;
  let box = document.getElementById('pendingFoods');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pendingFoods';
    box.className = 'pending-foods';
    foodBox.parentNode.insertBefore(box, foodBox.nextSibling);
  }
  const list = (g && g.pendingFoods) || [];
  if (!list.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  const cnt = {};
  for (const f of list) cnt[f.id] = (cnt[f.id] || 0) + 1;
  let h = '<span class="pf-label">🎒 待用</span>';
  for (const id of Object.keys(cnt)) {
    const d = FOODS[id] || {};
    h += '<span class="pf-item" title="' +
         esc((d.cn || id) + ' ×' + cnt[id] + '：商店的食物位一空出来就会自动补上') + '">' +
         (FOOD_EMOJI[id] || '🎁') + ' ' + esc(d.cn || id) + ' ×' + cnt[id] + '</span>';
  }
  box.innerHTML = h;
  box.style.display = '';
}

/* 道具槽 */
function foodSlot(f, g, opts) {  opts = opts || {};  if (!f) return el('div', 'shop-slot empty');
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
  return '<div class="codex-card" data-tier="' + (d.tier || 0) +
      '" data-pet-id="' + esc(id) + '">' +
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

/* 图鉴当前分页。都放一页太长（138 只宠物 + 10 召唤物 + 21 道具 + 13 遗物），
 * 所以拆成几个可点击切换的标签页。 */
let __codexTab = 'turtle';

function codexTabList() {
  const packIds = (typeof PACKS !== 'undefined') ? Object.keys(PACKS) : ['turtle'];
  const tabs = [];
  for (const pk of packIds) {
    const info = (typeof PACKS !== 'undefined' && PACKS[pk]) || { cn: pk, icon: '' };
    tabs.push({ id: 'pack:' + pk, label: info.icon + ' ' + info.cn });
  }
  tabs.push({ id: 'token',   label: '🥚 召唤物' });
  tabs.push({ id: 'food',    label: '🍎 道具' });
  tabs.push({ id: 'relic',   label: '🏺 遗物' });
  tabs.push({ id: 'faction', label: '🧬 羁绊' });
  return tabs;
}

/* 某个分页里有几项（显示在标签上） */
function codexTabCount(tabId) {
  if (typeof PETS === 'undefined') return 0;
  if (tabId.indexOf('pack:') === 0) {
    const pk = tabId.slice(5);
    return Object.keys(PETS).filter(function (k) {
      return !PETS[k].token && PETS[k].tier >= 1 && packOf(k) === pk;
    }).length;
  }
  if (tabId === 'token')   return Object.keys(PETS).filter(function (k) { return PETS[k].token; }).length;
  if (tabId === 'food')    return Object.keys(FOODS).length;
  if (tabId === 'relic')   return (typeof RELIC_IDS !== 'undefined' ? RELIC_IDS : Object.keys(RELICS)).length;
  if (tabId === 'faction') return (typeof FACTIONS !== 'undefined') ? Object.keys(FACTIONS).length : 0;
  return 0;
}

/* 把整个图鉴渲染进 bodyEl，并回填计数到 subEl。
 * 分页切换只重渲染 bodyEl，不关弹层。 */
function renderCodexInto(bodyEl, subEl) {
  if (!bodyEl) return;
  bindCodexTabs();
  const tabs = codexTabList();
  // 选中的分页如果不存在了（比如包被删掉），退回第一个
  if (!tabs.some(function (t) { return t.id === __codexTab; })) __codexTab = tabs[0].id;

  let head = '<div class="codex-tabs">';
  for (const t of tabs) {
    head += '<span class="codex-tab' + (t.id === __codexTab ? ' on' : '') +
            '" data-codex-tab="' + t.id + '">' + esc(t.label) +
            '<i>' + codexTabCount(t.id) + '</i></span>';
  }
  head += '</div>';

  let body = '';
  if (__codexTab.indexOf('pack:') === 0) {
    body = codexPackHtml(__codexTab.slice(5));
  } else if (__codexTab === 'token') {
    const tokens = Object.keys(PETS).filter(function (k) { return PETS[k].token; })
      .sort(function (a, b) { return (PETS[a].cn || a).localeCompare(PETS[b].cn || b, 'zh-CN'); });
    body = '<div class="codex-tier">召唤物 · ' + tokens.length +
           ' 只（只能由技能召唤或变身得到，不会出现在商店）</div><div class="codex-grid">';
    for (const id of tokens) body += codexPetCard(id);
    body += '</div>';
  } else if (__codexTab === 'food') {
    const foods = Object.keys(FOODS).sort(function (a, b) {
      const ta = FOODS[a].token ? 1 : 0, tb = FOODS[b].token ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return (FOODS[a].cn || a).localeCompare(FOODS[b].cn || b, 'zh-CN');
    });
    const shop = foods.filter(function (k) { return !FOODS[k].token; });
    const tok  = foods.filter(function (k) { return FOODS[k].token; });
    if (shop.length) {
      body += '<div class="codex-tier">商店道具 · ' + shop.length +
              ' 种（每只宠物同时只能带 1 个食物标记）</div><div class="codex-grid">';
      for (const id of shop) body += codexFoodCard(id);
      body += '</div>';
    }
    if (tok.length) {
      body += '<div class="codex-tier">只能靠技能获得的道具 · ' + tok.length +
              ' 种</div><div class="codex-grid">';
      for (const id of tok) body += codexFoodCard(id);
      body += '</div>';
    }
  } else if (__codexTab === 'relic') {
    const relicIds = (typeof RELIC_IDS !== 'undefined' ? RELIC_IDS : Object.keys(RELICS));
    const tags = RELIC_TAG_ORDER.concat(
      Object.keys(RELICS).map(function (k) { return RELICS[k].tag; })
        .filter(function (t, i, arr) { return RELIC_TAG_ORDER.indexOf(t) < 0 && arr.indexOf(t) === i; })
    );
    let first = true;
    for (const tag of tags) {
      const arr = relicIds.filter(function (id) { return RELICS[id] && RELICS[id].tag === tag; });
      if (!arr.length) continue;
      body += '<div class="codex-tier">遗物 · ' + esc(tag) + ' · ' + arr.length + ' 件' +
              (first ? '（回合 3/6/9… 三选一，永久生效）' : '') +
              '</div><div class="codex-grid">';
      for (const id of arr) body += codexRelicCard(id);
      body += '</div>';
      first = false;
    }
  } else if (__codexTab === 'faction') {
    body += '<div class="codex-note">⚠️ 官方没有羁绊机制，这是自创的：' +
            '队伍里凑够同一个阵营的【不同】宠物就激活加成。' +
            '「不同」指按宠物种类去重 —— 3 只同名蚂蚁只算 1 只。</div>';
    for (const id of Object.keys(FACTIONS)) {
      body += factionDetailHtml(id, null, true);
    }
  }

  bodyEl.innerHTML = head + '<div class="codex-body">' + body + '</div>';
  if (subEl) {
    const t = tabs.filter(function (x) { return x.id === __codexTab; })[0];
    subEl.textContent = (t ? t.label + ' · ' + codexTabCount(t.id) + ' 项' : '') +
      ' · 点上面的标签切换 · 点空白处或按 Esc 关闭';
  }
}

/* 某一个包的宠物（按星级） */
function codexPackHtml(pk) {
  const mine = Object.keys(PETS).filter(function (k) {
    return !PETS[k].token && PETS[k].tier >= 1 && packOf(k) === pk;
  }).sort(function (a, b) {
    const A = PETS[a], B = PETS[b];
    if (A.tier !== B.tier) return A.tier - B.tier;
    return (A.cn || A.name).localeCompare(B.cn || B.name, 'zh-CN');
  });
  const info = (typeof PACKS !== 'undefined' && PACKS[pk]) || { cn: pk, icon: '' };
  // 这个包里有哪些召唤物（挑出「被这个包的宠物召唤/变身出来」的那些）
  const ownIds = {};
  mine.forEach(function (k) { ownIds[k] = 1; });
  const tokens = Object.keys(PETS).filter(function (k) {
    return PETS[k].token && (PETS[k].pack || 'turtle') === pk;
  });
  let html = '';
  const byTier = {};
  for (const id of mine) (byTier[PETS[id].tier] = byTier[PETS[id].tier] || []).push(id);
  for (const t of Object.keys(byTier).sort(function (a, b) { return a - b; })) {
    html += '<div class="codex-tier">' + (TIER_NAME[t] || 'Tier ' + t) +
            ' · ' + byTier[t].length + ' 只</div><div class="codex-grid">';
    for (const id of byTier[t]) html += codexPetCard(id);
    html += '</div>';
  }
  if (tokens.length) {
    html += '<div class="codex-tier">' + esc(info.cn) + '的召唤物 · ' + tokens.length +
            ' 只</div><div class="codex-grid">';
    for (const id of tokens) html += codexPetCard(id);
    html += '</div>';
  }
  return html;
}

/* 供测试/外部切换分页用（界面上是点标签切，走事件委托） */
function codexSetTab(id) { __codexTab = id; }
function codexGetTab() { return __codexTab; }

/* 图鉴分页标签的点击（全局委托，重新渲染也不会丢） */
let __codexTabBound = false;
function bindCodexTabs() {
  if (__codexTabBound || typeof document === 'undefined' || !document.addEventListener) return;
  __codexTabBound = true;
  document.addEventListener('click', function (ev) {
    let n = ev.target;
    while (n && n.getAttribute) {
      const t = n.getAttribute('data-codex-tab');
      if (t) {
        __codexTab = t;
        // 只重渲染图鉴内容，弹层保持打开（三个页面都用 #codexBody / #codexSub）
        const bodyEl = document.getElementById('codexBody');
        if (bodyEl) renderCodexInto(bodyEl, document.getElementById('codexSub'));
        ev.stopPropagation();
        return;
      }
      n = n.parentNode;
    }
  });
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
