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

  /* 出售区高亮：选中了某只宠物时提示「点这里就能卖」 */
  const sellZ = $('#sellZone');
  if (sellZ) sellZ.classList.toggle('armed', UI.selectedTeam >= 0);

  /* ⚠️ 这里【不要】再去隐藏 #foeRow。
   *    它本来就在 #battlePanel 里面，隐藏 battlePanel 就够了。
   *    以前多写了这一行，于是回放时必须再补一句「把 display 清掉」，
   *    否则对手行永远不显示 —— 典型的补丁打补丁，现在两边都删了。 */
  $('#shop').style.display = '';
  $('#battlePanel').style.display = 'none';
  $('#myRowWrap').style.display = '';
}

/* ------------------------------------------------------------
 *  战斗回放
 *
 *  ⚠️ 这里以前自己写了一整套（cloneForView / renderBattleBoard / findView /
 *     stepBattle / applyEventSilent / finishBattle），和 playback.js 的
 *     BattlePlayer 是【同一个功能两份实现】，而且已经分叉了：
 *       经典模式少处理 transform / push / perkLost / perkUsed 四种事件，
 *       于是仙犰狳变形、鲸鱼推位、草莓被消费这些画面完全不动
 *       （引擎侧是对的，纯粹是画面不同步）。
 *     现在删掉自己那套，四种界面（经典/混战/联机/排行榜挑战）共用 playback.js。
 *
 *  状态依旧托管在 UI 上（UI.view / log / idx / timer），外面照旧能查回放进度。
 *  ⚠️ 但 view 的结构变了：以前是 v[0]/v[1] 两个数组，现在是 { mine, foe }
 *     （和混战 MUI、联机 OUI 一致）。读它的地方要跟着改。
 * ---------------------------------------------------------- */
const PLAY = new BattlePlayer({
  foe: '#foeRow', mine: '#myBattleRow', label: '#battleLabel',
  skip: '#btnSkip', next: '#btnNext',
  shopView: '#shop', battleView: '#battlePanel',
  arena: '#battlePanel .arena',        // 交战时中间的 ⚔ 会闪
  speedMul: function () { return UI.speedMul; },
  onFinish: afterBattle
});

function startBattle(result) {
  /* ⚠️ #myRowWrap 不在 #battlePanel 里，回放器管不到它，得自己隐藏；
   *    商店阶段由 renderShop() 恢复显示。 */
  const mw = $('#myRowWrap');
  if (mw) mw.style.display = 'none';
  PLAY.start(UI, result.log, UI.game.team, result.opponent,
    '准备开战…', { mySide: 0, winner: result.winner });
}

/* 回放播完之后 —— 这里只做【经典模式特有】的收尾。
 * 尸体清理、按钮显隐、竞技场状态、跳过按钮的隐藏都由回放器自己处理了。 */
function afterBattle(winner) {
  const g = UI.game;
  if (winner === undefined) winner = g.lastResult.winner;

  /* 胜负文案保持经典模式原来的说法（「胜利！」而不是回放器的「这一场赢了！」）——
   * 这次是重构，不该顺带改玩家看得见的文案。 */
  let title, cls;
  if (winner === 0)      { title = '🎉 胜利！'; cls = 'win'; }
  else if (winner === 1) { title = '💀 失败…'; cls = 'lose'; }
  else                   { title = '🤝 平局'; cls = 'draw'; }
  const lb = $('#battleLabel');
  if (lb) { lb.textContent = title; lb.className = 'battle-label ' + cls; }

  if (g.phase === 'gameover') {
    if (UI.seedInfo && UI.seedInfo.daily) recordDailyOnce(g);
    $('#btnNext').style.display = '';
    $('#btnNext').textContent = (g.wins >= CFG.WIN_TARGET)
      ? '🏆 ' + g.wins + ' 胜达成 —— 再来一局'
      : '☠️ ' + g.losses + ' 败 —— 再来一局';
    $('#btnNext').dataset.restart = '1';
    /* 通关了就给一次挑战排行榜的机会（失败出局不给） */
    if (g.wins >= CFG.WIN_TARGET) offerBoardChallenge(g);
  } else {
    $('#btnNext').style.display = '';
    $('#btnNext').textContent = '➡️ 进入第 ' + (g.turn + 1) + ' 回合';
    $('#btnNext').dataset.restart = '';
  }
}

/* 通关 → 问玩家要不要挑战排行榜
 * ⚠️ 用 UI.boardOffered 去重：gameover 之后界面会反复重绘，
 *    不加这个标记会弹出好几次。 */
