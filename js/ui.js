'use strict';
/* ============================================================
 *  ui.js — 界面渲染与交互
 *
 *  关键点：战斗不是「一次性算出结果」，而是拿引擎给的事件日志
 *  逐条播放。这样动画、血条、召唤都能自然发生，而且天然支持回放。
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

const UI = {
  game: null,
  view: null,       // 战斗中展示用的镜像状态
  log: [],
  idx: 0,
  timer: null,
  speedMul: 1,        // 播放倍率：0.5 / 1 / 2 / 4（基础每帧 420ms）
  selectedTeam: -1,
  message: '',
  msgTimer: null
};

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
function say(msg) {
  UI.message = msg;
  const box = $('#message');
  if (box) {
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(UI.msgTimer);
    UI.msgTimer = setTimeout(function () { box.classList.remove('show'); }, 2200);
  }
}

/* ------------------------------------------------------------
 *  宠物卡片
 * ---------------------------------------------------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

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
  if (p.hp <= 0) card.classList.add('dead');

  let perkHtml = '';
  for (const pk of (p.perks || [])) {
    if (pk.uses > 0) perkHtml += `<span class="perk" title="${pk.id}">${PERK_EMOJI[pk.id] || '🎁'}</span>`;
  }

  const skill = skillTextOf(def, p.lvl);

  card.innerHTML =
    // 星级只用边框颜色表达（data-tier 驱动 CSS），不再显示文字徽章
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

/* ------------------------------------------------------------
 *  顶栏
 * ---------------------------------------------------------- */
function renderTop() {
  const g = UI.game;
  $('#turnNum').textContent = g.turn;
  $('#goldNum').textContent = g.gold;
  $('#winNum').textContent = g.wins;
  $('#loseNum').textContent = g.losses;
  $('#goalWins').textContent = CFG.WIN_TARGET;
  $('#goalLoses').textContent = CFG.LOSE_MAX;
}

/* ------------------------------------------------------------
 *  商店阶段渲染
 * ---------------------------------------------------------- */
