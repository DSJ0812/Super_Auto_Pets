'use strict';
/* ============================================================
 *  board-ui.js — 排行榜界面（弹层 + 挑战流程）
 *
 *  ⚠️ 整个弹层的 DOM 由这个文件【动态创建】，不在各页面 HTML 里各写一份。
 *     这个项目已经吃过"同一个功能两份实现"的亏（道具图标、商店价格、
 *     战斗渲染），所以这次一开始就只有一份。
 *
 *  三个页面都用它：index.html（看榜）、solo.html（经典/每日）、
 *  melee.html（8 人混战）。
 *
 *  ------------------------------------------------------------
 *  界面分两块：
 *    ① 榜单弹层 —— 三个 tab，读 Firestore 显示前 10
 *    ② 挑战弹层 —— 通关后可选：挑战排行榜 / 直接结束
 *         挑战 = 从榜上末位往上打，赢一场前进一名，输了停住
 * ============================================================ */

const BUI = {
  mode: 'classic',
  dateKey: null,
  entries: null,
  loading: false,
  err: '',

  /* 挑战流程的状态 */
  ch: null
};

/* 模式显示名 */
const BOARD_MODE_CN = { classic: '经典模式', melee: '8 人混战', daily: '每日挑战' };
const BOARD_MODE_ICON = { classic: '🎯', melee: '⚔️', daily: '📅' };

/* HTML 转义
 * ⚠️ 不复用 render.js 的 esc()：主页（index.html）只加载了排行榜要用的脚本，
 *    并没有加载 render.js —— 直接调 esc 会 ReferenceError。
 *    名字是玩家输入的内容，必须转义，所以这里自带一份兜底实现。 */
function boardEsc(s) {
  if (typeof esc === 'function') return esc(s);
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------
 *  弹层的 DOM 只建一次
 * ---------------------------------------------------------- */
function boardEnsureDom() {
  if (document.getElementById('boardModal')) return;

  const wrap = document.createElement('div');
  wrap.id = 'boardModal';
  wrap.className = 'howto-modal';
  wrap.innerHTML =
    '<div class="howto-box board-box">' +
      '<div class="howto-head">' +
        '<span class="howto-title">🏆 排行榜</span>' +
        '<span class="howto-close" id="boardClose">✕</span>' +
      '</div>' +
      '<div class="howto-tabs" id="boardTabs">' +
        '<span class="howto-tab on" data-btab="classic">🎯 经典模式</span>' +
        '<span class="howto-tab" data-btab="melee">⚔️ 8 人混战</span>' +
        '<span class="howto-tab" data-btab="daily">📅 每日挑战</span>' +
      '</div>' +
      '<div class="board-body" id="boardBody"></div>' +
    '</div>';
  document.body.appendChild(wrap);

  wrap.addEventListener('click', function (e) {
    if (e.target === wrap) boardClose();
    const tab = e.target.closest ? e.target.closest('.howto-tab') : null;
    if (tab && tab.dataset.btab) boardSwitch(tab.dataset.btab);
  });
  document.getElementById('boardClose').addEventListener('click', boardClose);

  /* 挑战弹层 */
  const cw = document.createElement('div');
  cw.id = 'chalModal';
  cw.className = 'howto-modal';
  cw.innerHTML =
    '<div class="howto-box chal-box">' +
      '<div class="howto-head">' +
        '<span class="howto-title" id="chalTitle">🏆 挑战排行榜</span>' +
      '</div>' +
      '<div class="chal-body" id="chalBody"></div>' +
      /* 挑战的战斗在这里播 —— 用独立的一块场地，【不借用页面的战斗区】：
       * 页面那边的显示/隐藏由各自的 UI 逻辑管着，借来借去容易打架。
       * 结构照抄 solo.html 的 .arena（样式现成，不用新写）。 */
      '<div class="chal-arena" id="chalArena" style="display:none">' +
        '<div class="arena">' +
          '<div class="arena-side">' +
            '<div class="arena-label" id="chalFoeLabel">对手</div>' +
            '<div id="chalFoeRow" class="pet-row arena-row-foe"></div>' +
          '</div>' +
          '<div class="arena-clash"><span>⚔</span></div>' +
          '<div class="arena-side">' +
            '<div class="arena-label mine">我的队伍</div>' +
            '<div id="chalMyRow" class="pet-row arena-row-mine"></div>' +
          '</div>' +
        '</div>' +
        '<div class="chal-arena-bar">' +
          '<span id="chalArenaLabel"></span>' +
          '<button class="btn tiny" id="chalArenaSkip">⏩ 跳过动画</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(cw);
  cw.addEventListener('click', function (e) {
    if (e.target === cw && BUI.ch && !BUI.ch.busy) chalFinish(false);
  });
}

function boardClose() {
  const m = document.getElementById('boardModal');
  if (m) m.style.display = 'none';
}
function boardShow() {
  const m = document.getElementById('boardModal');
  if (m) m.style.display = 'flex';
}

/* ------------------------------------------------------------
 *  打开榜单
 * ---------------------------------------------------------- */
function boardOpen(mode, dateKey) {
  boardEnsureDom();
  BUI.mode = mode || 'classic';
  BUI.dateKey = dateKey || null;
  /* tab 高亮 */
  const tabs = document.querySelectorAll('#boardTabs .howto-tab');
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('on', tabs[i].dataset.btab === BUI.mode);
  }
  boardShow();
  boardLoad();
}

