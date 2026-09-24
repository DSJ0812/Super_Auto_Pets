'use strict';
/* ============================================================
 *  melee-ui.js — 8 人混战界面
 *
 *  渲染复用 render.js（宠物卡 / 商店槽 / 道具槽），
 *  交互逻辑参考 ui.js（单人模式），但绑定的是 Melee 实例。
 * ============================================================ */

const MUI = {
  m: null,            // Melee 实例
  view: null,         // 战斗展示镜像
  log: [],
  idx: 0,
  timer: null,
  speedMul: 1,
  selTeam: -1         // 选中的队伍位置（点两次出售）
};

/* 战斗回放器（playback.js）。状态托管在 MUI 上，所以 MUI.view/log/idx 依然可查 */
const MPLAY = new BattlePlayer({
  foe: '#mFoeRow', mine: '#mMyBattleRow', label: '#mBattleLabel',
  skip: '#mBtnSkip', next: '#mBtnNext',
  shopView: '#mShopView', battleView: '#mbattle',
  speedMul: function () { return MUI.speedMul; },
  onFinish: function () {
    const m = MUI.m;
    const btn = $('#mBtnNext');
    if (!btn) return;
    if (m.phase === 'over') {
      btn.textContent = '📊 查看最终结果';
      btn.dataset.mrestart = '1';
    } else {
      btn.textContent = '➡️ 进入第 ' + (m.turn + 1) + ' 回合';
      btn.dataset.mrestart = '';
    }
  }
});

/* ------------------------------------------------------------
 *  顶栏
 * ---------------------------------------------------------- */
function mRenderTop() {
  const m = MUI.m, g = m.human.game;
  $('#mTurn').textContent = m.turn;
  $('#mGold').textContent = g.gold;
  $('#mHp').textContent = m.human.hp;
  $('#mAlive').textContent = m.alive().length;
  // 遗物：已获得的图标条 + 到点的三选一
  renderRelicBar($('#relicBar'), g.relics);
  renderSynergyBar($('#synergyBar'), g.team);
  const box = $('#relicPick');
  if (box) {
    if (g.pendingRelicChoice && g.pendingRelicChoice.length) {
      renderRelicChoices($('#relicChoices'), g.pendingRelicChoice);
      box.style.display = 'flex';
    } else {
      box.style.display = 'none';
    }
  }
}

/* ------------------------------------------------------------
 *  8 人血量面板
 * ---------------------------------------------------------- */
function mRenderRoster() {
  const box = $('#roster');
  if (!box) return;
  box.innerHTML = '';
  const m = MUI.m;

  // 存活优先、血量高的靠前
  const list = m.fighters.slice().sort(function (a, b) {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive !== b.alive) return 0;
    return b.hp - a.hp;
  });

  for (const f of list) {
    const card = el('div', 'roster-card');
    if (f.isHuman) card.classList.add('me');
    if (!f.alive) card.classList.add('out');

    const pct = Math.max(0, Math.min(100, (f.hp / MELEE_CFG.BASE_HP) * 100));
    let teamIcons = '';
    for (const p of f.game.team) teamIcons += PET_EMOJI[p.defId] || '🐾';

    card.innerHTML =
      '<div class="rc-top">' +
        '<span class="rc-name">' + esc(f.name) + '</span>' +
        (f.alive
          ? '<span class="rc-hp">' + f.hp + '</span>'
          : '<span class="rc-rank">第' + f.rank + '名</span>') +
      '</div>' +
      '<div class="rc-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="rc-team" title="队伍">' + teamIcons + '</div>';
    box.appendChild(card);
  }
}

/* ------------------------------------------------------------
 *  战报
 * ---------------------------------------------------------- */