function renderShop() {
  const g = UI.game;

  // 商店等级（官方规则：按回合解锁，每 2 回合一级）
  const st = g.getShopTier();
  const badge = $('#shopTierBadge');
  if (badge) badge.textContent = '等级 ' + st + '（T1–T' + st + '）';

  // ---- 我的队伍（槽位数跟随本回合上限 3/4/5）----
  const row = $('#myRow');
  row.innerHTML = '';
  const teamMax = g.getTeamMax();
  for (let i = 0; i < teamMax; i++) {
    const p = g.team[i];
    if (p) {
      const c = petCard(p, {
        selectable: true,
        selected: UI.selectedTeam === i
      });
      c.dataset.teamIdx = i;
      c.draggable = true;
      row.appendChild(c);
    } else {
      const s = el('div', 'pet slot-empty', '<span>空位</span>');
      s.dataset.teamIdx = i;
      row.appendChild(s);
    }
  }

  // ---- 商店宠物 ----
  const sr = $('#shopPets');
  sr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_PET_SLOTS; i++) {
    const p = g.shopPets[i];
    if (!p) { sr.appendChild(el('div', 'shop-slot empty')); continue; }
    const wrap = el('div', 'shop-slot');
    if (g.frozenPets[i]) wrap.classList.add('frozen');
    const c = petCard(p);
    c.dataset.shopPet = i;
    c.draggable = true;          // 可拖到队伍指定位置购买
    wrap.appendChild(c);
    wrap.appendChild(el('div', 'price', g.gold >= CFG.PET_COST ? '3 金' : '<span class="no">3 金</span>'));
    const fz = el('button', 'freeze', g.frozenPets[i] ? '❄ 已冻结' : '❄ 冻结');
    fz.dataset.freezePet = i;
    wrap.appendChild(fz);
    sr.appendChild(wrap);
  }

  // ---- 商店食物 ----
  const fr = $('#shopFoods');
  fr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    const f = g.shopFoods[i];
    if (!f) { fr.appendChild(el('div', 'shop-slot empty')); continue; }
    const d = FOODS[f.id];
    const wrap = el('div', 'shop-slot food');
    if (g.frozenFoods[i]) wrap.classList.add('frozen');
    if (UI.game.pendingFood === i) wrap.classList.add('selected');
    wrap.innerHTML =
      '<div class="food-emoji">' + (f.id === 'Apple' || f.id === 'BetterApple' || f.id === 'BestApple' ? '🍎' : f.id === 'Honey' ? '🍯' : '🍉') + '</div>' +
      '<div class="food-name">' + d.cn + '</div>' +
      '<div class="food-text">' + d.text + '</div>';
    wrap.dataset.shopFood = i;
    // 价格读实际值（虫子的「2 金苹果」、鸽子的免费苹果都在这里体现）
    const fc = g.foodCost(f);
    wrap.appendChild(el('div', 'price', fc === 0
      ? '<span class="free">免费</span>'
      : (g.gold >= fc ? fc + ' 金' : '<span class="no">' + fc + ' 金</span>')));
    const fz = el('button', 'freeze', g.frozenFoods[i] ? '❄ 已冻结' : '❄ 冻结');
    fz.dataset.freezeFood = i;
    wrap.appendChild(fz);
    fr.appendChild(wrap);
  }

  // ---- 按钮状态 ----
  $('#btnRoll').textContent = '🎲 刷新（1 金）';
  $('#btnRoll').disabled = g.gold < CFG.ROLL_COST;
  $('#btnEnd').textContent = '⚔️ 结束回合，开打！';
  $('#btnEnd').disabled = g.team.length === 0;

  // ---- 本回合技能汇总（方案 B：汇总成一条）----
  const notesBox = $('#shopNotes');  const notes = g.shopNotes || [];
  if (notes.length) {
    notesBox.style.display = '';
    notesBox.innerHTML = '<span class="notes-label">⚡ 技能</span>' + esc(notes.join(' · '));
  } else {
    notesBox.style.display = 'none';
  }

  // 提示
  if (UI.game.pendingFood != null) {
    $('#hint').textContent = '👉 请点击一只宠物来使用「' + FOODS[g.shopFoods[UI.game.pendingFood].id].cn + '」';
    $('#hint').classList.add('active');
  } else {
    $('#hint').textContent = '点击商店宠物购买 · 也可把商店宠物拖到队伍的指定位置 · 点两次出售 · 拖动调整顺序';
    $('#hint').classList.remove('active');
  }

  $('#foeRow').style.display = 'none';
  $('#shop').style.display = '';
  $('#battlePanel').style.display = 'none';
  $('#myRowWrap').style.display = '';
}

/* ------------------------------------------------------------
 *  战斗渲染
 * ---------------------------------------------------------- */
function cloneForView(p, side) {
  return { uid: p.uid, defId: p.defId, def: p.def, lvl: p.lvl, atk: p.atk, hp: p.hp,
           perks: (p.perks || []).map(function (x) { return { id: x.id, uses: x.uses }; }), side: side };
}

function renderBattleBoard(highlightUids, label) {
  const v = UI.view;
  if (!v) return;

  const foe = $('#foeRow');
  foe.innerHTML = '';
  foe.style.display = '';
  foe.appendChild(el('div', 'row-label', '对手 ' + (v.opponentName || '')));
  const foeInner = el('div', 'pet-row');
  for (const p of v[1]) {
    const c = petCard(p);
    if (highlightUids && highlightUids.indexOf(p.uid) >= 0) c.classList.add('acting');
    foeInner.appendChild(c);
  }
  foe.appendChild(foeInner);

  const my = $('#myBattleRow');
  my.innerHTML = '';
  for (const p of v[0]) {
    const c = petCard(p);
    if (highlightUids && highlightUids.indexOf(p.uid) >= 0) c.classList.add('acting');
    my.appendChild(c);
  }

  if (label != null) $('#battleLabel').textContent = label;
  $('#shop').style.display = 'none';
  $('#myRowWrap').style.display = 'none';
  $('#battlePanel').style.display = '';
}

