'use strict';
/* ============================================================
 *  board.js — 排行榜（Firebase Firestore）
 *
 *  三个榜：classic（经典）/ melee（8 人混战）/ daily-YYYY-MM-DD（每日挑战）
 *  联机模式不做。
 *
 *  ------------------------------------------------------------
 *  结构：一个榜一个文档，整份读写
 *
 *    leaderboard/{docId}
 *      entries: [ { rank, name, owner, score, team, at }, ... ]   // 最多 10 条
 *      updatedAt: 时间戳
 *
 *  为什么"一榜一文档"而不是"一条记录一文档"：
 *    · 读一次就拿全榜，省请求
 *    · 挑战是"从末位往上爬"，必须看到完整榜单才能算名次
 *    · 代价：并发提交时后者覆盖前者。个人项目规模下可以接受。
 *
 *  每日榜：docId 直接带日期（daily-2026-09-25），所以【不需要删除权限】——
 *  今天读今天的，明天自动读新的，旧的自然作废。
 *
 *  ------------------------------------------------------------
 *  ⚠️ 离线 / 加载失败要能降级
 *  Firebase SDK 是从 gstatic 拉的，被墙或断网时脚本根本加载不出来。
 *  那种情况下 Board.ready 保持 false，UI 把排行榜入口置灰，
 *  【单机玩不受任何影响】。
 * ============================================================ */

/* ---------- 配置 ---------- */
const BOARD_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const BOARD_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBl3lAWVbRRKxT_fhqQxdFPLyKYMmIe_-I',
  authDomain: 'super-auto-pets-2c6c5.firebaseapp.com',
  projectId: 'super-auto-pets-2c6c5',
  storageBucket: 'super-auto-pets-2c6c5.firebasestorage.app',
  messagingSenderId: '725787041774',
  appId: '1:725787041774:web:11e5a1a6a7fec5c546b8ff'
};
const BOARD_COLLECTION = 'leaderboard';
const BOARD_MAX = 10;

/* ============================================================
 *  一、纯逻辑（不碰网络，可以单独测）
 * ============================================================ */

/* 宠物包：两个包【各一张榜】。
 * ⚠️ 为什么必须按包分：一局只能用【一个】包（pack.js 的铁律），两个包混进同一个
 *    池子会把重复率砍半、合成升级几乎不可能。所以龟包和星包玩家打的根本不是
 *    同一个游戏 —— 宠物池完全不相交（龟 61 / 星 77）、强度基准不同，
 *    混在一张榜上比名次没有意义。
 *    每日挑战更明显：同一天、两个包的每日内容完全不同，却挤在同一张 daily-xxx 上。 */
const BOARD_PACKS = ['turtle', 'star'];
const BOARD_PACK_CN = { turtle: '龟包', star: '星包' };
const BOARD_PACK_ICON = { turtle: '🐢', star: '⭐' };

/* 包名归一化：认不出来的（没传 / 拼错）一律当龟包 —— 龟包是本作默认包 */
function boardPackKey(pack) {
  const p = String(pack == null ? '' : pack).trim();
  return BOARD_PACKS.indexOf(p) >= 0 ? p : 'turtle';
}

/* 榜单文档 id：模式 + 日期（每日）+ 宠物包
 *   classic-turtle   · classic-star
 *   melee-turtle     · melee-star
 *   daily-2026-09-25-turtle · daily-2026-09-25-star
 *
 * ⚠️ 这一版把宠物包加进了 id，所以旧的 classic / melee / daily-xxx 文档不会再被读到。
 *    那批文档上没有包信息，没法判断每条记录属于哪个包，迁移不了 —— 直接废弃。
 *
 * ⚠️ 每日挑战的 dateKey 来自 RNG.dailySeed()，它【本身就带 'daily-' 前缀】
 *    （形如 daily-2026-09-25）。这里要兼容"带前缀"和"不带前缀"两种传法，
 *    否则会拼成 daily-daily-2026-09-25。 */
function boardKey(mode, dateKey, pack) {
  const p = boardPackKey(pack);
  if (mode !== 'daily') return mode + '-' + p;
  const d = String(dateKey == null ? '' : dateKey).trim();
  if (!d) return 'daily-unknown-' + p;
  return (d.indexOf('daily-') === 0 ? d : ('daily-' + d)) + '-' + p;
}

/* 挑战完榜上 N 个人、赢了 won 场之后，我排第几？
 *
 *   榜上 3 人，第一场就输 → 第 4
 *   榜上 3 人，赢 1 场     → 第 3
 *   榜上 3 人，全赢        → 第 1
 *   榜上 0 人              → 第 1（没人可打，直接上榜）
 *
 * 也就是「你打赢了几个，就排在他们前面」。 */
