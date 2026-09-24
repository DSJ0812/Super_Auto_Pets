'use strict';
/* ============================================================
 *  online-ui.js — 联机界面
 *
 *  和 melee-ui.js 的关系：
 *   · 渲染复用 render.js（宠物卡 / 商店槽 / 道具槽 / 遗物）
 *   · 战斗回放复用 playback.js
 *   · 区别只在「数据从哪来、操作往哪去」：
 *       单机 = 直接读写本地 Melee 实例
 *       联机 = 读服务器发来的快照，操作发给服务器（服务器是唯一权威）
 * ============================================================ */

const OUI = {
  game: null,          // 服务器发来的「我这份」状态（解包成真正的 Game 实例）
  self: null,          // 服务器发来的原始包（含 hp / ready / rank）
  roster: [],
  lobbyPlayers: [],
  lastMatches: [],
  phase: 'lobby',      // lobby | shop | battle | over
  turn: 1,
  seat: -1,
  selTeam: -1,
  speedMul: 1,

  // 回放状态（托管给 BattlePlayer）
  view: null,
  log: [],
  idx: 0,
  timer: null
};

/* 战斗回放器（playback.js），元素是本页的 id */
const OPLAY = new BattlePlayer({
  foe: '#mFoeRow', mine: '#mMyBattleRow', label: '#mBattleLabel',
  skip: '#mBtnSkip', next: '#mBtnNext',
  shopView: '#mShopView', battleView: '#mbattle',
  speedMul: function () { return OUI.speedMul; },
  onFinish: function () {
    const btn = $('#mBtnNext');
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = (OUI.phase === 'over') ? '📊 查看最终结果'
                                             : '➡️ 进入第 ' + (OUI.turn + 1) + ' 回合';
  }
});

const OUI_SEATS = 8;

/* ------------------------------------------------------------
 *  小工具
 * ---------------------------------------------------------- */
function oHostSeat() {
  const list = OUI.roster.filter(function (r) { return r.kind === 'remote'; });
  if (!list.length) {
    const lp = OUI.lobbyPlayers;
    if (!lp.length) return -1;
    return Math.min.apply(null, lp.map(function (p) { return p.seat; }));
  }
  return Math.min.apply(null, list.map(function (r) { return r.idx; }));
}
function oIsHost() { return OUI.seat >= 0 && OUI.seat === oHostSeat(); }
function oMe() {
  for (const r of OUI.roster) if (r.idx === OUI.seat) return r;
  return null;
}

/* 所有操作都走这里：发给服务器 → 用服务器返回的状态刷新界面 */
function oAct(action) {
  return NET.act(action).then(function (r) {
    if (r && r.msg && r.ok === false) say(r.msg);
    if (r && r.you) oApplySelf(r.you);
    if (r && r.roster) OUI.roster = r.roster;
    oRenderRoster();
    oRefreshShopUI();
    oRenderReady();
    return r;
  });
}

function oApplySelf(you) {
  if (!you) return;
  OUI.self = you;
  OUI.turn = you.turn;
  OUI.seat = you.seat;
  OUI.game = gameFromPack(you);
}

/* ------------------------------------------------------------
 *  顶栏
 * ---------------------------------------------------------- */