function boardSwitch(mode) {
  BUI.mode = mode;
  const tabs = document.querySelectorAll('#boardTabs .howto-tab');
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('on', tabs[i].dataset.btab === mode);
  }
  boardLoad();
}

/* 每日榜要按【今天】的日期取 */
function boardTodayKey() {
  if (typeof RNG !== 'undefined' && RNG.dailySeed) return RNG.dailySeed();
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return 'daily-' + d.getFullYear() + '-' + mm + '-' + dd;
}

function boardLoad() {
  const body = document.getElementById('boardBody');
  if (!body) return;
  const dateKey = BUI.mode === 'daily' ? (BUI.dateKey || boardTodayKey()) : null;
  BUI.dateKey = dateKey;

  if (!Board.ready && !Board.loading) {
    body.innerHTML = '<div class="board-msg">正在连接排行榜…</div>';
  } else if (!Board.ready) {
    body.innerHTML = '<div class="board-msg">正在连接排行榜…</div>';
  }

  Board.fetch(BUI.mode, dateKey, function (entries, err) {
    if (entries == null) {
      body.innerHTML = '<div class="board-msg bad">😕 排行榜暂时连不上<br>' +
        '<span class="board-sub">' + boardEsc(err || '') + '</span><br>' +
        '<span class="board-sub">不影响你继续玩单机</span></div>';
      return;
    }
    BUI.entries = entries;
    boardRenderList(entries);
  });
}

function boardRenderList(entries) {
  const body = document.getElementById('boardBody');
  if (!body) return;

  const head = '<div class="board-head">' +
    '<span class="bh-mode">' + BOARD_MODE_ICON[BUI.mode] + ' ' + BOARD_MODE_CN[BUI.mode] + '</span>' +
    (BUI.mode === 'daily'
      ? '<span class="bh-date">' + boardEsc(String(BUI.dateKey).replace('daily-', '')) + ' · 每天一个榜</span>'
      : '<span class="bh-date">累计榜，不按天清空</span>') +
    '</div>';

  if (!entries.length) {
    body.innerHTML = head + '<div class="board-msg">榜上还没有人<br>' +
      '<span class="board-sub">' + boardHowToGetOn() + '</span></div>';
    return;
  }

  let html = head + '<div class="board-list">';
  for (const e of entries) {
    const medal = e.rank === 1 ? '🥇' : (e.rank === 2 ? '🥈' : (e.rank === 3 ? '🥉' : ''));
    html += '<div class="board-row' + (e.rank <= 3 ? ' top' + e.rank : '') + '">' +
      '<span class="br-rank">' + (medal || ('#' + e.rank)) + '</span>' +
      '<span class="br-name">' + boardEsc(e.name || '') + '</span>' +
      '<span class="br-score">' + boardEsc(boardScoreText(BUI.mode, e.score)) + '</span>' +
      '<span class="br-team">' + boardTeamIcons(e.team) + '</span>' +
      '</div>';
  }
  html += '</div>';
  html += '<div class="board-foot">' + boardHowToGetOn() + '</div>';
  body.innerHTML = html;
}

/* 阵容缩略：图标 + 等级 */
function boardTeamIcons(team) {
  if (!team || !team.length) return '<span class="br-none">—</span>';
  let s = '';
  for (const p of team) {
    const em = (typeof petArtHtml === 'function') ? petArtHtml(p.defId) : '🐾';
    s += '<span class="br-pet" title="' + boardEsc(p.defId) + '">' + em +
         '<b>' + (p.lvl || 1) + '</b></span>';
  }
  return s;
}