function boardRankAfter(total, won) {
  const n = Math.max(0, total | 0);
  const w = Math.max(0, Math.min(won | 0, n));
  return n - w + 1;
}

/* 把 entry 插进第 rank 名：后面的人整体后移，超出 10 名的掉出。
 * 同一个 owner 的旧记录会先被移除（同一玩家只占一个位置）。 */
function boardInsert(entries, entry, rank, max) {
  max = max || BOARD_MAX;
  const list = (entries || []).filter(function (e) {
    return e && e.owner !== entry.owner;      // 先摘掉自己的旧记录
  });
  const idx = Math.max(0, Math.min((rank | 0) - 1, list.length));
  list.splice(idx, 0, entry);
  return list.slice(0, max).map(function (e, i) {
    const o = {};
    for (const k in e) o[k] = e[k];
    o.rank = i + 1;                            // 重排名次
    return o;
  });
}

/* 名字在榜上是否已被别人占用 */
function boardNameTaken(entries, name, myOwner) {
  const n = String(name || '').trim();
  if (!n) return false;
  return (entries || []).some(function (e) {
    return e && e.name === n && e.owner !== myOwner;
  });
}

/* 本机 id —— 用来认「哪些记录是我的」（可以改名、不会占两个位置）
 * 纯前端没有账号，所以它绑在这个浏览器上：换设备/清缓存会认不出自己，
 * 但不影响上榜。 */
const BOARD_OWNER_KEY = 'sap_board_owner';
function boardOwnerId() {
  let id = null;
  try { id = localStorage.getItem(BOARD_OWNER_KEY); } catch (e) {}
  if (!id) {
    id = 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    try { localStorage.setItem(BOARD_OWNER_KEY, id); } catch (e) {}
  }
  return id;
}

/* 把一局的结果整理成榜单要存的 score */
function boardScoreOf(mode, game) {
  if (!game) return {};
  if (mode === 'melee') {
    return { hp: game.hp || 0, turns: game.turn || 1 };
  }
  return { wins: game.wins || 0, losses: game.losses || 0, turns: game.turn || 1 };
}

/* 榜单上一行的成绩文案（三种模式格式不同） */
function boardScoreText(mode, sc) {
  if (!sc) return '';
  if (mode === 'melee') return '剩 ' + (sc.hp || 0) + ' 血 · ' + (sc.turns || 0) + ' 回合';
  return (sc.wins || 0) + ' 胜 ' + (sc.losses || 0) + ' 败 · ' + (sc.turns || 0) + ' 回合';
}

/* 挑战一场：我的阵容 vs 榜上那套阵容。
 * 走的是和正式战斗完全一样的引擎，所以结果一致。 */
function boardFight(myTeam, foeTeamJson) {
  if (typeof runBattle !== 'function') return null;
  const mine = (myTeam || []).map(function (p) {
    return (p && p.defId !== undefined && typeof petToJSON === 'function') ? p : petFromJSON(p);
  });
  const foe = (foeTeamJson || []).map(petFromJSON);
  if (!mine.length || !foe.length) return null;
  return runBattle(mine, foe);
}

/* 写入 Firestore 前清洗数据。
 *
 * ⚠️ Firestore【不接受 undefined】—— 直接报
 *    "Unsupported field value: undefined"。
 *    而 petToJSON 会产出 swallowed: undefined 这类字段（鲸鱼没吞东西时就是），
 *    所以必须过一遍 JSON 往返把 undefined 丢掉。
 *    这个坑是端到端测试抓出来的：单元测试 mock 了写入，看不出来。
 *
 * 单独抽成函数是为了能被测试直接覆盖（写在 submit 里就没法单独测了）。 */
function boardCleanForStore(entries) {
  return JSON.parse(JSON.stringify({
    entries: entries || [],
    updatedAt: Date.now()
  }));
}

/* 把 Firestore 的错误翻译成人话。
 *
 * ⚠️ 实测反馈：玩家网络正常、却打不开排行榜，界面只显示
 *    "Failed to get document because the client is offline."
 *    —— 这是 SDK 的说法，玩家完全不知道什么意思，还会以为自己断网了。
 *
 *    真正的原因通常是 firestore.googleapis.com 访问不到：
 *      · 国内直连普遍不通（这个最常见）
 *      · 代理没开 / 代理规则没覆盖这个域名
 *      · 被浏览器插件（广告拦截之类）拦了
 *    所以这里翻译成能看懂、而且照着能做的事。 */