function oRenderTop() {
  const g = OUI.game;
  $('#mTurn').textContent = OUI.turn;
  $('#mGold').textContent = g ? g.gold : '–';
  const me = oMe();
  $('#mHp').textContent = me ? me.hp : (OUI.self ? OUI.self.hp : '–');
  $('#mAlive').textContent = OUI.roster.filter(function (r) { return r.alive; }).length;

  if (g) {
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
}

/* ------------------------------------------------------------
 *  8 人血量面板
 * ---------------------------------------------------------- */
function oRenderRoster() {
  const box = $('#roster');
  if (!box) return;
  box.innerHTML = '';
  const list = OUI.roster.slice().sort(function (a, b) {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.hp - a.hp;
  });

  for (const f of list) {
    const card = el('div', 'roster-card');
    if (f.idx === OUI.seat) card.classList.add('me');
    if (!f.alive) card.classList.add('out');
    if (f.kind === 'ai') card.classList.add('ai');

    const pct = Math.max(0, Math.min(100, (f.hp / 30) * 100));
    card.innerHTML =
      '<div class="rc-top">' +
        '<span class="rc-name">' + esc(f.name) +
          (f.kind === 'ai' ? '<span class="rc-ai">电脑</span>' : '') +
          (f.connected === false ? '<span class="rc-ai off">掉线</span>' : '') +
        '</span>' +
        (f.alive
          ? '<span class="rc-hp">' + f.hp + '</span>'
          : '<span class="rc-rank">第' + f.rank + '名</span>') +
      '</div>' +
      '<div class="rc-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="rc-team">' + (f.ready && f.alive ? '✅ ' : '') + '队伍 ' + f.teamSize + ' 只</div>';
    box.appendChild(card);
  }
}

/* ------------------------------------------------------------
 *  战报
 * ---------------------------------------------------------- */
function oRenderReport() {
  const box = $('#report');
  if (!box) return;
  const list = OUI.lastMatches;
  if (!list || !list.length) { box.style.display = 'none'; return; }
  box.style.display = '';

  let html = '<div class="report-head">第 ' + OUI.turn + ' 回合战报</div><div class="report-list">';
  for (const m of list) {
    if (m.winner === 'bye') {
      html += '<div class="report-row bye"><span class="rr-pair">' + esc(m.aName) +
              '</span><span class="rr-res">轮空（不掉血）</span></div>';
      continue;
    }
    let resTxt;
    if (m.winner === 'draw') resTxt = '<span class="rr-draw">平局</span>';
    else {
      const loserName = (m.loserIdx === m.a) ? m.aName : m.bName;
      resTxt = '<span class="rr-lose">' + esc(loserName) + ' -' + m.dmg + '</span>';
    }
    const meCls = (m.a === OUI.seat || m.b === OUI.seat) ? ' mine' : '';
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
function oRenderTeam() {
  const g = OUI.game;
  const row = $('#mMyRow');
  if (!row || !g) return;
  row.innerHTML = '';
  row.classList.toggle('picking', OUI.selTeam >= 0);
  const teamMax = g.getTeamMax();
  for (let i = 0; i < teamMax; i++) {
    const p = g.team[i];
    if (p) {
      const c = petCard(p, { selectable: true, selected: OUI.selTeam === i });
      c.dataset.oTeamIdx = i;
      c.draggable = true;
      row.appendChild(c);
    } else {
      const s = el('div', 'pet slot-empty',
        '<span>' + (OUI.selTeam >= 0 ? '放这里' : '空位') + '</span>');
      s.dataset.oTeamIdx = i;
      row.appendChild(s);
    }
  }
}

/* ------------------------------------------------------------
 *  商店
 * ---------------------------------------------------------- */
function oRenderShop() {
  const g = OUI.game;
  if (!g) return;

  const st = g.getShopTier();
  const badge = $('#mTierBadge');
  if (badge) badge.textContent = '等级 ' + st + '（T1–T' + st + '）';

  const sr = $('#mShopPets');
  sr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_PET_SLOTS; i++) {
    const p = g.shopPets[i];
    if (!p) { sr.appendChild(el('div', 'shop-slot empty')); continue; }
    const cost = petCostOf(p.defId, g);
    sr.appendChild(shopPetSlot(p, {
      frozen: g.frozenPets[i],
      slotAttr: 'oShopPet', slotIndex: i,
      freezeAttr: 'oFreezePet',
      cost: cost, affordable: g.gold >= cost,
      draggable: true
    }));
  }

  const fr = $('#mShopFoods');
  fr.innerHTML = '';
  for (let i = 0; i < CFG.SHOP_FOOD_SLOTS; i++) {
    fr.appendChild(foodSlot(g.shopFoods[i], g, {
      frozen: g.frozenFoods[i],
      selected: g.pendingFood === i,
      slotAttr: 'oShopFood', slotIndex: i,
      freezeAttr: 'oFreezeFood'
    }));
  }

  const notesBox = $('#mShopNotes');
  const notes = g.shopNotes || [];
  if (notes.length) {
    notesBox.style.display = '';
    notesBox.innerHTML = '<span class="notes-label">⚡ 技能</span>' + esc(notes.join(' · '));
  } else {
    notesBox.style.display = 'none';
  }

  const rc = rollCostOf();
  $('#mBtnRoll').textContent = '🎲 刷新（' + rc + ' 金）';
  $('#mBtnRoll').disabled = g.gold < rc;
}

/* 结算/等待状态：结束回合按钮 + 房主强制推进 */
function oRenderReady() {
  const g = OUI.game;
  if (!g) return;
  const me = OUI.self;
  const btn = $('#mBtnEnd');
  const ready = !!(me && me.ready);
  const out = me && me.alive === false;

  if (out) {
    btn.textContent = '💀 你已出局，观战中';
    btn.disabled = true;
  } else {
    btn.textContent = ready ? '⏳ 已结束回合，点此取消' : '⚔️ 结束回合，开打！';
    btn.disabled = ready ? false : (g.team.length === 0);
  }
  $('#mBtnRoll').disabled = out || g.gold < rollCostOf();

  const others = OUI.roster.filter(function (r) {
    return r.kind === 'remote' && r.idx !== OUI.seat && r.alive;
  });
  const waiting = others.filter(function (r) { return !r.ready; }).map(function (r) { return r.name; });

  const fb = $('#mBtnForce');
  if (fb) fb.style.display = (oIsHost() && waiting.length) ? '' : 'none';

  const hint = $('#mHint');
  if (hint) {
    if (out) {
      hint.textContent = '你已出局，可以继续看别人打完';
    } else if (g.pendingFood != null) {
      hint.textContent = '👉 请点击一只宠物来使用这个道具';
    } else if (ready) {
      hint.textContent = waiting.length
        ? '⏳ 等 ' + waiting.join('、') + ' 结束回合…'
        : '⏳ 等待服务器结算…';
    } else if (waiting.length) {
      hint.textContent = '还在选：' + waiting.join('、');
    } else {
      hint.textContent = teamHintText();
    }
  }
}

/* ------------------------------------------------------------
 *  整体渲染
 * ---------------------------------------------------------- */
function oRenderAll() {
  oRenderTop();
  oRenderRoster();
  oRenderTeam();
  oRenderShop();
  oRenderReady();
}
function oRefreshShopUI() {
  oRenderTop();
  oRenderTeam();
  oRenderShop();
  oRenderReady();
}

/* ------------------------------------------------------------
 *  视图切换
 * ---------------------------------------------------------- */
function oShowLobby() { $('#lobby').style.display = 'flex'; }
function oHideLobby() { $('#lobby').style.display = 'none'; }
function oShowShop() {
  $('#mbattle').style.display = 'none';
  $('#mShopView').style.display = '';
}

/* 最终结算面板 */
function oShowOver() {
  const list = OUI.roster.slice().sort(function (a, b) {
    const ra = a.rank || 99, rb = b.rank || 99;
    return ra - rb;
  });
  const me = list.find(function (r) { return r.idx === OUI.seat; });
  $('#lobbySub').textContent = '本局结束';
  $('#lobbyJoin').style.display = 'none';
  $('#lobbyOffline').style.display = 'none';
  $('#lobbyMain').style.display = '';
  $('.lobby-share').style.display = 'none';

  let html = '<div class="ls-label">最终名次</div><div class="lobby-players">';
  for (const r of list) {
    html += '<div class="lobby-player' + (r.idx === OUI.seat ? ' me' : '') + '">' +
              '<span class="lp-seat">' + (r.rank || '–') + '</span>' +
              '<span class="lp-name">' + esc(r.name) +
                (r.kind === 'ai' ? ' <span class="rc-ai">电脑</span>' : '') + '</span>' +
              '<span class="lp-tag">' + (r.hp > 0 ? r.hp + ' 血' : '出局') + '</span>' +
            '</div>';
  }
  html += '</div>';
  $('#lobbyPlayers').innerHTML = html;
  $('#lobbyCount').textContent = '';
  $('#lobbyHint').innerHTML = me
    ? '<b>' + (me.rank === 1 ? '🏆 你是最后的赢家！' : '你拿到了第 ' + me.rank + ' 名') + '</b>'
    : '';
  $('#btnStart').style.display = 'none';
  $('#btnRestart').style.display = '';
  oShowLobby();
}

/* 房间种子由服务器决定，这里只显示（换不了，改了也没用） */
function oRenderSeed(d) {
  const seed = (d && d.seed) || OUI.roomSeed;
  if (!seed) return;
  OUI.roomSeed = seed;
  const info = { seed: seed, daily: false };
  renderSeedBar($('#seedBar'), info, '服务器决定，所有人同一局', { label: '房间种子', canEdit: false });
  bindSeedBar($('#seedBar'), info, { copyValue: function () { return seed; } });
}

/* ------------------------------------------------------------
 *  服务器事件
 * ---------------------------------------------------------- */
function oOnEvent(d) {
  if (!d) return;
  switch (d.t) {
    case 'lobby':
      OUI.lobbyPlayers = d.players || [];
      oRenderLobby(d);
      break;

    case 'started':
      oHideLobby();
      if (d.seed) oRenderSeed(d);
      say('游戏开始！活到最后就是赢家。');
      break;

    case 'turn':
      OUI.phase = 'shop';
      OUI.turn = d.turn;
      OUI.roster = d.roster || OUI.roster;
      oApplySelf(d.you);
      oShowShop();
      oRenderAll();
      say('第 ' + d.turn + ' 回合开始');
      break;

    case 'self':
      oApplySelf(d.you);
      if (d.roster) OUI.roster = d.roster;
      oRefreshShopUI();
      break;

    case 'roster':
      OUI.roster = d.roster || OUI.roster;
      oRenderRoster();
      oRenderReady();
      break;

    case 'battle':
      oOnBattle(d);
      break;

    case 'over':
      OUI.phase = 'over';
      OUI.roster = d.roster || OUI.roster;
      oRenderRoster();
      break;

    case 'snapshot':
      oApplySnapshot(d);
      break;

    case 'kicked':
      // 房间被重置了 → 回大厅重新加入
      OUI.phase = 'lobby';
      OUI.game = null; OUI.self = null; OUI.roster = [];
      NET.forget();
      oShowLobbyJoin();
      break;
  }
}

function oOnBattle(d) {
  OUI.phase = d.over ? 'over' : 'battle';
  OUI.turn = d.turn;
  OUI.roster = d.roster || OUI.roster;
  OUI.lastMatches = d.matches || [];
  oRenderRoster();
  oRenderReport();

  const y = d.you;
  if (!y || y.bye) {
    if (y && y.out) { oShowOut(d); return; }
    say('本回合轮空，不掉血');
    oShowShop();
    oRenderAll();
    return;
  }
  // ⚠️ 日志里的 uid 是按 uid 索引的，所以必须先解包出 def 再交给回放器
  const mine = (y.mine || []).map(petFromJSON);
  const foe  = (y.foe  || []).map(petFromJSON);
  // ⚠️ isA=false 时玩家是引擎的 side 1 —— 不翻译的话召唤物会跑到对手那一侧、
  //    胜负也会反（和 8 人混战是同一个 bug）。
  OPLAY.start(OUI, y.log, mine, foe, '对手：' + y.foeName, {
    mySide: y.isA === false ? 1 : 0,
    winner: y.winner            // 引擎视角，playback 会按 mySide 翻译
  });
}

/* 出局后的观战画面：没有自己的战斗可看，但还能看战报、能推进 */
function oShowOut(d) {
  $('#mShopView').style.display = 'none';
  $('#mbattle').style.display = '';
  $('#mFoeRow').innerHTML = '';
  $('#mMyBattleRow').innerHTML = '';
  const lb = $('#mBattleLabel');
  if (lb) {
    lb.textContent = '💀 你已出局，正在观战';
    lb.className = 'battle-label lose';
  }
  $('#mBtnSkip').style.display = 'none';
  const nx = $('#mBtnNext');
  nx.style.display = '';
  nx.disabled = false;
  nx.textContent = d.over ? '📊 查看最终结果' : '➡️ 进入第 ' + (d.turn + 1) + ' 回合';
}

function oApplySnapshot(s) {
  if (!s) return;
  OUI.roster = s.roster || [];
  OUI.turn = s.turn || 1;
  OUI.seat = NET.seat;
  OUI.lobbyPlayers = (s.lobby && s.lobby.players) || OUI.lobbyPlayers;
  if (s.you) oApplySelf(s.you);

  if (s.phase === 'lobby') { oShowLobbyJoin(); return; }
  oHideLobby();

  if (s.phase === 'over') {
    OUI.phase = 'over';
    oShowShop();
    oRenderAll();
    return;
  }
  if (s.phase === 'battle' && s.lastBattle) {
    oOnBattle(s.lastBattle);
    return;
  }
  OUI.phase = 'shop';
  oShowShop();
  oRenderAll();
}

/* ------------------------------------------------------------
 *  大厅
 * ---------------------------------------------------------- */
function oShowLobbyJoin(msg) {
  $('#lobbyJoin').style.display = '';
  $('#lobbyOffline').style.display = 'none';
  $('#lobbyMain').style.display = 'none';
  $('#lobbySub').textContent = '输入昵称加入房间';
  const err = $('#lobbyErr');
  if (err) {
    // ⚠️ 加入失败时必须显示在【大厅面板里】。
    //    say() 的 #message 在大厅遮罩后面，用户根本看不见。
    err.style.display = msg ? '' : 'none';
    err.textContent = msg || '';
  }
  const inp = $('#nickInput');
  if (inp && !inp.value) {
    let saved = '';
    try { saved = localStorage.getItem('sap_nick') || ''; } catch (e) {}
    inp.value = saved;
  }
  oShowLobby();
}

function oShowLobbyOffline(why) {
  $('#lobbyJoin').style.display = 'none';
  $('#lobbyMain').style.display = 'none';
  $('#lobbyOffline').style.display = '';
  $('#lobbySub').textContent = '未连接到服务器';
  $('#lobbyOfflineWhy').textContent = why || '';
  oShowLobby();
}

function oRenderLobby(d) {
  const players = OUI.lobbyPlayers || [];
  $('#lobbySub').textContent = players.length + ' / ' + OUI_SEATS + ' 人在房间';
  $('#lobbyJoin').style.display = 'none';
  $('#lobbyOffline').style.display = 'none';
  $('#lobbyMain').style.display = '';

  const share = $('.lobby-share');
  if (share) {
    share.style.display = '';
    $('#lobbyUrl').textContent = location.origin;
  }

  const host = oHostSeat();
  const bySeat = {};
  for (const p of players) bySeat[p.seat] = p;

  const box = $('#lobbyPlayers');
  box.innerHTML = '';
  for (let i = 0; i < OUI_SEATS; i++) {
    const p = bySeat[i];
    const card = el('div', 'lobby-player' + (p ? '' : ' empty') + (p && p.seat === NET.seat ? ' me' : ''));
    card.innerHTML = p
      ? '<span class="lp-seat">' + (i + 1) + '</span>' +
        '<span class="lp-name">' + esc(p.name) + (p.seat === NET.seat ? '（你）' : '') + '</span>' +
        (p.seat === host ? '<span class="lp-tag">房主</span>' : '') +
        (p.connected ? '' : '<span class="lp-tag off">掉线</span>')
      : '<span class="lp-seat">' + (i + 1) + '</span>' +
        '<span class="lp-name dim">空位 · 电脑补位</span>';
    box.appendChild(card);
  }
  $('#lobbyCount').textContent = '（' + players.length + ' 真人 + ' +
    (OUI_SEATS - players.length) + ' 电脑）';

  $('#lobbyHint').innerHTML = players.length >= OUI_SEATS
    ? '人满了，可以开始了！'
    : '人不够没关系 —— 剩下的座位会由电脑补位，照样能玩。';

  $('#btnStart').style.display = oIsHost() ? '' : 'none';
  $('#btnStart').disabled = players.length < 1;
  $('#btnRestart').style.display = 'none';
}

/* ------------------------------------------------------------
 *  事件绑定
 * ---------------------------------------------------------- */
function oBind() {
  const root = $('#app');

  root.addEventListener('click', function (e) {
    // 图鉴
    if (e.target.closest('#mBtnCodexClose') ||
        (e.target.closest('#codex') && !e.target.closest('.codex-panel'))) {
      closeCodex('#codex');
      return;
    }
    if (codexOpen('#codex')) return;
    if (e.target.closest('#mBtnCodex')) { openCodex('#codex', '#codexBody'); return; }

    // 大厅
    if (e.target.closest('#btnJoin')) { oDoJoin(); return; }
    if (e.target.closest('#btnStart')) {
      NET.start().then(function (r) { if (!r.ok) say(r.msg); });
      return;
    }
    if (e.target.closest('#btnRestart')) {
      NET.restart().then(function (r) { if (!r.ok) say(r.msg); });
      return;
    }

    // 大厅弹出时，屏蔽游戏内点击
    if ($('#lobby').style.display === 'flex') return;

    const g = OUI.game;
    if (!g) return;

    // 选遗物
    const ro = e.target.closest('[data-relic]');
    if (ro) { oAct({ type: 'pickRelic', id: ro.dataset.relic }); return; }
    if ($('#relicPick') && $('#relicPick').style.display === 'flex') return;

    // 速度
    const spd = e.target.closest('.spd');
    if (spd) {
      OUI.speedMul = parseFloat(spd.dataset.ospeed) || 1;
      const all = document.querySelectorAll('.spd');
      for (let i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === spd);
      return;
    }

    // 跳过动画
    if (e.target.closest('#mBtnSkip')) { OPLAY.skip(); return; }

    // 下一回合 / 看最终结果
    if (e.target.closest('#mBtnNext')) {
      const btn = $('#mBtnNext');
      if (OUI.phase === 'over') { oShowOver(); return; }
      btn.disabled = true;
      btn.textContent = '⏳ 等其他人…';
      NET.act({ type: 'nextTurn' });
      return;
    }

    // 结束回合 / 取消
    if (e.target.closest('#mBtnEnd')) {
      if (OUI.self && OUI.self.ready) { oAct({ type: 'unready' }); return; }
      if (g.pendingFood != null) { say('先选一只宠物用掉道具'); return; }
      if (g.pendingRelicChoice && g.pendingRelicChoice.length) { say('先选一件遗物'); return; }
      oAct({ type: 'ready' });
      return;
    }

    // 房主强制推进
    if (e.target.closest('#mBtnForce')) {
      oAct({ type: 'forceResolve' }).then(function (r) { if (r.msg) say(r.msg); });
      return;
    }

    // 刷新
    if (e.target.closest('#mBtnRoll')) { oAct({ type: 'roll' }); return; }

    // 冻结
    const fp = e.target.closest('[data-o-freeze-pet]');
    if (fp) { oAct({ type: 'freezePet', i: +fp.dataset.oFreezePet }); return; }
    const ff = e.target.closest('[data-o-freeze-food]');
    if (ff) { oAct({ type: 'freezeFood', i: +ff.dataset.oFreezeFood }); return; }

    // 买道具
    const sf = e.target.closest('[data-o-shop-food]');
    if (sf) { oAct({ type: 'buyFood', slot: +sf.dataset.oShopFood }); return; }

    // 买宠物
    const sp = e.target.closest('[data-o-shop-pet]');
    if (sp) { oAct({ type: 'buyPet', slot: +sp.dataset.oShopPet }); return; }

    // 点队伍格子（宠物或空位）—— 语义见 render.js 的 teamTapAction
    const tp = e.target.closest('#mMyRow [data-o-team-idx]');
    if (tp) {
      const i = +tp.dataset.oTeamIdx;
      const a = teamTapAction(
        { sel: OUI.selTeam, pendingFood: g.pendingFood != null },
        i, g.team.length);

      if (a.act === 'food')        oAct({ type: 'applyFood', idx: i });
      else if (a.act === 'sell')   { OUI.selTeam = -1; oAct({ type: 'sellPet', idx: i }); }
      else if (a.act === 'move')   { OUI.selTeam = -1; oAct({ type: 'movePet', from: a.from, to: a.to }); }
      else if (a.act === 'select') { OUI.selTeam = i; oRenderTeam(); }
      else                         { OUI.selTeam = -1; oRenderTeam(); }
      return;
    }
    if (OUI.selTeam >= 0 && !e.target.closest('#mMyRow')) {
      OUI.selTeam = -1;
      oRenderTeam();
      return;
    }
  });

  // 回车直接加入
  const nick = $('#nickInput');
  if (nick) {
    nick.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') oDoJoin();
    });
  }

  // 拖拽：队伍内排序 + 商店拖到指定位置
  let dragTeam = -1, dragShop = -1;
  root.addEventListener('dragstart', function (e) {
    const shopCard = e.target.closest('[data-o-shop-pet]');
    if (shopCard) {
      dragShop = +shopCard.dataset.oShopPet;
      shopCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      return;
    }
    const c = e.target.closest('#mMyRow .pet');
    if (!c) return;
    dragTeam = +c.dataset.oTeamIdx;
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
    const c = e.target.closest('#mMyRow [data-o-team-idx]');
    if (!c) return;
    e.preventDefault();
    const to = +c.dataset.oTeamIdx;
    if (dragShop >= 0)      oAct({ type: 'buyPet', slot: dragShop, to: to });
    else if (dragTeam >= 0) oAct({ type: 'movePet', from: dragTeam, to: to });
    dragTeam = -1; dragShop = -1; OUI.selTeam = -1;
  });

  // 关页面时通知服务器，免得别人干等
  window.addEventListener('pagehide', function () { NET.leave(); });
}

