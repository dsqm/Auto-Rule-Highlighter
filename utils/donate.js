// 捐赠提醒（Donate Nudge）
// 触发条件：网站规则 ≥ 5 条，或单个网站的关键词 ≥ 5 个；
// 且在当前页面「可见停留」累计满 2 秒后弹出（切到后台标签页时不计时）。
// 依赖：Storage（utils/storage.js）。需在 options.js 之前引入。
var DonateKit = (function () {
  'use strict';

  // ---- 可调参数 ----
  var DONATE_URL = 'https://docs.qq.com/aio/DRWtMY3FQS0ZHRGRG?p=qIniwAv5QQjaAipgIvwLF5';
  var RULE_THRESHOLD = 5;                    // 网站规则数阈值（≥ 此值触发）
  var KEYWORD_THRESHOLD = 5;                 // 单个网站的关键词数阈值（≥ 此值触发）
  var DWELL_MS = 2000;                       // 页面可见停留时长阈值
  var TICK_MS = 200;                         // 计时器节拍
  var RECHECK_MS = 1000;                     // 停留达标后，重新评估规则规模的最小间隔
  var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 点「去看看」后的冷却期（7 天）

  var timer = null;
  var dwelled = 0;      // 累计可见停留时长
  var lastTick = 0;
  var nextCheck = 0;    // 下次允许评估规则规模的时间戳
  var shown = false;    // 本次页面会话是否已弹过
  var stopped = false;
  var onVisibility = null;

  /** 统计规则规模：规则总数、关键词总数、单个网站的关键词数上限、是否达到提醒门槛 */
  function evaluate(rules) {
    var list = rules || [];
    var totalKeywords = 0;
    var maxKeywords = 0;
    for (var i = 0; i < list.length; i++) {
      var n = (list[i].keywords || []).length;
      totalKeywords += n;
      if (n > maxKeywords) maxKeywords = n;
    }
    return {
      ruleCount: list.length,
      totalKeywords: totalKeywords,
      maxKeywords: maxKeywords,
      triggered: list.length >= RULE_THRESHOLD || maxKeywords >= KEYWORD_THRESHOLD
    };
  }

  /** 是否已被关掉：永久关闭（不再提示），或处于「去看看」后的冷却期 */
  function isDismissed(settings) {
    var s = settings || {};
    if (s.donateDismissed === true) return true;
    var last = s.donateLastVisitAt || 0;
    return last > 0 && (Date.now() - last) < COOLDOWN_MS;
  }

  /** 合并读取再写入，避免整体覆盖把其他页面维护的字段冲掉 */
  async function patchSettings(patch) {
    var current = await Storage.getSettings();
    await Storage.saveSettings(Object.assign({}, current, patch));
  }

  function openDonatePage() {
    try {
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: DONATE_URL });
        return;
      }
    } catch (e) { /* 退回 window.open */ }
    window.open(DONATE_URL, '_blank', 'noopener');
  }

  /** 弹窗第一行统计：N 个网站自动规则 共 M 个关键词 */
  function buildSummary(stats) {
    return stats.ruleCount + ' 个网站自动规则 共 ' + stats.totalKeywords + ' 个关键词';
  }

  /**
   * 停表。注意：必须声明成具名函数而在下面导出为 stop，
   * 否则模块内部调用 stop() 会沿作用域链找到 window.stop（浏览器的停止加载 API）。
   */
  function stopTimer() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (onVisibility) {
      document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    }
  }

  function showModal(stats) {
    if (shown) return;
    shown = true;
    stopTimer();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'donateOverlay';
    overlay.innerHTML =
      '<div class="modal donate-modal" role="dialog" aria-modal="true" aria-labelledby="donateTitle">' +
        '<button class="donate-close" id="donateClose" type="button" title="关闭" aria-label="关闭">×</button>' +
        '<h3 id="donateTitle">用着还顺手吗？</h3>' +
        '<p class="donate-desc">您已经配置了 <b>' + buildSummary(stats) + '</b></p>' +
        '<p class="donate-desc">扩展是完全免费的，如果愿意<br>' +
        '可以请作者喝杯咖啡或单纯过去看看<br>' +
        '支持作者继续维护下去</p>' +
        '<div class="modal-actions">' +
          '<button class="btn" id="donateDismiss" type="button">不再提示</button>' +
          '<button class="btn btn-donate" id="donateGo" type="button">去看看</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // 只有右上角的 × 是「仅关闭本次」，不写入任何状态，下次打开设置页仍会提醒。
    // 刻意不支持点击灰底关闭：误点灰底会直接跳过提醒，用户必须明确做出选择。
    function close() {
      overlay.remove();
    }

    overlay.querySelector('#donateClose').addEventListener('click', close);

    overlay.querySelector('#donateDismiss').addEventListener('click', function () {
      patchSettings({ donateDismissed: true }).catch(function () {});
      close();
    });

    overlay.querySelector('#donateGo').addEventListener('click', function () {
      patchSettings({ donateLastVisitAt: Date.now() }).catch(function () {});
      openDonatePage();
      close();
    });

    var goBtn = overlay.querySelector('#donateGo');
    if (goBtn) goBtn.focus();
  }

  function tick(now) {
    var dt = now - lastTick;
    lastTick = now;
    // 只有页面可见时才累计停留时长；切到别的标签页/最小化时不计时
    if (document.visibilityState === 'visible') dwelled += dt;
    if (dwelled < DWELL_MS) return;
    if (shown || stopped || now < nextCheck) return;
    // 正开着别的弹窗（增删规则/管理关键词等）时不打扰，等它关掉后下一拍再弹
    if (document.querySelector('.modal-overlay')) return;
    nextCheck = now + RECHECK_MS;

    Storage.getRules().then(function (rules) {
      if (shown || stopped) return null;
      var stats = evaluate(rules);
      if (!stats.triggered) return null;
      return Storage.getSettings().then(function (settings) {
        if (shown || stopped) return;
        if (isDismissed(settings)) { stopTimer(); return; }
        showModal(stats);
      });
    }).catch(function () {});
  }

  return {
    DONATE_URL: DONATE_URL,
    RULE_THRESHOLD: RULE_THRESHOLD,
    KEYWORD_THRESHOLD: KEYWORD_THRESHOLD,
    DWELL_MS: DWELL_MS,
    COOLDOWN_MS: COOLDOWN_MS,

    evaluate: evaluate,
    isDismissed: isDismissed,

    /** 在设置页启动停留计时。已永久关闭或处于冷却期时不会启动计时器 */
    async start() {
      if (timer) return;
      var settings = await Storage.getSettings().catch(function () { return {}; });
      if (isDismissed(settings)) return;

      stopped = false;
      shown = false;
      dwelled = 0;
      nextCheck = 0;
      lastTick = Date.now();
      // 后台标签页的定时器会被节流到分钟级，回到前台时重置基准，
      // 否则隐藏期间的那段时间会被误算成「停留」
      onVisibility = function () {
        if (document.visibilityState === 'visible') lastTick = Date.now();
      };
      document.addEventListener('visibilitychange', onVisibility);
      timer = setInterval(function () { tick(Date.now()); }, TICK_MS);
    },

    /** 停止计时（已弹出或页面不再需要提醒时调用） */
    stop: stopTimer,

    /** 规则有增删时调用：让达标后的检查立刻生效，不必等下一个 RECHECK 周期 */
    touch: function () {
      nextCheck = 0;
    },

    /** 供调试/测试：重置全部状态 */
    _reset: function () {
      stopTimer();
      stopped = false;
      shown = false;
      dwelled = 0;
      nextCheck = 0;
    }
  };
})();
