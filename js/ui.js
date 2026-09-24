'use strict';
/* ============================================================
 *  ui.js — 单人模式（solo.html）的界面渲染与交互
 *
 *  关键点：战斗不是「一次性算出结果」，而是拿引擎给的事件日志
 *  逐条播放。这样动画、血条、召唤都能自然发生，而且天然支持回放。
 *
 *  公共渲染函数（petCard / esc / $ / el / say / PET_EMOJI …）
 *  已抽到 render.js，本文件只保留单人模式专属逻辑。
 * ============================================================ */

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
 *  单人模式专属：商店渲染
 *  （$ / el / esc / say / petCard / skillTextOf 均来自 render.js）
 * ---------------------------------------------------------- */

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
  renderRelics();
}

/* ---- 遗物：已获得的图标条 + 到点的三选一弹窗 ---- */
function renderRelics() {
  const g = UI.game;
  if (!g) return;
  renderRelicBar($('#relicBar'), g.relics);
  renderSynergyBar($('#synergyBar'), g.team);
  const pend = g.pendingRelicChoice;
  const box = $('#relicPick');
  if (!box) return;
  if (pend && pend.length) {
    renderRelicChoices($('#relicChoices'), pend);
    box.style.display = 'flex';
  } else {
    box.style.display = 'none';
  }
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
  // 有选中时给整行加标记：CSS 会把空位和其他宠物标成「可放置目标」
  row.classList.toggle('picking', UI.selectedTeam >= 0);
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
      const s = el('div', 'pet slot-empty',
        '<span>' + (UI.selectedTeam >= 0 ? '放这里' : '空位') + '</span>');
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
    // ⚠️ 这里以前是经典模式【自己手写】的一份商店卡片，价格硬编码成「3 金」——
    //    抽到遗物「批发商」（宠物便宜 1 金）时，界面显示 3 金、实际只收 2 金，
    //    玩家会以为扣错了钱。现在统一复用 shopPetSlot()，价格走 petCostOf(defId, g)。
    const cost = petCostOf(p.defId, g);
    sr.appendChild(shopPetSlot(p, {
      frozen: g.frozenPets[i],
      slotAttr: 'shopPet', slotIndex: i,
      freezeAttr: 'freezePet',
      cost: cost, affordable: g.gold >= cost,
      draggable: true,
      upgradable: canUpgradeFrom(p, g.team)
    }));
  }

  // ---- 商店食物 ----
  const fr = $('#shopFoods');
  fr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    // ⚠️ 这里以前是经典模式【自己手写】的一份食物渲染，emoji 写成了
    //    「不是苹果、不是蜂蜜的统统 🍉」—— 结果西瓜/辣椒/花生/椰子/牛奶/
    //    安眠药 全都显示成西瓜。现在统一复用 render.js 的 foodSlot()，
    //    三种模式同一份实现，emoji 表也只有一份。
    fr.appendChild(foodSlot(g.shopFoods[i], g, {
      frozen: g.frozenFoods[i],
      selected: UI.game.pendingFood === i,
      slotAttr: 'shopFood', slotIndex: i,
      freezeAttr: 'freezeFood'
    }));
  }
  renderPendingFoods(fr, g);

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
    $('#hint').textContent = teamHintText();
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
    if (UI.seedInfo && UI.seedInfo.daily) recordDailyOnce(g);
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

/* 每日挑战：一局结束时记成绩（同一局只记一次） */
function recordDailyOnce(g) {
  if (UI.dailyRecorded) return true;
  UI.dailyRecorded = true;
  const rec = dailySave(UI.seedInfo.dateKey, g.wins, g.losses, g.wins >= CFG.WIN_TARGET);
  const box = $('#seedNote');
  if (box) box.textContent = dailyNoteText(rec);
  return true;
}

/* ------------------------------------------------------------
 *  事件绑定
 * ---------------------------------------------------------- */
function bind() {
  const root = $('#app');

  root.addEventListener('click', function (e) {
    const g = UI.game;

    // 选遗物（三选一弹窗）
    const ro = e.target.closest('[data-relic]');
    if (ro) {
      const r = g.pickRelic(ro.dataset.relic);
      say(r.msg);
      renderTop(); renderShop();
      return;
    }
    // 弹窗打开时，屏蔽其他点击
    if ($('#relicPick') && $('#relicPick').style.display === 'flex') return;

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
    if (e.target.closest('#btnCodex')) { openCodexPanel(); return; }
    if (e.target.closest('#btnCodexClose')) { closeCodexPanel(); return; }
    if (e.target.closest('#codex') && !e.target.closest('.codex-panel')) { closeCodexPanel(); return; }

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
      if (g.pendingRelicChoice && g.pendingRelicChoice.length) { say('先选一件遗物'); return; }
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

    // 点击队伍格子（宠物或空位）—— 语义见 render.js 的 teamTapAction
    const tp = e.target.closest('#myRow [data-team-idx]');
    if (tp) {
      const i = +tp.dataset.teamIdx;
      const a = teamTapAction(
        { sel: UI.selectedTeam, pendingFood: g.pendingFood != null },
        i, g.team.length);

      if (a.act === 'food') {
        const r = g.applyFood(i);
        say(r.msg);
        renderTop(); renderShop();
      } else if (a.act === 'sell') {
        const r = g.sellPet(i);
        say(r.msg);
        UI.selectedTeam = -1;
        renderTop(); renderShop();
      } else if (a.act === 'move') {
        g.movePet(a.from, a.to);
        say('调整了站位');
        UI.selectedTeam = -1;
        renderShop();
      } else if (a.act === 'select') {
        UI.selectedTeam = i;
        renderShop();
      } else {
        UI.selectedTeam = -1;      // 空位且没选中 → 取消选择
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
 *  图鉴（宠物 / 召唤物 / 道具 / 遗物）
 *  实际渲染在 render.js 的 renderCodexInto()，两种模式共用
 * ---------------------------------------------------------- */

function renderCodex() {
  renderCodexInto($('#codexBody'), $('#codexSub'));
}

function openCodexPanel() { openCodex('#codex', '#codexBody'); }
function closeCodexPanel() { closeCodex('#codex'); }

/* ------------------------------------------------------------
 *  启动
 * ---------------------------------------------------------- */
function boot() {
  // ⚠️ 种子必须在 new Game() 之前设好 —— 否则第一次 rollShop 已经用掉真随机了
  UI.seedInfo = initSeed();
  UI.dailyRecorded = false;

  UI.game = new Game();
  bind();
  renderSeed();
  // Esc 关闭图鉴（未打开时调用无副作用）
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCodexPanel();
  });
  renderTop();
  renderShop();

  if (UI.seedInfo.daily) {
    const rec = dailyRecord(UI.seedInfo.dateKey);
    say('📅 每日挑战 ' + UI.seedInfo.dateKey.replace('daily-', '') + ' —— 大家玩的是同一局！');
    if (rec.plays) say('今天第 ' + (rec.plays + 1) + ' 局 · ' + dailyNoteText(rec));
  } else {
    say('欢迎！买几只宠物，然后结束回合开打。');
  }
}

/* 顶部种子栏 + 复制/换种子 */
function renderSeed() {
  const info = UI.seedInfo;
  const note = info.daily ? dailyNoteText(dailyRecord(info.dateKey)) : '';
  renderSeedBar($('#seedBar'), info, note);
  bindSeedBar($('#seedBar'), info);
}

/* 兼容两种加载时机：脚本在 body 末尾时 DOMContentLoaded 通常还没触发，
 * 但若将来改成 defer/动态注入，则直接启动 */
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