function oDoJoin() {
  const inp = $('#nickInput');
  const name = (inp && inp.value || '').trim() || '无名玩家';
  try { localStorage.setItem('sap_nick', name); } catch (e) {}
  NET.join(name).then(function (r) {
    if (!r.ok) {
      // 房间正在打、或者满员 —— 必须让用户看见原因，否则就是一个「点了没反应」的按钮
      const err = $('#lobbyErr');
      if (err) { err.style.display = ''; err.textContent = '❌ ' + r.msg; }
      try { localStorage.removeItem(NET_LS_KEY); } catch (e2) {}
      return;
    }
    const err = $('#lobbyErr');
    if (err) err.style.display = 'none';
    OUI.seat = r.seat;
    NET.onEvent = oOnEvent;
    NET.startPolling();
  });
}

/* ------------------------------------------------------------
 *  启动
 * ---------------------------------------------------------- */
function oBoot() {
  oBind();
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCodex('#codex');
  });
  NET.onEvent = oOnEvent;

  NET.ping().then(function (online) {
    if (!online) {
      oShowLobbyOffline('这个地址上没有联机服务器（可能是公网静态托管，或者用 file:// 打开的）。');
      return;
    }
    // 先试重连（刷新页面/断线回来），不行再让输昵称
    NET.rejoin().then(function (r) {
      if (r.ok) {
        OUI.seat = r.seat;
        NET.startPolling();          // 快照会通过轮询推回来
      } else {
        oShowLobbyJoin(NET.serverPhase && NET.serverPhase !== 'lobby'
          ? '房间里已经有一局在打了（' + NET.serverPlayers + ' 人在里面）。等他们打完，或者让房主点「再开一局」，然后刷新本页。'
          : '');
      }
    });
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', oBoot);
} else {
  oBoot();
}