function boardHowToGetOn() {
  if (BUI.mode === 'melee') return '8 人混战吃鸡后，就有机会上榜';
  if (BUI.mode === 'daily') return '当天通关（10 胜）后，就有机会上榜';
  return '经典模式通关（10 胜）后，就有机会上榜';
}

/* ------------------------------------------------------------
 *  挑战流程
 * ---------------------------------------------------------- */

/* 达成条件后调用：mode / game（当前这局）/ 阵容 / 回调 */
function boardOfferChallenge(mode, myTeam, score, dateKey, onDone) {
  boardEnsureDom();
  BUI.ch = {
    mode: mode,
    dateKey: dateKey || null,
    myTeam: myTeam,
    score: score,
    entries: null,
    won: 0,
    busy: false,
    onDone: onDone || function () {}
  };
  const cw = document.getElementById('chalModal');
  cw.style.display = 'flex';
  chalRenderIntro();
}

function chalSetBody(html) {
  const b = document.getElementById('chalBody');
  if (b) b.innerHTML = html;
}

/* 第一步：问玩家要不要挑战 */
function chalRenderIntro() {
  const c = BUI.ch;
  chalSetBody(
    '<div class="chal-intro">' +
      '<div class="chal-big">🎉 达成条件！</div>' +
      '<div class="chal-line">你现在的阵容可以拿去挑战排行榜上的阵容。</div>' +
      '<div class="chal-line dim">规则：从榜上最后一名开始打，赢一场就前进一名，输了就停在那里。' +
      '全赢就是第 1 名。</div>' +
      '<div class="chal-btns">' +
        '<button class="btn primary" id="chalGo">⚔️ 挑战排行榜</button>' +
        '<button class="btn" id="chalSkip">直接结束</button>' +
      '</div>' +
      '<div class="chal-err" id="chalErr"></div>' +
    '</div>');
  document.getElementById('chalGo').addEventListener('click', chalBegin);
  document.getElementById('chalSkip').addEventListener('click', function () { chalFinish(false); });
}

/* 第二步：读榜 → 开打 */
function chalBegin() {
  const c = BUI.ch;
  if (!c || c.busy) return;
  c.busy = true;
  chalSetBody('<div class="chal-msg">正在读取排行榜…</div>');

  Board.fetch(c.mode, c.dateKey, function (entries, err) {
    c.busy = false;
    if (entries == null) {
      chalSetBody('<div class="chal-msg bad">😕 连不上排行榜<br>' +
        '<span class="board-sub">' + boardEsc(err || '') + '</span></div>' +
        '<div class="chal-btns"><button class="btn" id="chalBack">返回</button></div>');
      document.getElementById('chalBack').addEventListener('click', chalRenderIntro2);
      return;
    }
    c.entries = entries;
    if (!entries.length) {
      /* 空榜：没人可打，直接第 1 名 */
      c.won = 0;
      chalRenderDone(true);
      return;
    }
    c.idx = entries.length - 1;      // 从最后一名开始
    c.won = 0;
    chalRenderNext();
  });
}

function chalRenderIntro2() {
  const c = BUI.ch;
  if (c) c.busy = false;
  chalRenderIntro();
}

/* 显示当前对手 */
function chalRenderNext() {
  const c = BUI.ch;
  const foe = c.entries[c.idx];
  if (!foe) { chalRenderDone(true); return; }

  chalSetBody(
    '<div class="chal-next">' +
      '<div class="chal-prog">第 <b>' + (c.won + 1) + '</b> 场 · 对手是第 <b>' + foe.rank + '</b> 名' +
        '<span class="dim">（榜上共 ' + c.entries.length + ' 人）</span></div>' +
      '<div class="chal-vs">' +
        '<div class="chal-side"><div class="cs-label">你的阵容</div>' +
          '<div class="cs-team">' + boardTeamIcons(c.myTeam) + '</div></div>' +
        '<div class="chal-vsmark">VS</div>' +
        '<div class="chal-side"><div class="cs-label">' + boardEsc(foe.name || '') + '</div>' +
          '<div class="cs-team">' + boardTeamIcons(foe.team) + '</div>' +
          '<div class="cs-score">' + boardEsc(boardScoreText(c.mode, foe.score)) + '</div></div>' +
      '</div>' +
      '<div class="chal-btns"><button class="btn primary" id="chalFight">⚔️ 开打</button></div>' +
      '<div class="chal-err" id="chalErr"></div>' +
    '</div>');
  document.getElementById('chalFight').addEventListener('click', chalDoFight);
}