function mRenderReport() {
  const box = $('#report');
  if (!box) return;
  const rp = MUI.m.lastReport;
  if (!rp) { box.style.display = 'none'; return; }
  box.style.display = '';

  let html = '<div class="report-head">第 ' + rp.turn + ' 回合战报</div><div class="report-list">';
  for (const m of rp.matches) {
    if (m.winner === 'bye') {
      html += '<div class="report-row bye"><span class="rr-pair">' + esc(m.aName) +
              '</span><span class="rr-res">轮空（不掉血）</span></div>';
      continue;
    }
    let resTxt;
    if (m.winner === 'draw') resTxt = '<span class="rr-draw">平局</span>';
    else {
      const loserName = m.loserIdx === m.a ? m.aName : m.bName;
      resTxt = '<span class="rr-lose">' + esc(loserName) + ' -' + m.dmg + '</span>';
    }
    const meCls = (m.a === 0 || m.b === 0) ? ' mine' : '';
    html += '<div class="report-row' + meCls + '">' +
            '<span class="rr-pair">' + esc(m.aName) + ' <b>vs</b> ' + esc(m.bName) + '</span>' +
            '<span class="rr-res">' + resTxt + '</span></div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

/* ------------------------------------------------------------
 *  我的队伍
 * ---------------------------------------------------------- */
function mRenderTeam() {
  const g = MUI.m.human.game;
  const row = $('#mMyRow');
  if (!row) return;
  row.innerHTML = '';
  row.classList.toggle('picking', MUI.selTeam >= 0);
  const teamMax = g.getTeamMax();
  for (let i = 0; i < teamMax; i++) {
    const p = g.team[i];
    if (p) {
      const c = petCard(p, { selectable: true, selected: MUI.selTeam === i });
      c.dataset.mTeamIdx = i;
      c.draggable = true;
      row.appendChild(c);
    } else {
      const s = el('div', 'pet slot-empty',
        '<span>' + (MUI.selTeam >= 0 ? '放这里' : '空位') + '</span>');
      s.dataset.mTeamIdx = i;
      row.appendChild(s);
    }
  }
}

/* ------------------------------------------------------------
 *  商店
 * ---------------------------------------------------------- */
function mRenderShop() {
  const m = MUI.m, g = m.human.game;

  const st = g.getShopTier();
  const badge = $('#mTierBadge');
  if (badge) badge.textContent = '等级 ' + st + '（T1–T' + st + '）';

  // 宠物槽
  const sr = $('#mShopPets');
  sr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_PET_SLOTS; i++) {
    const p = g.shopPets[i];
    if (!p) { sr.appendChild(el('div', 'shop-slot empty')); continue; }
    const cost = petCostOf(p.defId, g);   // ⚠️ 必须传 game，否则「批发商」遗物的折扣不会显示
    sr.appendChild(shopPetSlot(p, {
      frozen: g.frozenPets[i],
      slotAttr: 'mShopPet', slotIndex: i,
      freezeAttr: 'mFreezePet',
      cost: cost, affordable: g.gold >= cost,
      draggable: true
    }));
  }

  // 道具槽
  const fr = $('#mShopFoods');
  fr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    fr.appendChild(foodSlot(g.shopFoods[i], g, {
      frozen: g.frozenFoods[i],
      selected: g.pendingFood === i,
      slotAttr: 'mShopFood', slotIndex: i,
      freezeAttr: 'mFreezeFood'
    }));
  }
  renderPendingFoods(fr, g);

  // 技能汇总
  const notesBox = $('#mShopNotes');
  const notes = g.shopNotes || [];
  if (notes.length) {
    notesBox.style.display = '';
    notesBox.innerHTML = '<span class="notes-label">⚡ 技能</span>' + esc(notes.join(' · '));
  } else {
    notesBox.style.display = 'none';
  }

  // 按钮
  const rc = rollCostOf();
  $('#mBtnRoll').textContent = '🎲 刷新（' + rc + ' 金）';
  $('#mBtnRoll').disabled = g.gold < rc;
  $('#mBtnEnd').disabled = g.team.length === 0;

  $('#mHint').textContent = (g.pendingFood != null)
    ? '👉 请点击一只宠物来使用这个道具'
    : teamHintText();
}

/* ------------------------------------------------------------
 *  整体渲染
 * ---------------------------------------------------------- */
function mRenderAll() {
  mRenderTop();
  mRenderRoster();
  mRenderTeam();
  mRenderShop();
}

/* 商店阶段任何操作后的刷新：⚠️ 必须带上队伍，否则买完宠物看不到它进队 */
function mRefreshShopUI() {
  mRenderTop();
  mRenderTeam();
  mRenderShop();
}

/* ------------------------------------------------------------
 *  战斗播放（只播玩家参战的那一场）
 * ---------------------------------------------------------- */
/* 展示用镜像 / 查找 / 回放：实现在 playback.js，三种模式共用 */
function mCloneView(p, side) { return battleCloneView(p, side); }
function mFindView(uid) { return battleFind(MUI.view, uid); }

function mRenderBattleBoard(highlight, label) { MPLAY.render(highlight, label); }

function mStartBattle(res, foeTeam, foeName, iAmA) {
  MUI.foeName = foeName;
  // ⚠️ 用「开战前」的对手队伍，不能用 res.final（那是打完后的残局）
  // ⚠️ iAmA 必须传下去！8 人混战里玩家可能是配对里的 b 方（引擎 side 1），
  //    不翻译的话召唤物会显示到对手那一侧、胜负也会反。
  MPLAY.start(MUI, res.log, MUI.m.human.game.team, foeTeam, '准备开战…',
    { mySide: iAmA === false ? 1 : 0, winner: res.winner });
}

function mApplyEvent(ev) { MPLAY.apply(ev); }
function mStepBattle() { MPLAY.step(); }

function mFinishBattle(winner) {
  if (winner === undefined) {
    const rp = MUI.m && MUI.m.lastReport;
    winner = (rp && rp.humanRes) ? rp.humanRes.winner : 'draw';
  }
  MPLAY.finish(winner);
}

