'use strict';
/* ============================================================
 *  server.js — 局域网联机服务器（Node，零第三方依赖）
 *
 *  双击「开服.bat」即可启动。它干两件事：
 *    ① 把 html/js/css 发给同一 WiFi 下的其他人（静态文件服务）
 *    ② 当裁判：持有全部对局状态，收玩家操作，广播结果
 *
 *  为什么需要它：file:// 打开的页面在网络上没有地址，别人够不着。
 *  只有单机模式时完全不需要这个文件。
 *
 *  启动：node server.js [端口]      默认 8000
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCore } = require('./js/node-loader.js');

const ROOT = __dirname;
const ARGV = process.argv.slice(2);

/* 参数：node server.js [端口] [--seed=XXXX] */
let seedArg = null;
let PORT = 8000;
for (const a of ARGV) {
  if (/^--seed=/.test(a)) seedArg = a.slice(7);
  else if (/^--port=/.test(a)) PORT = parseInt(a.slice(7), 10);
  else if (/^\d+$/.test(a)) PORT = parseInt(a, 10);
}
if (process.env.PORT) PORT = parseInt(process.env.PORT, 10);

/* 装载浏览器全局那套核心（data/pack/relics/engine/game/melee/online）
 * 它们互相直接引用全局名，所以必须整体求值，不能单个 require */
const CORE = loadCore(path.join(ROOT, 'js'));
const { OnlineGame, MELEE_CFG, packSelf, rosterOf, RNG } = CORE;

/* ------------------------------------------------------------
 *  房间：当前只有一个房间（局域网朋友局足够）
 *
 *  种子：服务器是权威，随机数全走 RNG。给房间定一个种子有两个用处：
 *    · 界面上能显示"这一局的种子"，出问题了能复现
 *    · 命令行传 --seed=xxx 时，整局完全可复现（测试/排查用）
 * ---------------------------------------------------------- */
let roomSeed = seedArg;                 // 有值 = 固定种子（命令行指定）
let game = null;
let generation = 1;

function newRoom() {
  const seed = roomSeed || RNG.randomSeed();
  RNG.seed(seed);
  const g = new OnlineGame();
  g.seed = seed;
  return g;
}
game = newRoom();

/* ------------------------------------------------------------
 *  静态文件
 * ---------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 防目录穿越
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }

  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ------------------------------------------------------------
 *  工具
 * ---------------------------------------------------------- */
function sendJSON(res, obj, code) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, cb) {
  let raw = '';
  let tooBig = false;
  req.on('data', function (c) {
    raw += c;
    if (raw.length > 64 * 1024) { tooBig = true; req.destroy(); }
  });
  req.on('end', function () {
    if (tooBig) return cb(new Error('body too large'));
    if (!raw) return cb(null, {});
    try { cb(null, JSON.parse(raw)); }
    catch (e) { cb(e); }
  });
  req.on('error', function () { cb(new Error('request error')); });
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name: name, ip: a.address });
    }
  }
  return out;
}

/* ------------------------------------------------------------
 *  长轮询：把请求挂住，直到有新事件或超时
 * ---------------------------------------------------------- */
const POLL_INTERVAL = 60;      // ms
const POLL_TIMEOUT = parseInt(process.env.SAP_POLL_TIMEOUT || '15000', 10);

function handlePoll(req, res, query) {
  const seat = game.seatByToken(query.token);
  if (!seat) { sendJSON(res, { ok: false, msg: '座位不存在', gone: true }); return; }

  const since = parseInt(query.since || '0', 10) || 0;
  const gen = generation;
  const deadline = Date.now() + POLL_TIMEOUT;

  const finish = function (payload) {
    clearInterval(timer);
    if (res.writableEnded || res.destroyed) return;
    sendJSON(res, payload);
  };

  const timer = setInterval(function () {
    if (gen !== generation) { finish({ ok: true, reset: true }); return; }
    if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }

    // 事件被裁剪过 → 让客户端重新拉一次完整快照
    if (game.events.length && since < game.events[0].seq - 1) {
      finish({ ok: true, reset: true });
      return;
    }
    const evs = game.eventsSince(seat.idx, since);
    if (evs.length) {
      finish({ ok: true, seq: game.seq, events: evs });
      return;
    }
    if (Date.now() >= deadline) {
      finish({ ok: true, seq: game.seq, events: [] });   // 空转，客户端立刻再拉
    }
  }, POLL_INTERVAL);

  req.on('close', function () { clearInterval(timer); });
}