/* 打一场：先算结果，再在弹层里的场地播回放，播完才出结论
 * 走的是和正式战斗完全一样的引擎 + 同一个回放器，所以表现一致。 */
function chalDoFight() {
  const c = BUI.ch;
  if (!c || c.busy) return;
  const foe = c.entries[c.idx];
  const r = boardFight(c.myTeam, foe.team);
  if (!r) {
    chalSetBody('<div class="chal-msg bad">😕 这场打不起来（阵容数据有问题）</div>' +
      '<div class="chal-btns"><button class="btn" id="chalEnd2">结束挑战</button></div>');
    document.getElementById('chalEnd2').addEventListener('click', function () { chalFinish(true); });
    return;
  }

  c.lastFoe = foe;
  c.lastWin = (r.winner === 0);

  /* 没有回放器（理论上不会）就直接出结果，不能让玩家卡住 */
  if (typeof BattlePlayer !== 'function') { chalAfterFight(); return; }

  const mine = (c.myTeam || []).map(petFromJSON);
  const foePets = (foe.team || []).map(petFromJSON);

  chalSetBody('');
  chalShowArena(foe);
  const player = new BattlePlayer({
    foe: '#chalFoeRow', mine: '#chalMyRow', label: '#chalArenaLabel',
    skip: '#chalArenaSkip',
    arena: '#chalArena .arena',
    speedMul: function () { return 1; },
    onFinish: function () { chalAfterFight(); }
  });
  c.player = player;
  const sk = document.getElementById('chalArenaSkip');
  if (sk) sk.addEventListener('click', function () { player.skip(); });
  player.start(c, r.log, mine, foePets, '挑战：' + (foe.name || ''), { mySide: 0, winner: r.winner });
}

function chalShowArena(foe) {
  const a = document.getElementById('chalArena');
  if (a) a.style.display = '';
  const fl = document.getElementById('chalFoeLabel');
  if (fl) fl.textContent = '对手 · 第 ' + foe.rank + ' 名「' + (foe.name || '') + '」';
  const al = document.getElementById('chalArenaLabel');
  if (al) al.textContent = '第 ' + (BUI.ch.won + 1) + ' 场';
}
function chalHideArena() {
  const a = document.getElementById('chalArena');
  if (a) a.style.display = 'none';
  const fr = document.getElementById('chalFoeRow'); if (fr) fr.innerHTML = '';
  const mr = document.getElementById('chalMyRow'); if (mr) mr.innerHTML = '';
}

/* 回放播完（或被跳过）之后：判胜负、推进流程 */
function chalAfterFight() {
  const c = BUI.ch;
  if (!c || c.finished) return;
  c.finished = true;
  chalHideArena();
  const foe = c.lastFoe;

  if (c.lastWin) {
    c.won++;
    if (c.idx === 0) { c.finished = false; chalRenderDone(true); return; }   // 全赢
    c.idx--;
    c.finished = false;
    chalRenderWinThenNext(foe);
  } else {
    c.finished = false;
    chalRenderDone(false);
  }
}

/* 赢了 → 给个喘息，再打下一场 */
function chalRenderWinThenNext(foe) {
  const c = BUI.ch;
  chalSetBody(
    '<div class="chal-win">' +
      '<div class="chal-big ok">✅ 赢了！</div>' +
      '<div class="chal-line">你击败了第 <b>' + foe.rank + '</b> 名「' + boardEsc(foe.name || '') + '」</div>' +
      '<div class="chal-line dim">目前已经赢了 ' + c.won + ' 场' +
        '，最高能到第 ' + boardRankAfter(c.entries.length, c.won) + ' 名</div>' +
      '<div class="chal-btns"><button class="btn primary" id="chalNextFoe">继续挑战</button>' +
      '<button class="btn" id="chalStop">见好就收</button></div>' +
    '</div>');
  document.getElementById('chalNextFoe').addEventListener('click', chalRenderNext);
  document.getElementById('chalStop').addEventListener('click', function () { chalFinish(true); });
}

