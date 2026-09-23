'use strict';
/* ============================================================
 *  net.js — 联机网络层（浏览器）
 *
 *  三件事：
 *   1. 探测这台机器上有没有联机服务器（/api/ping）
 *   2. 加入房间 / 断线重连（凭证存在 localStorage）
 *   3. 长轮询收事件 —— 服务器挂着请求，有新事件立刻返回
 *
 *  所有地址都用相对路径，所以换 IP、换端口都不用改代码。
 * ============================================================ */

const NET = {
  token: null,
  seat: -1,
  name: '',
  since: 0,
  online: false,        // 探测到服务器了吗
  polling: false,
  stopped: false,
  fails: 0,
  onEvent: null,        // function (data) {}
  onStatus: null        // function (text, isError) {}
};

const NET_LS_KEY = 'sap_online_token';

function netStatus(text, isError) {
  if (NET.onStatus) NET.onStatus(text, !!isError);
}

/* ---- 探测服务器 ---- */
NET.ping = function () {
  return fetch('api/ping', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      // 静态托管上通常返回 404 或者一份 HTML，必须校验内容而不是只看状态码
      NET.online = !!(j && j.online === true);
      NET.serverPhase = (j && j.phase) || 'lobby';
      NET.serverPlayers = (j && j.players) || 0;
      return NET.online;
    })
    .catch(function () { NET.online = false; NET.serverPhase = ''; return false; });
};

NET.post = function (path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(function (r) { return r.json(); })
    .catch(function () { return { ok: false, msg: '连不上服务器' }; });
};

/* ---- 加入房间 ---- */
NET.join = function (name) {
  return NET.post('api/join', { name: name }).then(function (r) {
    if (r.ok) {
      NET.token = r.token;
      NET.seat = r.seat;
      NET.name = r.name;
      try { localStorage.setItem(NET_LS_KEY, r.token); } catch (e) {}
    }
    return r;
  });
};

/* ---- 刷新页面后重连（同一个座位、同一份状态） ---- */
NET.rejoin = function () {
  let token = null;
  try { token = localStorage.getItem(NET_LS_KEY); } catch (e) {}
  if (!token) return Promise.resolve({ ok: false, msg: '没有保存的凭证' });
  NET.token = token;
  return NET.post('api/rejoin', { token: token }).then(function (r) {
    if (r.ok) { NET.seat = r.seat; NET.name = r.name; }
    else { NET.token = null; try { localStorage.removeItem(NET_LS_KEY); } catch (e) {} }
    return r;
  });
};

NET.forget = function () {
  NET.token = null; NET.seat = -1; NET.since = 0;
  try { localStorage.removeItem(NET_LS_KEY); } catch (e) {}
};

/* ---- 发操作 ---- */
NET.act = function (action) {
  if (!NET.token) return Promise.resolve({ ok: false, msg: '还没加入房间' });
  return NET.post('api/action', { token: NET.token, action: action });
};
NET.start = function () {
  return NET.post('api/start', { token: NET.token });
};
NET.restart = function () {
  return NET.post('api/restart', { token: NET.token });
};

/* ---- 长轮询循环 ---- */
NET.startPolling = function () {
  if (NET.polling) return;
  NET.polling = true;
  NET.stopped = false;
  netStatus('');
  pollOnce();
};

function pollOnce() {
  if (NET.stopped || !NET.token) { NET.polling = false; return; }

  fetch('api/poll?token=' + encodeURIComponent(NET.token) + '&since=' + NET.since,
        { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      NET.fails = 0;
      if (j && j.gone) {
        // 服务器重置了房间，凭证失效 → 回大厅重新加入
        NET.forget();
        if (NET.onEvent) NET.onEvent({ t: 'kicked' });
        NET.polling = false;
        return;
      }
      if (j && j.reset) {
        // 事件被裁剪或房间换了 → 重新拉完整快照
        NET.rejoin().then(function (r) {
          if (r.ok && NET.onEvent) NET.onEvent(r.snapshot);
          else if (NET.onEvent) NET.onEvent({ t: 'kicked' });
          if (NET.token) pollOnce(); else NET.polling = false;
        });
        return;
      }
      if (j && j.seq != null) NET.since = j.seq;
      for (const ev of (j.events || [])) {
        if (NET.onEvent) NET.onEvent(ev.data);
      }
      pollOnce();
    })
    .catch(function () {
      NET.fails++;
      if (NET.fails === 3) netStatus('⚠️ 与服务器连接不稳定，正在重试…', true);
      if (NET.fails > 40) {
        netStatus('❌ 与服务器断开了，请刷新页面重试', true);
        NET.polling = false;
        return;
      }
      setTimeout(pollOnce, Math.min(3000, 300 * NET.fails));
    });
}

NET.stopPolling = function () {
  NET.stopped = true;
  NET.polling = false;
};

/* 关页面时告诉服务器（这样别人就不用等这个挂机的人） */
NET.leave = function () {
  if (!NET.token) return;
  try {
    const blob = new Blob([JSON.stringify({ token: NET.token })], { type: 'application/json' });
    navigator.sendBeacon('api/leave', blob);
  } catch (e) {}
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NET: NET };
}