/* ------------------------------------------------------------
 *  结束回合
 * ---------------------------------------------------------- */
function mEndTurn() {
  const m = MUI.m;
  if (m.phase !== 'shop') return;

  const r = m.endTurn();
  if (!r.ok) { say(r.msg); return; }

  // 渲染战报 + 血量面板
  mRenderTop();
  mRenderRoster();
  mRenderReport();

  // 播放玩家参战的那一场
  const rp = r.report;
  if (rp.humanLog) {
    // ⚠️ 用「开战前」的对手队伍，不能用 res.final（那是打完后的残局）
    mStartBattle(rp.humanRes, rp.humanFoe || [], rp.humanFoeName || '', rp.humanIsA);
  } else {
    // 轮空：没有战斗可播，但【必须】让玩家能走到下一回合。
    // ⚠️ 以前这里只 mRenderAll() 就结束了，结果 Melee.phase 一直停在 'battle'
    //    （endTurn() 结尾会把它设成 'battle'，靠点「进入下一回合」按钮才推进），
    //    而那个按钮在战斗视图里、轮空时压根不显示 ——
    //    于是下一回合点「结束回合开打」会被 mEndTurn() 开头的 phase 检查挡掉，
    //    表现就是「点了没反应」。
    say(m.human.name + ' 本回合轮空，不掉血');
    // 手动把界面切到「战斗结束」的样子，复用同一个「进入下一回合」按钮
    MUI.view = { mine: [], foe: [] };
    MUI.log = []; MUI.idx = 0;
    const sv = $('#mShopView'); if (sv) sv.style.display = 'none';
    const bv = $('#mbattle');   if (bv) bv.style.display = '';
    const mr = $('#mMyBattleRow'); if (mr) mr.innerHTML = '';
    const fr2 = $('#mFoeRow');     if (fr2) fr2.innerHTML = '';
    const lb = $('#mBattleLabel');
    if (lb) { lb.textContent = '本回合轮空（不掉血，也不算连胜）'; lb.className = 'battle-label draw'; }
    const sk = $('#mBtnSkip'); if (sk) sk.style.display = 'none';
    const nx = $('#mBtnNext');
    if (nx) {
      nx.style.display = '';
      if (m.phase === 'over') { nx.textContent = '📊 查看最终结果'; nx.dataset.mrestart = '1'; }
      else { nx.textContent = '➡️ 进入第 ' + (m.turn + 1) + ' 回合'; nx.dataset.mrestart = ''; }
    }
  }
}

/* ------------------------------------------------------------
 *  重开
 * ------------------------------------------------------------ */
function mRestart() {
  MUI.m = new Melee();
  MUI.view = null; MUI.log = []; MUI.idx = 0;
  clearTimeout(MUI.timer);
  MUI.selTeam = -1;
  $('#mbattle').style.display = 'none';
  $('#mShopView').style.display = '';
  mRenderAll();
  say('新的一局 8 人混战开始了！');
}

/* ------------------------------------------------------------
 *  事件绑定
 * ---------------------------------------------------------- */