/* ------------------------------------------------------------
 *  路由
 * ---------------------------------------------------------- */
const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const query = {};
  u.searchParams.forEach(function (v, k) { query[k] = v; });

  /* ---- 探测：前端靠它决定要不要显示「联机」入口 ---- */
  if (p === '/api/ping') {
    sendJSON(res, {
      ok: true, online: true,
      phase: game.phase,
      players: game.remoteSeats().length,
      seats: MELEE_CFG.COUNT,
      seed: game.seed || null
    });
    return;
  }

  if (p === '/api/poll' && req.method === 'GET') { handlePoll(req, res, query); return; }

  if (p === '/api/join' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false, msg: '请求格式错误' }); return; }
      const r = game.addPlayer(body.name);
      sendJSON(res, r);
    });
    return;
  }

  if (p === '/api/rejoin' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false, msg: '请求格式错误' }); return; }
      const r = game.rejoin(body.token);
      sendJSON(res, r);
    });
    return;
  }

  if (p === '/api/action' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false, msg: '请求格式错误' }); return; }
      const r = game.action(body.token, body.action || {});
      // 顺带把最新的「自己那份」回给本人，商店操作零等待
      const seat = game.seatByToken(body.token);
      if (seat && seat.game) r.you = packSelf(seat.game, seat);
      if (seat) r.roster = rosterOf(game.seats);
      sendJSON(res, r);
    });
    return;
  }

  if (p === '/api/start' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false, msg: '请求格式错误' }); return; }
      const seat = game.seatByToken(body.token);
      if (!seat) { sendJSON(res, { ok: false, msg: '你不在这个房间里' }); return; }
      // 只有第一个加入的真人能开局
      const first = game.remoteSeats()[0];
      if (!first || first.idx !== seat.idx) {
        sendJSON(res, { ok: false, msg: '只有房主能开始游戏' });
        return;
      }
      sendJSON(res, game.start());
    });
    return;
  }

  if (p === '/api/restart' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false, msg: '请求格式错误' }); return; }
      const seat = game.seatByToken(body.token);
      if (!seat) { sendJSON(res, { ok: false, msg: '你不在这个房间里' }); return; }
      game = newRoom();
      generation++;
      log('新的一局开始，房间已重置（种子 ' + game.seed + '）');
      sendJSON(res, { ok: true, msg: '房间已重置', seed: game.seed });
    });
    return;
  }

  if (p === '/api/leave' && req.method === 'POST') {
    readBody(req, function (err, body) {
      if (err) { sendJSON(res, { ok: false }); return; }
      game.setConnected(body.token, false);
      sendJSON(res, { ok: true });
    });
    return;
  }

  /* ---- 其余全部当静态文件 ---- */
  serveStatic(req, res, p);
});

/* ------------------------------------------------------------
 *  启动
 * ---------------------------------------------------------- */
function log(msg) { console.log('  ' + msg); }

server.listen(PORT, '0.0.0.0', function () {
  const lines = [];
  lines.push('');
  lines.push('  🐾 Super Auto Pets · 局域网联机服务器已启动');
  lines.push('  ' + '-'.repeat(46));
  lines.push('  自己玩（本机）:   http://localhost:' + PORT);
  const lan = lanAddresses();
  if (lan.length) {
    lines.push('  发给朋友（局域网）:');
    for (const a of lan) lines.push('      http://' + a.ip + ':' + PORT + '   [' + a.name + ']');
  } else {
    lines.push('  ⚠️  没检测到局域网 IP，确认一下网络连接');
  }
  lines.push('  ' + '-'.repeat(46));
  lines.push('  别人打开上面任意一个地址，输入昵称即可加入房间。');
  lines.push('  人不够时剩下的座位会自动由电脑补位。');
  lines.push('  关掉这个窗口 = 服务器停止，大家都会掉线。');
  lines.push('');
  console.log(lines.join('\n'));
});

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.log('\n  ❌ 端口 ' + PORT + ' 已被占用。换个端口试试：');
    console.log('     node server.js 8001\n');
  } else {
    console.log('\n  ❌ 服务器启动失败：' + e.message + '\n');
  }
  process.exit(1);
});

process.on('SIGINT', function () {
  console.log('\n  服务器已停止。\n');
  process.exit(0);
});
