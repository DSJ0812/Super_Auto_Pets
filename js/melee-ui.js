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
  const teamMax = g.getTeamMax();
  for (let i = 0; i < teamMax; i++) {
    const p = g.team[i];
    if (p) {
      const c = petCard(p, { selectable: true, selected: MUI.selTeam === i });
      c.dataset.mTeamIdx = i;
      c.draggable = true;
      row.appendChild(c);
    } else {
      const s = el('div', 'pet slot-empty', '<span>空位</span>');
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
    const cost = petCostOf(p.defId);
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
    : '点击购买 · 拖到队伍指定位置 · 点两次出售 · 可攒钱吃利息';
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
function mCloneView(p, side) {
  return {
    uid: p.uid, defId: p.defId, def: p.def, lvl: p.lvl,
    atk: p.atk, hp: p.hp,
    perks: (p.perks || []).map(function (x) { return { id: x.id, uses: x.uses }; }),
    side: side
  };
}

function mFindView(uid) {
  const v = MUI.view;
  if (!v) return null;
  // ⚠️ v 的结构是 { mine, foe }，不是数组，不能写成 v[0]/v[1]
  for (const p of v.mine) if (p.uid === uid) return { pet: p, side: 0 };
  for (const p of v.foe)  if (p.uid === uid) return { pet: p, side: 1 };
  return null;
}

function mRenderBattleBoard(highlight, label) {
  const v = MUI.view;
  if (!v) return;
  const foe = $('#mFoeRow');
  foe.innerHTML = '';
  for (const p of v.foe) {
    const c = petCard(p);
    if (highlight && highlight.indexOf(p.uid) >= 0) c.classList.add('acting');
    foe.appendChild(c);
  }
  const mine = $('#mMyBattleRow');
  mine.innerHTML = '';
  for (const p of v.mine) {
    const c = petCard(p);
    if (highlight && highlight.indexOf(p.uid) >= 0) c.classList.add('acting');
    mine.appendChild(c);
  }
  if (label != null) $('#mBattleLabel').textContent = label;
}

function mStartBattle(res, foeTeam, foeName, iAmA) {
  MUI.log = res.log;
  MUI.idx = 0;
  MUI.view = {
    mine: MUI.m.human.game.team.map(function (p) { return mCloneView(p, 0); }),
    foe: foeTeam.map(function (p) { return mCloneView(p, 1); })
  };
  MUI.foeName = foeName;
  $('#mShopView').style.display = 'none';
  $('#mbattle').style.display = '';
  $('#mBtnSkip').style.display = '';
  $('#mBtnNext').style.display = 'none';
  mRenderBattleBoard(null, '准备开战…');
  mStepBattle();
}

function mApplyEvent(ev) {
  const v = MUI.view;
  if (!v) return;
  switch (ev.e) {
    case 'attack': {
      const A = mFindView(ev.a), B = mFindView(ev.b);
      if (A) A.pet.hp -= ev.dmgA;
      if (B) B.pet.hp -= ev.dmgB;
      return [ev.a, ev.b];
    }
    case 'dmg':    { const t = mFindView(ev.t); if (t) t.pet.hp -= ev.n; return [ev.t]; }
    case 'buff':   { const t = mFindView(ev.t); if (t) { t.pet.atk += ev.atk; t.pet.hp += ev.hp; } return [ev.t]; }
    case 'perk':   { const t = mFindView(ev.t); if (t) t.pet.perks = [{ id: ev.id, uses: 1 }]; return [ev.t]; }
    case 'perkUsed': {
      const t = mFindView(ev.t);
      if (t) { const pk = t.pet.perks.find(function (x) { return x.id === ev.id; }); if (pk) pk.uses--; }
      return [ev.t];
    }
    case 'faint':  { const t = mFindView(ev.t); if (t) { t.pet.hp = 0; t.pet._dead = true; } return [ev.t]; }
    case 'summon': {
      // 玩家始终是 side 0（runBattle 的第一个参数），对手是 side 1
      const key = ev.side === 0 ? 'mine' : 'foe';
      v[key].splice(ev.pos, 0, {
        uid: ev.t, defId: ev.defId, def: PETS[ev.defId], lvl: ev.lvl || 1,
        atk: ev.atk, hp: ev.hp, perks: [], side: ev.side
      });
      return [ev.t];
    }
  }
  return null;
}

function mStepBattle() {
  const v = MUI.view;
  if (!v) return;

  // 上一帧标记阵亡的移出视图（保证 summon 的 pos 与引擎一致）
  v.mine = v.mine.filter(function (p) { return !p._dead; });
  v.foe  = v.foe.filter(function (p) { return !p._dead; });

  if (MUI.idx >= MUI.log.length) { mFinishBattle(); return; }
  const ev = MUI.log[MUI.idx++];
  let label = null;

  switch (ev.e) {
    case 'battleStart': label = '开战！'; break;
    case 'phase':       label = '第 ' + ev.n + ' 回合'; break;
    case 'attack': {
      const A = mFindView(ev.a), B = mFindView(ev.b);
      if (A) A.pet.hp -= ev.dmgA;
      if (B) B.pet.hp -= ev.dmgB;
      label = (A ? petName(A.pet.def) : '?') + ' ⚔ ' + (B ? petName(B.pet.def) : '?');
      MUI._hi = [ev.a, ev.b];
      break;
    }
    case 'dmg':  { const t = mFindView(ev.t); if (t) { t.pet.hp -= ev.n; label = petName(t.pet.def) + ' 受到 ' + ev.n + ' 伤害'; } MUI._hi = [ev.t]; break; }
    case 'buff': { const t = mFindView(ev.t); if (t) { t.pet.atk += ev.atk; t.pet.hp += ev.hp; label = petName(t.pet.def) + ' +' + ev.atk + '/+' + ev.hp; } MUI._hi = [ev.t]; break; }
    case 'perk': { const t = mFindView(ev.t); if (t) t.pet.perks = [{ id: ev.id, uses: 1 }]; label = '获得 ' + ev.id; MUI._hi = [ev.t]; break; }
    case 'faint':{ const t = mFindView(ev.t); if (t) { t.pet.hp = 0; t.pet._dead = true; label = petName(t.pet.def) + ' 阵亡'; } MUI._hi = [ev.t]; break; }
    case 'summon': {
      const key = ev.side === 0 ? 'mine' : 'foe';
      v[key].splice(ev.pos, 0, {
        uid: ev.t, defId: ev.defId, def: PETS[ev.defId], lvl: ev.lvl || 1,
        atk: ev.atk, hp: ev.hp, perks: [], side: ev.side
      });
      label = '召唤了 ' + petName(PETS[ev.defId]);
      MUI._hi = [ev.t];
      break;
    }
    case 'ability': { MUI._hi = [ev.t]; break; }
    case 'battleEnd':
      MUI.idx = MUI.log.length;
      mFinishBattle(ev.winner);
      return;
  }

  mRenderBattleBoard(MUI._hi || null, label);
  const base = 420 / (MUI.speedMul || 1);
  MUI.timer = setTimeout(mStepBattle, ev.e === 'phase' ? base * 1.6 : base);
}

function mFinishBattle(winner) {
  const m = MUI.m;
  if (winner === undefined) winner = m.lastReport && m.lastReport.humanRes
    ? m.lastReport.humanRes.winner : 'draw';

  // 清掉残留尸体
  if (MUI.view) {
    MUI.view.mine = MUI.view.mine.filter(function (p) { return !p._dead; });
    MUI.view.foe  = MUI.view.foe.filter(function (p) { return !p._dead; });
    mRenderBattleBoard(null, '战斗结束');
  }

  let txt, cls;
  if (winner === 0) txt = '🎉 这一场赢了！';
  else if (winner === 1) txt = '💀 这一场输了';
  else txt = '🤝 平局';

  $('#mBattleLabel').textContent = txt;
  $('#mBattleLabel').className = 'battle-label ' + (winner === 0 ? 'win' : winner === 1 ? 'lose' : 'draw');
  $('#mBtnSkip').style.display = 'none';

  const over = m.phase === 'over';
  const btn = $('#mBtnNext');
  btn.style.display = '';
  if (over) {
    btn.textContent = '📊 查看最终结果';
    btn.dataset.mrestart = '1';
  } else {
    btn.textContent = '➡️ 进入第 ' + (m.turn + 1) + ' 回合';
    btn.dataset.mrestart = '';
  }
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
    // 轮空
    say(m.human.name + ' 本回合轮空，不掉血');
    mRenderAll();
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
      clearTimeout(MUI.timer);
      while (MUI.idx < MUI.log.length) {
        const ev = MUI.log[MUI.idx++];
        if (ev.e === 'battleEnd') break;
        const v = MUI.view;
        if (!v) break;
        v.mine = v.mine.filter(function (p) { return !p._dead; });
        v.foe  = v.foe.filter(function (p) { return !p._dead; });
        mApplyEvent(ev);
      }
      mFinishBattle();
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

    // 点队伍宠物：用道具 or 选中/出售
    const tp = e.target.closest('#mMyRow .pet');
    if (tp) {
      const i = +tp.dataset.mTeamIdx;
      if (g.pendingFood != null) {
        const r = g.applyFood(i);
        say(r.msg);
        mRefreshShopUI();
        return;
      }
      if (MUI.selTeam === i) {
        const r = g.sellPet(i);
        say(r.msg);
        MUI.selTeam = -1;
        mRefreshShopUI();
      } else {
        MUI.selTeam = i;
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
  MUI.m = new Melee();
  mBind();
  mRenderAll();
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