function mBind() {
  const root = $('#app');

  root.addEventListener('click', function (e) {
    const m = MUI.m;
    const g = m.human.game;

    // 图鉴：关闭按钮 / 点遮罩空白处关闭（面板内点击不关）
    if (e.target.closest('#mBtnCodexClose') ||
        (e.target.closest('#codex') && !e.target.closest('.codex-panel'))) {
      closeCodex('#codex');
      return;
    }
    // 图鉴打开时，屏蔽其他点击
    if (codexOpen('#codex')) return;

    // 选遗物（三选一弹窗）
    const ro = e.target.closest('[data-relic]');
    if (ro) {
      const r = g.pickRelic(ro.dataset.relic);
      say(r.msg);
      mRefreshShopUI();
      return;
    }
    // 弹窗打开时，屏蔽其他点击
    if ($('#relicPick') && $('#relicPick').style.display === 'flex') return;

    // 打开图鉴
    if (e.target.closest('#mBtnCodex')) {
      openCodex('#codex', '#codexBody');
      return;
    }

    // 速度
    const spd = e.target.closest('.spd');
    if (spd) {
      MUI.speedMul = parseFloat(spd.dataset.mspeed) || 1;
      const all = document.querySelectorAll('.spd');
      for (let i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === spd);
      return;
    }

    // 跳过动画
    if (e.target.closest('#mBtnSkip')) {
      MPLAY.skip();
      return;
    }

    // 下一回合 / 重开 / 最终结果
    if (e.target.closest('#mBtnNext')) {
      const btn = e.target.closest('#mBtnNext');
      if (btn.dataset.mrestart === '1') { mRestart(); return; }
      m.nextTurn();
      MUI.selTeam = -1;
      $('#mbattle').style.display = 'none';
      $('#mShopView').style.display = '';
      mRenderAll();
      say('第 ' + m.turn + ' 回合开始');
      return;
    }

    // 结束回合
    if (e.target.closest('#mBtnEnd')) {
      if (g.pendingFood != null) { say('先选一只宠物用掉道具'); return; }
      if (g.pendingRelicChoice && g.pendingRelicChoice.length) { say('先选一件遗物'); return; }
      mEndTurn();
      return;
    }

    // 刷新
    if (e.target.closest('#mBtnRoll')) {
      const r = g.roll();
      say(r.msg);
      mRefreshShopUI();
      return;
    }

    // 冻结
    const fp = e.target.closest('[data-m-freeze-pet]');
    if (fp) { g.toggleFreezePet(+fp.dataset.mFreezePet); mRenderShop(); return; }
    const ff = e.target.closest('[data-m-freeze-food]');
    if (ff) { g.toggleFreezeFood(+ff.dataset.mFreezeFood); mRenderShop(); return; }

    // 买道具
    const sf = e.target.closest('[data-m-shop-food]');
    if (sf) {
      const r = g.buyFood(+sf.dataset.mShopFood);
      say(r.msg);
      mRefreshShopUI();
      return;
    }

    // 买宠物
    const sp = e.target.closest('[data-m-shop-pet]');
    if (sp) {
      const r = g.buyPet(+sp.dataset.mShopPet);
      say(r.msg);
      mRefreshShopUI();
      return;
    }

    // 点队伍格子（宠物或空位）—— 语义见 render.js 的 teamTapAction
    const tp = e.target.closest('#mMyRow [data-m-team-idx]');
    if (tp) {
      const i = +tp.dataset.mTeamIdx;
      const a = teamTapAction(
        { sel: MUI.selTeam, pendingFood: g.pendingFood != null },
        i, g.team.length);

      if (a.act === 'food') {
        const r = g.applyFood(i);
        say(r.msg);
        mRefreshShopUI();
      } else if (a.act === 'sell') {
        const r = g.sellPet(i);
        say(r.msg);
        MUI.selTeam = -1;
        mRefreshShopUI();
      } else if (a.act === 'move') {
        g.movePet(a.from, a.to);
        MUI.selTeam = -1;
        mRefreshShopUI();
      } else if (a.act === 'select') {
        MUI.selTeam = i;
        mRenderTeam();
      } else {
        MUI.selTeam = -1;
        mRenderTeam();
      }
      return;
    }

    if (MUI.selTeam >= 0 && !e.target.closest('#mMyRow')) {
      MUI.selTeam = -1;
      mRenderTeam();
    }
  });

  // 拖拽：队伍内排序 + 商店拖到指定位置购买
  let dragTeam = -1, dragShop = -1;
  root.addEventListener('dragstart', function (e) {
    const shopCard = e.target.closest('[data-m-shop-pet]');
    if (shopCard) {
      dragShop = +shopCard.dataset.mShopPet;
      shopCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      return;
    }
    const c = e.target.closest('#mMyRow .pet');
    if (!c) return;
    dragTeam = +c.dataset.mTeamIdx;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragend', function (e) {
    const c = e.target.closest('.dragging');
    if (c) c.classList.remove('dragging');
  });
  root.addEventListener('dragover', function (e) {
    if (e.target.closest('#mMyRow')) {
      e.preventDefault();
      if (dragShop >= 0) e.dataTransfer.dropEffect = 'copy';
    }
  });
  root.addEventListener('drop', function (e) {
    const c = e.target.closest('#mMyRow [data-m-team-idx]');
    if (!c) return;
    e.preventDefault();
    const to = +c.dataset.mTeamIdx;
    const g = MUI.m.human.game;
    if (dragShop >= 0) {
      const r = g.buyPet(dragShop, to);
      say(r.msg);
    } else if (dragTeam >= 0) {
      g.movePet(dragTeam, to);
    } else return;
    dragTeam = -1; dragShop = -1; MUI.selTeam = -1;
    mRefreshShopUI();
  });
}

/* ------------------------------------------------------------
 *  启动
 * ---------------------------------------------------------- */
function mBoot() {
  // ⚠️ 种子必须在 new Melee() 之前设好 —— 否则开局那批随机数已经用掉真随机了
  MUI.seedInfo = initSeed();
  MUI.m = new Melee();
  mBind();
  mRenderAll();
  renderSeedBar($('#seedBar'), MUI.seedInfo, '');
  bindSeedBar($('#seedBar'), MUI.seedInfo);
  // Esc 关闭图鉴（未打开时调用无副作用）
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCodex('#codex');
  });
  say('8 人混战开始！活到最后就是赢家。');
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mBoot);
} else {
  mBoot();
}
