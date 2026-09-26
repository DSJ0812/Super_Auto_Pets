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
  pack: 'turtle',      // 看哪个包的榜（两个包宠物池不相交，榜必须分开）
  entries: null,
  loading: false,
  err: '',

  /* 挑战流程的状态 */
  ch: null
};

/* 模式显示名 */
const BOARD_MODE_CN = { classic: '经典模式', melee: '8 人混战', daily: '每日挑战' };
const BOARD_MODE_ICON = { classic: '🎯', melee: '⚔️', daily: '📅' };
/* 包名和图标在 board.js 里（BOARD_PACK_CN / BOARD_PACK_ICON / BOARD_PACKS） */

/* 包开关按钮 */
function boardPackTabsHtml() {
  let s = '';
  for (const p of BOARD_PACKS) {
    s += '<span class="bp-btn' + (p === BUI.pack ? ' on' : '') + '" data-bpack="' + p + '">' +
         BOARD_PACK_ICON[p] + ' ' + BOARD_PACK_CN[p] + '</span>';
  }
  return s;
}

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
      /* 宠物包：一局只能用【一个】包，两个包的宠物池完全不相交（龟 61 / 星 77），
       * 强度基准不同 —— 混在一张榜上比名次没有意义，所以榜也按包分开。 */
      '<div class="board-packs" id="boardPacks">' +
        '<span class="bp-label">宠物包</span>' +
        boardPackTabsHtml() +
        '<span class="bp-hint">两个包的宠物池不一样，分开排名</span>' +
      '</div>' +
      '<div class="board-body" id="boardBody"></div>' +
    '</div>';
  document.body.appendChild(wrap);

  wrap.addEventListener('click', function (e) {
    if (e.target === wrap) boardClose();
    const tab = e.target.closest ? e.target.closest('.howto-tab') : null;
    if (tab && tab.dataset.btab) boardSwitch(tab.dataset.btab);
    const pk = e.target.closest ? e.target.closest('.bp-btn') : null;
    if (pk && pk.dataset.bpack) boardSwitchPack(pk.dataset.bpack);
    const row = e.target.closest ? e.target.closest('[data-brow]') : null;
    if (row && row.dataset.brow !== undefined) boardShowDetail(Number(row.dataset.brow));
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

  /* 阵容详情弹层：榜单上点一行就打开
   * ⚠️ 这里【不复用】render.js 的 petCard —— 主页（index.html）不加载 render.js。
   *    详情只依赖 petart.js（图标）+ data.js（名字/技能）+ relics.js（遗物），
   *    这三个文件三个页面都加载了，所以一份实现到处都能用。 */
  const dw = document.createElement('div');
  dw.id = 'bdModal';
  dw.className = 'howto-modal';
  dw.style.zIndex = '960';                 // 盖在榜单弹层上面
  dw.innerHTML =
    '<div class="howto-box bd-box">' +
      '<div class="howto-head">' +
        '<span class="howto-title" id="bdTitle">阵容详情</span>' +
        '<span class="howto-close" id="bdClose">✕</span>' +
      '</div>' +
      '<div class="bd-body" id="bdBody"></div>' +
    '</div>';
  document.body.appendChild(dw);
  dw.addEventListener('click', function (e) { if (e.target === dw) boardCloseDetail(); });
  document.getElementById('bdClose').addEventListener('click', boardCloseDetail);
}

/* ------------------------------------------------------------
 *  阵容详情
 * ---------------------------------------------------------- */

/* 单只宠物：图标 / 中文名 / 等级 / 攻血 / 道具 / 技能 */
function boardDetailPetHtml(p) {
  const def = (typeof PETS !== 'undefined' && PETS[p.defId]) ? PETS[p.defId] : null;
  const lvl = p.lvl || 1;
  const name = def ? (def.cn || def.name || p.defId) : p.defId;
  const skill = (def && def.texts) ? (def.texts[lvl - 1] || def.texts[0] || '') : '';
  let perks = '';
  for (const pk of (p.perks || [])) {
    if (pk.uses > 0) {
      perks += '<span class="bd-perk" title="' + boardEsc(perkCn(pk.id)) + '">' +
               perkIcon(pk.id) + '</span>';
    }
  }
  return '<div class="bd-pet" data-tier="' + ((def && def.tier) || 0) + '">' +
    '<div class="bd-pet-top">' +
      '<span class="bd-emoji">' + petArtHtml(p.defId) + '</span>' +
      '<span class="bd-lvl">' + lvl + ' 级</span>' +
    '</div>' +
    '<div class="bd-name">' + boardEsc(name) + '</div>' +
    '<div class="bd-stats"><b class="atk">' + p.atk + '</b><i>/</i><b class="hp">' + p.hp + '</b></div>' +
    (perks ? '<div class="bd-perks">' + perks + '</div>' : '') +
    (skill ? '<div class="bd-skill" title="' + boardEsc(skill) + '">' + boardEsc(skill) + '</div>' : '') +
  '</div>';
}

/* 遗物一行 */
function boardDetailRelicsHtml(ids) {
  if (!ids || !ids.length) return '<span class="bd-none">这一局没有遗物</span>';
  let s = '';
  for (const id of ids) {
    const r = (typeof RELICS !== 'undefined' && RELICS[id]) ? RELICS[id] : null;
    if (!r) { s += '<span class="bd-relic" title="' + boardEsc(id) + '">❔</span>'; continue; }
    s += '<span class="bd-relic" title="' + boardEsc(r.cn + '：' + r.desc) + '">' +
         r.icon + '<b>' + boardEsc(r.cn) + '</b></span>';
  }
  return s;
}

function boardDetailHtml(e) {
  const team = e.team || [];
  const relics = e.relics || [];
  let pets = '';
  for (const p of team) pets += boardDetailPetHtml(p);
  return '<div class="bd-head">' +
      '<span class="bd-mode">' + BOARD_MODE_ICON[BUI.mode] + ' ' + BOARD_MODE_CN[BUI.mode] + '</span>' +
      '<span class="bd-pack">' + BOARD_PACK_ICON[BUI.pack] + ' ' + BOARD_PACK_CN[BUI.pack] + '</span>' +
      '<span class="bd-score">' + boardEsc(boardScoreText(BUI.mode, e.score)) + '</span>' +
    '</div>' +
    '<div class="bd-sec"><span class="bd-sec-t">遗物</span>' + boardDetailRelicsHtml(relics) + '</div>' +
    '<div class="bd-sec"><span class="bd-sec-t">阵容</span></div>' +
    '<div class="bd-team">' + (pets || '<span class="bd-none">没有阵容数据</span>') + '</div>' +
    '<div class="bd-foot">阵容、等级、道具、遗物都是通关那一刻的快照' +
      '；挑战时会按这份快照完整还原（含遗物和阵营羁绊）。</div>';
}

function boardShowDetail(idx) {
  const e = (BUI.entries || [])[idx];
  if (!e) return;
  boardEnsureDom();
  const t = document.getElementById('bdTitle');
  if (t) t.textContent = '第 ' + (e.rank || (idx + 1)) + ' 名 · ' + (e.name || '无名');
  const b = document.getElementById('bdBody');
  if (b) b.innerHTML = boardDetailHtml(e);
  const m = document.getElementById('bdModal');
  if (m) m.style.display = 'flex';
}

function boardCloseDetail() {
  const m = document.getElementById('bdModal');
  if (m) m.style.display = 'none';
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
function boardOpen(mode, dateKey, pack) {
  boardEnsureDom();
  BUI.mode = mode || 'classic';
  BUI.dateKey = dateKey || null;
  /* 没指定包就跟主页当前选的包走（玩家在主页选了星包，进来看的自然是星包榜） */
  BUI.pack = boardPackKey(pack || (typeof activePack === 'function' ? activePack() : 'turtle'));
  boardSyncTabs();
  boardShow();
  boardLoad();
}

/* tab 和包开关的高亮同步（两处都要，别只更新一边） */
function boardSyncTabs() {
  const tabs = document.querySelectorAll('#boardTabs .howto-tab');
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('on', tabs[i].dataset.btab === BUI.mode);
  }
  const pks = document.querySelectorAll('#boardPacks .bp-btn');
  for (let i = 0; i < pks.length; i++) {
    pks[i].classList.toggle('on', pks[i].dataset.bpack === BUI.pack);
  }
}

function boardSwitch(mode) {
  BUI.mode = mode;
  boardSyncTabs();
  boardLoad();
}

/* 切换宠物包 —— 换的是另一张榜，不是同一张榜的过滤 */
function boardSwitchPack(pack) {
  BUI.pack = boardPackKey(pack);
  boardSyncTabs();
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

  Board.fetch(BUI.mode, dateKey, BUI.pack, function (entries, err) {
    if (entries == null) {
      body.innerHTML = '<div class="board-msg bad">😕 排行榜暂时连不上<br>' +
        '<span class="board-sub">' + boardEsc(err || '') + '</span><br>' +
        '<span class="board-sub">不影响你继续玩单机</span><br>' +
        '<button class="btn tiny" id="boardRetry" style="margin-top:12px">🔄 重试</button></div>';
      const rb = document.getElementById('boardRetry');
      if (rb) rb.addEventListener('click', function () {
        /* 重试时把 SDK 状态也重置 —— 有时候是首次加载脚本就失败了 */
        Board.ready = false;
        Board.loading = false;
        Board.error = '';
        boardLoad();
      });
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
    '<span class="bh-pack">' + BOARD_PACK_ICON[BUI.pack] + ' ' + BOARD_PACK_CN[BUI.pack] + '专属榜</span>' +
    (BUI.mode === 'daily'
      ? '<span class="bh-date">' + boardEsc(String(BUI.dateKey).replace('daily-', '').replace('-' + BUI.pack, '')) + ' · 每天一个榜</span>'
      : '<span class="bh-date">累计榜，不按天清空</span>') +
    '</div>';

  if (!entries.length) {
    body.innerHTML = head + '<div class="board-msg">这个榜上还没有人<br>' +
      '<span class="board-sub">' + boardHowToGetOn() + '</span></div>';
    return;
  }

  let html = head + '<div class="board-list">';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const medal = e.rank === 1 ? '🥇' : (e.rank === 2 ? '🥈' : (e.rank === 3 ? '🥉' : ''));
    /* 整行可点 → 打开阵容详情（道具 / 遗物 / 技能都在详情里看） */
    html += '<div class="board-row clickable' + (e.rank <= 3 ? ' top' + e.rank : '') +
      '" data-brow="' + i + '" title="点开看这套阵容的详细资料">' +
      '<span class="br-rank">' + (medal || ('#' + e.rank)) + '</span>' +
      '<span class="br-name">' + boardEsc(e.name || '') + '</span>' +
      '<span class="br-score">' + boardEsc(boardScoreText(BUI.mode, e.score)) + '</span>' +
      '<span class="br-team">' + boardTeamIcons(e.team) + '</span>' +
      '</div>';
  }
  html += '</div>';
  html += '<div class="board-foot">' + boardHowToGetOn() +
    '<br><span class="board-sub">点榜单上的任意一行，可以看那套阵容的完整资料（等级 / 道具 / 遗物 / 技能）</span></div>';
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
  const pk = BOARD_PACK_CN[BUI.pack] || '';
  if (BUI.mode === 'melee') return '用' + pk + '打 8 人混战，吃鸡后就有机会上榜';
  if (BUI.mode === 'daily') return '用' + pk + '完成当天的每日挑战（10 胜）后，就有机会上榜';
  return '用' + pk + '通关经典模式（10 胜）后，就有机会上榜';
}

/* ------------------------------------------------------------
 *  挑战流程
 * ---------------------------------------------------------- */

/* 达成条件后调用。
 * ⚠️ 参数是【一个对象】而不是一长串位置参数：这里要带的东西越来越多
 *    （模式 / 阵容 / 成绩 / 日期 / 宠物包 / 遗物），位置参数太容易传错顺序，
 *    而传错顺序的后果是「默默记到别的榜上」或者「阵容少一半」。
 *
 * opts = { mode, team, relics, score, dateKey, pack, onDone }
 *
 * ⚠️ 【立刻快照】：team / relics 传进来的是活引用（g.team / g.relics），
 *    这里马上用 petToJSON 拍成纯数据。之后不管游戏对象怎么变，
 *    挑战用的始终是「通关那一刻」的阵容。
 *    以前传的就是活引用，靠「通关后玩家没得操作」这个巧合才没出错；
 *    而 board-ui.js 里那个 c.teamJson 字段当初就是为此预留的，一直空着没人写。 */
function boardOfferChallenge(opts) {
  opts = opts || {};
  boardEnsureDom();
  const pack = boardPackKey(opts.pack || (typeof activePack === 'function' ? activePack() : 'turtle'));
  BUI.ch = {
    mode: opts.mode || 'classic',
    dateKey: opts.dateKey || null,
    pack: pack,
    /* 纯数据快照 —— 挑战全程只读这一份 */
    teamJson: (opts.team || []).map(function (p) {
      if (typeof petToJSON !== 'function') return p;
      return (p && p.defId !== undefined && p.hp !== undefined) ? petToJSON(p) : p;
    }),
    /* 遗物也要快照：遗物 id 是字符串，直接复制数组即可 */
    relics: (opts.relics || []).slice(),
    score: opts.score || {},
    entries: null,
    won: 0,
    /* ⚠️ 名字叫 foeIdx 而不是 idx：回放器会往它自己的 state 上写 idx（回放进度），
     *    以前两边共用一个字段，打赢一场之后这个「打第几名」就被回放进度覆盖了。 */
    foeIdx: 0,
    busy: false,
    fightOver: false,          // 这一场是否已经收尾过（防重复推进，见 chalAfterFight）
    play: null,                // 回放器自己的状态（view / log / idx / timer / mySide）
    onDone: opts.onDone || function () {}
  };
  const cw = document.getElementById('chalModal');
  cw.style.display = 'flex';
  chalRenderIntro();
}

/* 挑战用的我方阵容（每次开打都从快照重建 → 一次性道具一定回到「有的时候」） */
function chalMyTeam() {
  const c = BUI.ch;
  if (!c) return [];
  return (c.teamJson || []).map(petFromJSON);
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

  Board.fetch(c.mode, c.dateKey, c.pack, function (entries, err) {
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
    c.foeIdx = entries.length - 1;    // 从最后一名开始
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
  const foe = c.entries[c.foeIdx];
  if (!foe) { chalRenderDone(true); return; }

  chalSetBody(
    '<div class="chal-next">' +
      '<div class="chal-prog">第 <b>' + (c.won + 1) + '</b> 场 · 对手是第 <b>' + foe.rank + '</b> 名' +
        '<span class="dim">（榜上共 ' + c.entries.length + ' 人）</span></div>' +
      '<div class="chal-vs">' +
        '<div class="chal-side"><div class="cs-label">你的阵容</div>' +
          '<div class="cs-team">' + boardTeamIcons(c.teamJson) + '</div>' +
          (c.relics && c.relics.length
            ? '<div class="cs-relics">' + boardDetailRelicsHtml(c.relics) + '</div>' : '') +
        '</div>' +
        '<div class="chal-vsmark">VS</div>' +
        '<div class="chal-side"><div class="cs-label">' + boardEsc(foe.name || '') + '</div>' +
          '<div class="cs-team">' + boardTeamIcons(foe.team) + '</div>' +
          '<div class="cs-score">' + boardEsc(boardScoreText(c.mode, foe.score)) + '</div></div>' +
      '</div>' +
      '<div class="chal-line dim">双方都按通关时的完整阵容打：等级、道具、遗物、阵营羁绊全都在，' +
        '每一场开打前都会恢复到完整状态。</div>' +
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
  c.fightOver = false;              // 新一场开打：允许收尾（见 chalAfterFight）
  const foe = c.entries[c.foeIdx];

  /* ⚠️ 每一场都从【纯数据快照】重建双方的完整阵容，然后重新套遗物和阵营羁绊：
   *    · 我方：c.teamJson（通关那一刻拍的快照）→ petFromJSON
   *    · 对手：榜条目里的 team（本来就是纯数据）→ petFromJSON
   *    · prepareBattleTeams(c.relics, mine, foe.relics, foePets)
   *    这样一次性道具（辣椒 / 大蒜）在上一场用掉之后，打下一个人的时候
   *    又回到「有的时候」—— 双方都是。
   *    （引擎内部还会 cloneTeam，所以这里改的是「这一场专用」的副本。） */
  const mine = chalMyTeam();
  const foePets = (foe.team || []).map(petFromJSON);
  if (typeof prepareBattleTeams === 'function') {
    prepareBattleTeams(c.relics, mine, foe.relics, foePets);
  }

  /* ⚠️ 把【已经套好加成】的双方交给 boardFight。
   *    boardFight 对「已经是宠物对象」的输入会直接使用，不会再重建一遍 ——
   *    如果这里传的还是原始 JSON，上面那两行就白套了。 */
  const r = boardFight(mine, foePets);
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
  /* ⚠️ 用 onclick 赋值而不是 addEventListener：这个按钮是【静态元素】
   *    （建弹层时创建一次，不在 innerHTML 里重建），每开打一场都会走到这里。
   *    用 addEventListener 的话 handler 会一场一场地累积，玩家点一次
   *    「跳过动画」会被触发 N 次。 */
  if (sk) sk.onclick = function () { player.skip(); };

  /* ⚠️ 回放器要一个【自己的】状态对象，不能把挑战流程的 c 直接交给它。
   *    BattlePlayer.start 会写 state.idx（回放进度）—— 而挑战流程的 c 上
   *    原本也有一个 idx（打第几名），两边含义完全不同，会互相覆盖：
   *    实测症状是「打赢第一个对手之后，第二个对手直接找不到，挑战崩掉」。
   *    混战（MUI）和联机（OUI）的 idx 本来就只给回放用，所以只有这里会撞。
   *    （挑战流程的字段也已经改名成 foeIdx，两道保险。） */
  c.play = {};
  player.start(c.play, r.log, mine, foePets, '挑战：' + (foe.name || ''), { mySide: 0, winner: r.winner });
}

function chalShowArena(foe) {
  const a = document.getElementById('chalArena');
  if (a) a.style.display = '';
  /* 战斗阶段把弹层盒子撑到和正式战斗一样的宽度（见 css .chal-box.fighting） */
  const box = document.querySelector('#chalModal .chal-box');
  if (box) box.classList.add('fighting');
  const fl = document.getElementById('chalFoeLabel');
  if (fl) fl.textContent = '对手 · 第 ' + foe.rank + ' 名「' + (foe.name || '') + '」';
  const al = document.getElementById('chalArenaLabel');
  if (al) al.textContent = '第 ' + (BUI.ch.won + 1) + ' 场';
}
function chalHideArena() {
  const a = document.getElementById('chalArena');
  if (a) a.style.display = 'none';
  const box = document.querySelector('#chalModal .chal-box');
  if (box) box.classList.remove('fighting');
  const fr = document.getElementById('chalFoeRow'); if (fr) fr.innerHTML = '';
  const mr = document.getElementById('chalMyRow'); if (mr) mr.innerHTML = '';
}

/* 回放播完（或被跳过）之后：判胜负、推进流程
 * ⚠️ 用 fightOver 做「这一场已经收尾过」的守卫，并且【收尾后不重置】——
 *    重置的动作放在 chalDoFight（每场开打时清一次）。
 *    以前的写法是在推进分支里把 finished 设回 false，结果同一场只要收尾跑两遍
 *    （回放器重复 finish、或玩家点「跳过动画」触发了多个累积的 handler），
 *    c.idx 就会被减两次，挑战会莫名其妙跳过一个对手。 */
function chalAfterFight() {
  const c = BUI.ch;
  if (!c || c.fightOver) return;
  c.fightOver = true;
  chalHideArena();
  const foe = c.lastFoe;

  if (c.lastWin) {
    c.won++;
    if (c.foeIdx === 0) { chalRenderDone(true); return; }   // 全赢
    c.foeIdx--;
    chalRenderWinThenNext(foe);
  } else {
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
    /* c.teamJson 已经是「通关那一刻」的纯数据快照（boardOfferChallenge 里拍的），
     * 直接存。以前这里是在【提交的这一刻】才转换，中间队伍要是变了就记错了。 */
    team: (c.teamJson || []).slice(),
    /* 遗物也存下来 —— 挑战时对手要按这份列表还原它的开战效果 */
    relics: (c.relics || []).slice(),
    at: Date.now()
  };

  Board.applyResult(c.mode, c.dateKey, c.pack, entry, c.won, function (ok, err) {
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
        boardOpen(c.mode, c.dateKey, c.pack);
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
