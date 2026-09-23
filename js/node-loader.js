'use strict';
/* ============================================================
 *  node-loader.js — 服务器专用：把「浏览器全局脚本」装进一个作用域
 *
 *  为什么不能用 require：
 *  这些文件在浏览器里靠 <script> 顺序共享全局（melee.js 里直接用
 *  Game / runBattle / CFG，并没有 import）。单独 require 任何一个
 *  都会 ReferenceError。
 *
 *  做法：按浏览器的加载顺序把源码拼起来，用 new Function 求值，
 *  再把需要的符号取出来。等价于浏览器的加载语义。
 *
 *  ⚠️ 浏览器永远不需要这个文件，它只被 server.js 使用。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* ⚠️ 顺序必须和浏览器里的依赖顺序一致（online.js 最后，它依赖前面全部） */
const CORE_FILES = ['rng.js', 'data.js', 'pack.js', 'relics.js', 'engine.js', 'game.js', 'melee.js', 'online.js'];

/* 服务端要用到的符号 */
const EXPORTS = [
  'PETS', 'FOODS', 'RELICS', 'RELIC_IDS', 'CFG', 'MELEE_CFG', 'EXP_BONUS',
  'petName', 'setPerk',
  'makePet', 'clonePet', 'cloneTeam', 'runBattle', 'Battle',
  'Game', 'ShopEnv', 'Fighter', 'Melee',
  'petCostOf', 'rollCostOf', 'buyablePool', 'PACKS', 'packOf', 'activePack',
  'relicSum', 'rollRelics', 'applyRelicTurnStart', 'applyRelicBattleStart',
  'petToJSON', 'petFromJSON', 'packSelf', 'gameFromPack', 'rosterOf',
  'OnlineGame', 'Seat', 'RNG'
];

let cached = null;

/* 装载核心（结果缓存，避免每次请求都重新求值） */
function loadCore(dir) {
  if (cached) return cached;
  const base = dir || __dirname;
  const src = CORE_FILES.map(function (f) {
    return '\n/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(base, f), 'utf8');
  }).join('\n;\n');

  const fn = new Function(src + '\n;return {' + EXPORTS.join(', ') + '};');
  cached = fn();
  return cached;
}

module.exports = { loadCore: loadCore, CORE_FILES: CORE_FILES, EXPORTS: EXPORTS };