function startBattle(result) {
  UI.log = result.log;
  UI.idx = 0;
  UI.view = {
    0: UI.game.team.map(function (p) { return cloneForView(p, 0); }),
    1: result.opponent.map(function (p) { return cloneForView(p, 1); }),
    opponentName: ''
  };
  $('#battlePanel').style.display = '';
  renderBattleBoard(null, '准备开战…');
  $('#btnSkip').style.display = '';
  $('#btnNext').style.display = 'none';
  stepBattle();
}

function findView(uid) {
  const v = UI.view;
  for (const s of [0, 1]) {
    for (const p of v[s]) if (p.uid === uid) return { pet: p, side: s };
  }
  return null;
}

function stepBattle() {
  const v = UI.view;
  if (!v) return;

  // 先把「上一帧标记阵亡」的宠物真正移出视图。
  // 延迟一帧既让玩家看到死亡瞬间，又保证 summon 事件的 pos
  // 与引擎侧（尸体已移除）的位置一致，否则召唤会插错位置。
  for (const s of [0, 1]) {
    v[s] = v[s].filter(function (p) { return !p._dead; });
  }

  if (UI.idx >= UI.log.length) { finishBattle(); return; }
  const ev = UI.log[UI.idx++];
  let hi = null, label = null;

  switch (ev.e) {
    case 'battleStart':
      label = '开战！';
      break;

    case 'phase':
      label = '第 ' + ev.n + ' 回合';
      break;

    case 'ability': {
      const hit = findView(ev.t);
      if (hit) { hi = [ev.t]; label = petName(hit.pet.def) + ' 触发技能'; }
      break;
    }

    case 'attack': {
      const A = findView(ev.a), B = findView(ev.b);
      if (A) A.pet.hp -= ev.dmgA;
      if (B) B.pet.hp -= ev.dmgB;
      hi = [ev.a, ev.b];
      label = (A ? petName(A.pet.def) : '?') + ' ⚔ ' + (B ? petName(B.pet.def) : '?');
      break;
    }

    case 'dmg': {
      const t = findView(ev.t);
      if (t) { t.pet.hp -= ev.n; hi = [ev.t]; label = petName(t.pet.def) + ' 受到 ' + ev.n + ' 点伤害'; }
      break;
    }

    case 'buff': {
      const t = findView(ev.t);
      if (t) {
        t.pet.atk += ev.atk; t.pet.hp += ev.hp;
        hi = [ev.t];
        label = petName(t.pet.def) + ' 获得 +' + ev.atk + '/+' + ev.hp;
      }
      break;
    }

    case 'perk': {
      const t = findView(ev.t);
      // 覆盖语义：Perk 只能带一个
      if (t) { t.pet.perks = [{ id: ev.id, uses: 1 }]; hi = [ev.t]; label = petName(t.pet.def) + ' 获得' + ev.id; }
      break;
    }

    case 'perkUsed': {
      const t = findView(ev.t);
      if (t) {
        const pk = t.pet.perks.find(function (x) { return x.id === ev.id; });
        if (pk) pk.uses--;
        hi = [ev.t];
        label = petName(t.pet.def) + ' 消耗了 ' + ev.id;
      }
      break;
    }

    case 'faint': {
      const t = findView(ev.t);
      if (t) { t.pet.hp = 0; t.pet._dead = true; hi = [ev.t]; label = petName(t.pet.def) + ' 阵亡'; }
      break;
    }

    case 'summon': {
      const np = { uid: ev.t, defId: ev.defId, def: PETS[ev.defId], lvl: ev.lvl || 1,
                   atk: ev.atk, hp: ev.hp, perks: [], side: ev.side };
      v[ev.side].splice(ev.pos, 0, np);
      hi = [ev.t];
      label = '召唤了 ' + petName(PETS[ev.defId]);
      break;
    }

    case 'battleEnd':
      UI.idx = UI.log.length;   // 跳到结束
      finishBattle(ev.winner);
      return;
  }

  // 移除阵亡的（保留一帧让玩家看到）
  renderBattleBoard(hi, label);

  const base = 420 / (UI.speedMul || 1);
  const delay = (ev.e === 'phase') ? base * 1.6 : base;
  UI.timer = setTimeout(stepBattle, delay);
}