/* 挑战结束 → 算名次 → 取名 */
function chalRenderDone(allWin) {
  const c = BUI.ch;
  const total = c.entries ? c.entries.length : 0;
  const rank = boardRankAfter(total, c.won);
  c.finalRank = rank;

  if (rank > BOARD_MAX) {
    chalSetBody(
      '<div class="chal-done">' +
        '<div class="chal-big">挑战结束</div>' +
        '<div class="chal-line">你排第 <b>' + rank + '</b> 名，' +
          '没进前 ' + BOARD_MAX + ' 名。</div>' +
        '<div class="chal-line dim">下次通关再来！</div>' +
        '<div class="chal-btns"><button class="btn primary" id="chalOk">知道了</button></div>' +
      '</div>');
    document.getElementById('chalOk').addEventListener('click', function () { chalFinish(false); });
    return;
  }

  const msg = allWin && c.won > 0 ? '🎉 全胜！你排第 ' + rank + ' 名'
    : (c.won > 0 ? '✅ 你击败了 ' + c.won + ' 个人，排第 ' + rank + ' 名'
                 : '挑战结束，你排第 ' + rank + ' 名');
  c.busy = false;
  chalSetBody(
    '<div class="chal-done">' +
      '<div class="chal-big ok">' + boardEsc(msg) + '</div>' +
      '<div class="chal-line">给你的阵容起个名字，就能上排行榜了：</div>' +
      '<input class="chal-name" id="chalName" maxlength="12" placeholder="最多 10 个字">' +
      '<div class="chal-rules">取名规则：最多 <b>10 个字</b>；只能用中文、字母、数字，' +
        '可以有 <b>- _ ·</b>；不能重名、不能用不合适的词。</div>' +
      '<div class="chal-btns"><button class="btn primary" id="chalSubmit">🏆 上榜</button>' +
      '<button class="btn" id="chalGiveUp">算了</button></div>' +
      '<div class="chal-err" id="chalErr"></div>' +
    '</div>');
  const inp = document.getElementById('chalName');
  if (inp) inp.focus();
  document.getElementById('chalSubmit').addEventListener('click', chalSubmit);
  document.getElementById('chalGiveUp').addEventListener('click', function () { chalFinish(false); });
  if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') chalSubmit(); });
}

/* 校验名字 → 提交 */
function chalSubmit() {
  const c = BUI.ch;
  if (!c || c.busy) return;
  const inp = document.getElementById('chalName');
  const errBox = document.getElementById('chalErr');
  const name = inp ? inp.value : '';

  const chk = checkNickname(name);
  if (!chk.ok) { if (errBox) errBox.textContent = '❌ ' + chk.msg; return; }

  /* 重名 */
  const myOwner = boardOwnerId();
  if (boardNameTaken(c.entries || [], name.trim(), myOwner)) {
    if (errBox) errBox.textContent = '❌ 这个名字已经有人用了，换一个';
    return;
  }

  c.busy = true;
  if (errBox) errBox.textContent = '';
  const entry = {
    rank: c.finalRank,
    name: name.trim(),
    owner: myOwner,
    score: c.score || {},
    team: (c.teamJson || c.myTeam || []).map(function (p) {
      return (typeof petToJSON === 'function' && p && p.defId !== undefined && p.hp !== undefined)
        ? petToJSON(p) : p;
    }),
    at: Date.now()
  };

  Board.applyResult(c.mode, c.dateKey, entry, c.won, function (ok, err) {
    c.busy = false;
    if (!ok) {
      if (errBox) errBox.textContent = '❌ 上榜失败：' + (err || '未知错误');
      return;
    }
    if (c.onDone) c.onDone(true);
    const box = document.getElementById('chalBody');
    if (box) {
      box.innerHTML = '<div class="chal-done"><div class="chal-big ok">🏆 上榜成功！</div>' +
        '<div class="chal-line">你排第 <b>' + c.finalRank + '</b> 名，名字是「' + boardEsc(name.trim()) + '」</div>' +
        '<div class="chal-btns"><button class="btn primary" id="chalView">看看排行榜</button></div></div>';
      document.getElementById('chalView').addEventListener('click', function () {
        document.getElementById('chalModal').style.display = 'none';
        boardOpen(c.mode, c.dateKey);
      });
    }
  });
}

/* 结束挑战弹层 */
function chalFinish(done) {
  const c = BUI.ch;
  const m = document.getElementById('chalModal');
  if (m) m.style.display = 'none';
  if (c && c.onDone) c.onDone(!!done);
  BUI.ch = null;
}
