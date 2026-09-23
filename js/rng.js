'use strict';
/* ============================================================
 *  rng.js — 可控随机源
 *
 *  为什么需要它：项目里原本有 18 处直接调 Math.random()，散在 6 个文件里。
 *  这样没法「重现」—— 出了 bug 只能反复重试等它复现，测试也只能跑很多局
 *  碰运气。全部改走 RNG 之后：
 *
 *   · 同一个种子 + 同样的操作 = 完全相同的一局
 *   · 每日挑战（所有人同一局）
 *   · 把种子发给朋友，玩同一局
 *   · 测试变成确定性的（失败能重放）
 *
 *  用法：
 *    RNG.seed('ABC123');   // 之后所有随机都来自这个流
 *    RNG.next()            // [0,1)
 *    RNG.int(5)            // [0,5) 的整数
 *    RNG.pick(arr)         // 随机取一个元素
 *    RNG.clear()           // 回到真随机
 *
 *  ⚠️ 不受种子影响的随机（必须保持真随机）：
 *     —— 联机凭证 token 的生成。所有玩家的 token 必须有区别，
 *        不能因为同一个种子就撞在一起。
 * ============================================================ */

const RNG = (function () {

  /* 种子的字符集：去掉了容易看混的 0/O/1/I，方便口头念给别人 */
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* 字符串种子 → 32 位整数（FNV-1a） */
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* mulberry32：小、快、分布够好，适合游戏。
   * 同样的 a 一定产出同样的数列。 */
  function mulberry32(a) {
    let s = a >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let _fn = null;         // 有种子时的随机函数；null = 用 Math.random
  let _seedStr = null;
  let _count = 0;         // 消耗了几个随机数（调试/测试用）

  const api = {
    /* 取一个 [0,1)。没设种子时等价于 Math.random() */
    next: function () {
      _count++;
      return _fn ? _fn() : Math.random();
    },

    /* [0,n) 的整数 */
    int: function (n) {
      return Math.floor(api.next() * n);
    },

    /* 从数组里随机取一个 */
    pick: function (arr) {
      return arr[api.int(arr.length)];
    },

    /* 用种子初始化（同一个种子 → 同一串随机数） */
    seed: function (s) {
      _seedStr = String(s);
      _count = 0;
      _fn = mulberry32(hash(_seedStr));
      return _seedStr;
    },

    /* 回到真随机 */
    clear: function () {
      _fn = null;
      _seedStr = null;
      _count = 0;
    },

    /* 随机生成一个便于口头分享的种子（6 位）
     * ⚠️ 这里直接用 Math.random —— 它是种子的来源，本身不该被种子影响 */
    randomSeed: function () {
      let s = '';
      for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      return s;
    },

    /* 本地日期 → 每日挑战的种子（同一天所有人一样） */
    dailySeed: function (d) {
      const t = d || new Date();
      const mm = String(t.getMonth() + 1).padStart(2, '0');
      const dd = String(t.getDate()).padStart(2, '0');
      return 'daily-' + t.getFullYear() + '-' + mm + '-' + dd;
    },

    current: function () { return _seedStr; },
    isSeeded: function () { return _fn !== null; },
    count: function () { return _count; },

    /* 导出内部实现，方便单测 */
    hash: hash,
    mulberry32: mulberry32
  };

  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RNG: RNG };
}