function finishBattle(winner) {
  const g = UI.game;
  if (winner === undefined) winner = g.lastResult.winner;
  const v = UI.view;

  // 清掉残留尸体，最终画面只显示存活者（与引擎的最终队伍一致）
  if (v) {
    for (const s of [0, 1]) {
      v[s] = v[s].filter(function (p) { return !p._dead; });
    }
  }

  // 同步最终血量显示
  if (v) {
    for (const s of [0, 1]) {
      for (const p of v[s]) if (p.hp < 0) p.hp = 0;
    }
    renderBattleBoard(null, '战斗结束');
  }

  let title, cls;
  if (winner === 0)      { title = '🎉 胜利！'; cls = 'win'; }
  else if (winner === 1) { title = '💀 失败…'; cls = 'lose'; }
  else                   { title = '🤝 平局'; cls = 'draw'; }

  $('#battleLabel').textContent = title;
  $('#battleLabel').className = 'battle-label ' + cls;
  $('#btnSkip').style.display = 'none';

  if (g.phase === 'gameover') {
    $('#btnNext').style.display = '';
    $('#btnNext').textContent = (g.wins >= CFG.WIN_TARGET)
      ? '🏆 ' + g.wins + ' 胜达成 —— 再来一局'
      : '☠️ ' + g.losses + ' 败 —— 再来一局';
    $('#btnNext').dataset.restart = '1';
  } else {
    $('#btnNext').style.display = '';
    $('#btnNext').textContent = '➡️ 进入第 ' + (g.turn + 1) + ' 回合';
    $('#btnNext').dataset.restart = '';
  }
}

/* ------------------------------------------------------------
 *  事件绑定
 * ---------------------------------------------------------- */