function boardFriendlyError(e) {
  const msg = String((e && e.message) || e || '');
  if (/offline|unavailable|Failed to fetch|network|ECONN|timeout|deadline/i.test(msg)) {
    return '连不上排行榜服务器。这个功能用的是 Google 的 Firestore' +
           '（firestore.googleapis.com），国内直连通常访问不了 —— ' +
           '开代理再试，或者换个网络。';
  }
  if (/permission|PERMISSION_DENIED|insufficient/i.test(msg)) {
    return '排行榜服务器拒绝了这次请求（Firestore 安全规则的问题）。';
  }
  return msg || '未知错误';
}

/* ============================================================
 *  二、Firebase 层（懒加载 + 离线降级）
 * ============================================================ */
const Board = {
  ready: false,
  loading: false,
  error: '',
  db: null,
  _waiters: [],

  /* 动态加载 SDK —— 只在真的要用排行榜时才拉，不拖慢游戏启动 */
  init: function (cb) {
    if (Board.ready) { if (cb) cb(true); return; }
    if (cb) Board._waiters.push(cb);
    if (Board.loading) return;
    Board.loading = true;

    function done(ok, err) {
      Board.ready = ok;
      Board.error = err || '';
      Board.loading = false;
      const ws = Board._waiters.slice();
      Board._waiters.length = 0;
      ws.forEach(function (f) { try { f(ok); } catch (e) {} });
    }

    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(BOARD_FIREBASE_CONFIG);
        Board.db = firebase.firestore();
        done(true);
      } catch (e) { done(false, e.message); }
      return;
    }

    let left = 2;
    function one() { if (--left === 0) finish(); }
    function fail() { done(false, 'SDK 加载失败（可能没网或被拦截）'); }

    const s1 = document.createElement('script');
    s1.src = BOARD_SDK + 'firebase-app-compat.js';
    s1.onload = one; s1.onerror = fail;
    document.head.appendChild(s1);

    const s2 = document.createElement('script');
    s2.src = BOARD_SDK + 'firebase-firestore-compat.js';
    s2.onload = one; s2.onerror = fail;
    document.head.appendChild(s2);

    function finish() {
      try {
        firebase.initializeApp(BOARD_FIREBASE_CONFIG);
        Board.db = firebase.firestore();
        done(true);
      } catch (e) { done(false, e.message); }
    }
  },

  /* 读一个榜 → cb(entries 或 null, err)
   * ⚠️ pack 要和 boardKey 的参数顺序保持一致，否则很容易漏传成「读错榜」 */
  fetch: function (mode, dateKey, pack, cb) {
    Board.init(function (ok) {
      if (!ok) { cb(null, Board.error || '排行榜不可用'); return; }
      Board.db.collection(BOARD_COLLECTION).doc(boardKey(mode, dateKey, pack)).get()
        .then(function (doc) {
          const d = doc && doc.exists ? doc.data() : null;
          cb((d && d.entries) || [], '');
        })
        .catch(function (e) { cb(null, boardFriendlyError(e)); });
    });
  },

  /* 整份写入 → cb(ok, err) */
  submit: function (mode, dateKey, pack, entries, cb) {
    Board.init(function (ok) {
      if (!ok) { cb(false, Board.error || '排行榜不可用'); return; }
      const payload = boardCleanForStore(entries);
      Board.db.collection(BOARD_COLLECTION).doc(boardKey(mode, dateKey, pack))
        .set(payload)
        .then(function () { cb(true, ''); })
        .catch(function (e) { cb(false, boardFriendlyError(e)); });
    });
  },

  /* 读 → 算 → 写（挑战流程用） */
  applyResult: function (mode, dateKey, pack, entry, won, cb) {
    Board.fetch(mode, dateKey, pack, function (entries, err) {
      if (!entries) { cb(false, err); return; }
      const rank = boardRankAfter(entries.length, won);
      if (rank > BOARD_MAX) { cb(false, '没进前 ' + BOARD_MAX + ' 名'); return; }
      const next = boardInsert(entries, entry, rank);
      Board.submit(mode, dateKey, pack, next, cb);
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Board: Board, boardKey: boardKey, boardRankAfter: boardRankAfter,
    boardInsert: boardInsert, boardNameTaken: boardNameTaken,
    boardScoreOf: boardScoreOf, boardScoreText: boardScoreText, boardFight: boardFight,
    boardCleanForStore: boardCleanForStore, boardFriendlyError: boardFriendlyError,
    boardPackKey: boardPackKey, BOARD_PACKS: BOARD_PACKS,
    BOARD_PACK_CN: BOARD_PACK_CN, BOARD_PACK_ICON: BOARD_PACK_ICON,
    BOARD_MAX: BOARD_MAX
  };
}