function offerBoardChallenge(g) {
  if (UI.boardOffered) return;
  if (typeof boardOfferChallenge !== 'function') return;   // 没加载排行榜脚本就跳过
  UI.boardOffered = true;

  const isDaily = !!(UI.seedInfo && UI.seedInfo.daily);
  const mode = isDaily ? 'daily' : 'classic';
  const dateKey = isDaily ? UI.seedInfo.dateKey : null;

  /* ⚠️ 用【对象】传参：要带的东西越来越多（模式/阵容/遗物/成绩/日期/宠物包），
   *    位置参数太容易传错顺序，而传错的后果是「默默记到别的榜上」。
   *    传进去的是活引用，boardOfferChallenge 会立刻拍成纯数据快照 —
   *    所以这里不需要自己先复制一份。 */
  boardOfferChallenge({
    mode: mode,
    team: g.team,                                  // 通关时的这套阵容
    relics: g.relics || [],                        // 遗物也一起带上
    score: boardScoreOf(mode, g),
    dateKey: dateKey,
    pack: (typeof activePack === 'function') ? activePack() : 'turtle',
    onDone: function () { /* 挑战结束（上榜或放弃），界面保持原样即可 */ }
  });
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
    if (e.target.closest('#btnBoard')) {
      /* 每日挑战看每日榜，普通局看经典榜；榜按宠物包分开，所以包要一起传 */
      const isDaily = !!(UI.seedInfo && UI.seedInfo.daily);
      boardOpen(isDaily ? 'daily' : 'classic',
                isDaily ? UI.seedInfo.dateKey : null,
                (typeof activePack === 'function') ? activePack() : 'turtle');
      return;
    }
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

    // 跳过战斗动画（回放器自己会 clearTimeout + 把剩余事件应用 + 收尾）
    if (e.target.closest('#btnSkip')) {
      PLAY.skip();
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

    /* 点出售区 → 卖掉选中的那只。
     * 触屏上拖拽不可用，这是触屏唯一的出售方式；鼠标用户拖过去也行。 */
    if (e.target.closest('#sellZone')) {
      if (UI.selectedTeam >= 0) {
        const r = g.sellPet(UI.selectedTeam);
        say(r.msg);
        UI.selectedTeam = -1;
        renderTop(); renderShop();
      } else {
        say('先点一只宠物选中它，再点这里出售');
      }
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

  // 拖拽：队伍内排序 + 商店买到指定位置 + 道具拖到宠物身上 + 拖到出售区卖掉
  let dragTeamFrom = -1;    // 队伍内拖动
  let dragShopFrom = -1;    // 从商店宠物拖出
  let dragFoodFrom = -1;    // 从商店道具拖出

  const clearDrag = function () {
    dragTeamFrom = -1; dragShopFrom = -1; dragFoodFrom = -1;
    const dz = $('#sellZone');
    if (dz) dz.classList.remove('hot');
  };

  root.addEventListener('dragstart', function (e) {
    if (e.target.closest('.freeze')) return;      // 冻结按钮不是拖拽手柄
    const shopCard = e.target.closest('[data-shop-pet]');
    if (shopCard) {
      dragShopFrom = +shopCard.dataset.shopPet;
      shopCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      return;
    }
    const foodCard = e.target.closest('[data-shop-food]');
    if (foodCard) {
      dragFoodFrom = +foodCard.dataset.shopFood;
      foodCard.classList.add('dragging');
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
    clearDrag();
  });

  root.addEventListener('dragover', function (e) {
    // 出售区：只有队伍里的宠物能卖
    const dz = e.target.closest('#sellZone');
    if (dz) {
      if (dragTeamFrom >= 0) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dz.classList.add('hot');
      }
      return;
    }
    if (e.target.closest('#myRow')) {
      e.preventDefault();
      if (dragShopFrom >= 0 || dragFoodFrom >= 0) e.dataTransfer.dropEffect = 'copy';
    }
  });

  root.addEventListener('dragleave', function (e) {
    /* 只在【真的离开】出售区时灭灯 —— relatedTarget 还在区里说明只是
     * 从 zone 移到了它内部的 span，不算离开。 */
    const dz = e.target.closest('#sellZone');
    if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('hot');
  });

  root.addEventListener('drop', function (e) {
    // ① 丢到出售区 → 卖掉
    const dz = e.target.closest('#sellZone');
    if (dz) {
      e.preventDefault();
      if (dragTeamFrom >= 0) {
        const r = UI.game.sellPet(dragTeamFrom);
        say(r.msg);
        UI.selectedTeam = -1;
      }
      clearDrag();
      renderTop(); renderShop();
      return;
    }

    const c = e.target.closest('#myRow [data-team-idx]');
    if (!c) return;
    e.preventDefault();
    const to = +c.dataset.teamIdx;

    if (dragShopFrom >= 0) {
      // 从商店拖到队伍的指定位置 → 买下并插到该位置
      const r = UI.game.buyPet(dragShopFrom, to);
      say(r.msg);
    } else if (dragFoodFrom >= 0) {
      /* 道具拖到某只宠物身上直接使用。
       * ⚠️ 空位要先挡掉：否则 buyFood 已经扣了钱、再报「目标无效」，
       *    白白留下一份待用道具，玩家还得再点一次目标。 */
      if (to >= UI.game.team.length) {
        say('这里没有宠物，道具要用在宠物身上');
        clearDrag();
        renderShop();
        return;
      }
      const r = UI.game.buyFood(dragFoodFrom);
      if (r && r.ok && r.needTarget) {
        const r2 = UI.game.applyFood(to);
        say(r2.msg);
      } else {
        say(r.msg);      // 目标无关的食物：buyFood 内部已经直接生效了
      }
    } else if (dragTeamFrom >= 0) {
      UI.game.movePet(dragTeamFrom, to);
    } else {
      clearDrag();
      return;
    }
    clearDrag();
    UI.selectedTeam = -1;
    renderTop(); renderShop();
  });
}

/* （原来的 applyEventSilent 已删 —— 「跳过动画」现在走 PLAY.skip()，
 *   用的是 playback.js 里那一份唯一的实现。） */

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
  UI.boardOffered = false;      // 新一局：重新给一次挑战排行榜的机会

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