function bind() {
  const root = $('#app');

  root.addEventListener('click', function (e) {
    const g = UI.game;

    // 战斗播放速度
    const spd = e.target.closest('.spd');
    if (spd) {
      UI.speedMul = parseFloat(spd.dataset.speed) || 1;
      const all = document.querySelectorAll('.spd');
      for (let i = 0; i < all.length; i++) {
        all[i].classList.toggle('active', all[i] === spd);
      }
      return;
    }

    // 图鉴：打开 / 关闭 / 点遮罩关闭（面板内点击不关）
    if (e.target.closest('#btnCodex')) { openCodex(); return; }
    if (e.target.closest('#btnCodexClose')) { closeCodex(); return; }
    if (e.target.closest('#codex') && !e.target.closest('.codex-panel')) { closeCodex(); return; }

    // 刷新
    if (e.target.closest('#btnRoll')) {
      const r = g.roll();
      say(r.msg);
      renderTop(); renderShop();
      return;
    }

    // 结束回合
    if (e.target.closest('#btnEnd')) {
      if (g.pendingFood != null) { say('先选一只宠物用掉道具'); return; }
      const r = g.endTurn();
      if (!r.ok) { say(r.msg); return; }
      renderTop();
      startBattle(r.result);
      return;
    }

    // 跳过战斗动画
    if (e.target.closest('#btnSkip')) {
      clearTimeout(UI.timer);
      // 直接把剩余事件全部应用
      while (UI.idx < UI.log.length) {
        const ev = UI.log[UI.idx++];
        if (ev.e === 'battleEnd') break;
        applyEventSilent(ev);
      }
      finishBattle();
      return;
    }

    // 下一回合 / 重开
    if (e.target.closest('#btnNext')) {
      const btn = e.target.closest('#btnNext');
      if (btn.dataset.restart === '1') {
        UI.game.reset();
        UI.selectedTeam = -1;
        renderTop(); renderShop(); renderTop();
        say('新的一局开始了！');
      } else {
        g.nextTurn();
        UI.selectedTeam = -1;
        renderTop(); renderShop();
        say('第 ' + g.turn + ' 回合开始');
      }
      return;
    }

    // 冻结宠物
    const fp = e.target.closest('[data-freeze-pet]');
    if (fp) { g.toggleFreezePet(+fp.dataset.freezePet); renderShop(); return; }

    // 冻结食物
    const ff = e.target.closest('[data-freeze-food]');
    if (ff) { g.toggleFreezeFood(+ff.dataset.freezeFood); renderShop(); return; }

    // 购买食物
    const sf = e.target.closest('[data-shop-food]');
    if (sf) {
      const r = g.buyFood(+sf.dataset.shopFood);
      say(r.msg);
      renderTop(); renderShop();
      return;
    }

    // 点击商店宠物 → 购买
    const sp = e.target.closest('[data-shop-pet]');
    if (sp) {
      const r = g.buyPet(+sp.dataset.shopPet);
      say(r.msg);
      renderTop(); renderShop();
      return;
    }

    // 点击队伍宠物
    const tp = e.target.closest('#myRow .pet');
    if (tp) {
      const i = +tp.dataset.teamIdx;

      // 有待用食物 → 使用
      if (g.pendingFood != null) {
        const r = g.applyFood(i);
        say(r.msg);
        renderTop(); renderShop();
        return;
      }

      // 点同一只两次 → 出售
      if (UI.selectedTeam === i) {
        const r = g.sellPet(i);
        say(r.msg);
        UI.selectedTeam = -1;
        renderTop(); renderShop();
      } else {
        UI.selectedTeam = i;
        renderShop();
      }
      return;
    }

    // 点空白处取消选择
    if (UI.selectedTeam >= 0 && !e.target.closest('#myRow')) {
      UI.selectedTeam = -1;
      renderShop();
    }
  });

  // 拖拽：队伍内排序 + 从商店拖到指定位置购买
  let dragTeamFrom = -1;    // 队伍内拖动
  let dragShopFrom = -1;    // 从商店拖出

  root.addEventListener('dragstart', function (e) {
    const shopCard = e.target.closest('[data-shop-pet]');
    if (shopCard) {
      dragShopFrom = +shopCard.dataset.shopPet;
      shopCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      return;
    }
    const c = e.target.closest('#myRow .pet');
    if (!c) return;
    dragTeamFrom = +c.dataset.teamIdx;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  root.addEventListener('dragend', function (e) {
    const c = e.target.closest('.dragging');
    if (c) c.classList.remove('dragging');
  });

  root.addEventListener('dragover', function (e) {
    if (dragShopFrom >= 0 ? e.target.closest('#myRow') : e.target.closest('#myRow')) {
      e.preventDefault();
      if (dragShopFrom >= 0) e.dataTransfer.dropEffect = 'copy';
    }
  });

  root.addEventListener('drop', function (e) {
    const c = e.target.closest('#myRow [data-team-idx]');
    if (!c) return;
    e.preventDefault();
    const to = +c.dataset.teamIdx;

    if (dragShopFrom >= 0) {
      // 从商店拖到队伍的指定位置 → 买下并插到该位置
      const r = UI.game.buyPet(dragShopFrom, to);
      say(r.msg);
    } else if (dragTeamFrom >= 0) {
      UI.game.movePet(dragTeamFrom, to);
    } else {
      return;
    }
    dragTeamFrom = -1;
    dragShopFrom = -1;
    UI.selectedTeam = -1;
    renderTop(); renderShop();
  });
}

/* 把事件静默应用到视图（用于「跳过」） */
function applyEventSilent(ev) {
  const v = UI.view;
  if (!v) return;
  switch (ev.e) {
    case 'attack': {
      const A = findView(ev.a), B = findView(ev.b);
      if (A) A.pet.hp -= ev.dmgA;
      if (B) B.pet.hp -= ev.dmgB;
      break;
    }
    case 'dmg': { const t = findView(ev.t); if (t) t.pet.hp -= ev.n; break; }
    case 'buff': { const t = findView(ev.t); if (t) { t.pet.atk += ev.atk; t.pet.hp += ev.hp; } break; }
    case 'perk': { const t = findView(ev.t); if (t) t.pet.perks = [{ id: ev.id, uses: 1 }]; break; }
    case 'faint': { const t = findView(ev.t); if (t) t.pet.hp = 0; break; }
    case 'summon': {
      v[ev.side].splice(ev.pos, 0, { uid: ev.t, defId: ev.defId, def: PETS[ev.defId],
        lvl: ev.lvl || 1, atk: ev.atk, hp: ev.hp, perks: [], side: ev.side });
      break;
    }
  }
}

/* ------------------------------------------------------------
 *  宠物图鉴
 * ---------------------------------------------------------- */
const TIER_NAME = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4', 5: 'Tier 5', 6: 'Tier 6' };

/* 列出可购买的宠物（排除召唤物），按 tier → 名字排序 */
function codexEntries() {
  const ids = Object.keys(PETS).filter(function (k) {
    const d = PETS[k];
    return !d.token && d.tier >= 1;
  });
  ids.sort(function (a, b) {
    const A = PETS[a], B = PETS[b];
    if (A.tier !== B.tier) return A.tier - B.tier;
    return (A.cn || A.name).localeCompare(B.cn || B.name, 'zh-CN');
  });
  return ids;
}

/* ---- 图鉴：宠物卡片 ---- */
function codexPetCard(id) {
  const d = PETS[id];
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

/* ---- 图鉴：道具卡片 ---- */
const FOOD_EMOJI = {
  Apple: '🍎', BetterApple: '🍎', BestApple: '🍎',
  Honey: '🍯', Melon: '🍉', BreadCrumbs: '🍞'
};

function codexFoodCard(id) {
  const f = FOODS[id];
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

function renderCodex() {
  const body = $('#codexBody');
  if (!body) return;

  let html = '';
  let nPet = 0, nToken = 0, nFood = 0;

  // ---- 可购买宠物：按星级分组 ----
  const ids = codexEntries();
  const byTier = {};
  for (const id of ids) {
    const t = PETS[id].tier;
    (byTier[t] = byTier[t] || []).push(id);
  }
  for (const t of Object.keys(byTier).sort(function (a, b) { return a - b; })) {
    html += '<div class="codex-tier">' + (TIER_NAME[t] || 'Tier ' + t) +
            ' · ' + byTier[t].length + ' 只</div><div class="codex-grid">';
    for (const id of byTier[t]) html += codexPetCard(id);
    html += '</div>';
    nPet += byTier[t].length;
  }

  // ---- 召唤物 ----
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

  // ---- 道具 ----
  const foods = Object.keys(FOODS).sort(function (a, b) {
    const ta = FOODS[a].token ? 1 : 0, tb = FOODS[b].token ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return (FOODS[a].cn || a).localeCompare(FOODS[b].cn || b, 'zh-CN');
  });
  if (foods.length) {
    html += '<div class="codex-tier">道具 · ' + foods.length + ' 种</div><div class="codex-grid">';
    for (const id of foods) html += codexFoodCard(id);
    html += '</div>';
    nFood = foods.length;
  }

  body.innerHTML = html;
  $('#codexSub').textContent =
    '宠物 ' + nPet + ' 只 · 召唤物 ' + nToken + ' 只 · 道具 ' + nFood + ' 种 · 点空白处或按 Esc 关闭';
}

function openCodex() {
  renderCodex();
  $('#codex').style.display = 'flex';
}
function closeCodex() {
  $('#codex').style.display = 'none';
}

/* ------------------------------------------------------------
 *  启动
 * ---------------------------------------------------------- */
function boot() {
  UI.game = new Game();
  bind();
  // Esc 关闭图鉴（未打开时调用无副作用）
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCodex();
  });
  renderTop();
  renderShop();
  say('欢迎！买几只宠物，然后结束回合开打。');
}

/* 兼容两种加载时机：脚本在 body 末尾时 DOMContentLoaded 通常还没触发，
 * 但若将来改成 defer/动态注入，则直接启动 */
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
