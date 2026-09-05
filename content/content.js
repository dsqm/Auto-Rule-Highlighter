(function () {
  var HIGHLIGHT_TAG = 'ah-mark';
  var RAIL_TAG = 'ah-rail';

  var isInIframe = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  var currentRules = [];
  var currentSettings = {};
  var railEl = null;
  var activeHighlight = null;
  var bodyObserver = null;
  var shadowObservers = [];
  var isHighlighting = false;
  var railUpdateTimer = null;
  var tempKeywords = [];
  var hiddenKwIds = [];
  var manualShowKwIds = [];
  // 临时高亮生效范围（设置项）：page=仅当前页面，tab=跟随标签页，global=全局。
  // 只影响「新增关键词交给谁保管」：page 留在本页内存，其余两种上报后台
  var tempScope = 'tab';
  var cachedKeywordMap = null;
  var cachedKeywordMapTime = 0;
  var CACHE_TTL = 100;
  var railMarkTargets = [];
  var railMarkMap = new WeakMap();
  var batchTextNodes = null;
  var BATCH_SIZE = 200;
  var batchNearBoundary = 0;
  var batchNearHookDone = false;
  var batchGeneration = 0;
  var keywordGlobalOrder = {};
  var exclusiveStopOrder = -1;
  var pageDisabled = false;
  var highlightEverApplied = false;
  // 匹配组号：跨元素匹配会把一次命中拆成多个 mark（如 关<span>键</span>词 -> 三段），
  // 同一命中的所有片段共享一个组号，计数 / 跳转以「一次完整命中」为单位
  var matchGroupCounter = 0;
  var domOrderCache = new WeakMap();
  var domOrderCounter = 0;
  var pendingRehighlight = false;
  var VIEWPORT_THRESHOLD = 2;
  var lazyHighlightTimer = null;
  var LAZY_HIGHLIGHT_DELAY = 300;
  var isLazyHighlighting = false;
  var forceFullHighlight = false;
  var pendingNavigation = null;
  var pendingIncremental = false;

  function getSafeRect(el) {
    try {
      if (!el || !el.isConnected) return null;
      var rect = el.getBoundingClientRect();
      if (!rect || rect.width === 0 && rect.height === 0) return null;
      if (typeof rect.top !== 'number' || isNaN(rect.top)) return null;
      return rect;
    } catch (e) {
      return null;
    }
  }

  // 文档坐标缓存：滚动不改变文档坐标，缓存后滚动期间 rail 重排不再每个 mark 量一次 rect
  var elTopCache = new WeakMap();

  function invalidateElTopCache() {
    elTopCache = new WeakMap();
  }

  function getElTopPosition(el) {
    if (elTopCache.has(el)) return elTopCache.get(el);
    var rect = getSafeRect(el);
    var top;
    if (rect) {
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
      top = scrollTop + rect.top;
    } else {
      var order = domOrderCache.get(el);
      if (typeof order !== 'number') {
        order = domOrderCounter++;
        domOrderCache.set(el, order);
      }
      top = order;
    }
    elTopCache.set(el, top);
    return top;
  }

  function isElementNearViewport(el) {
    if (forceFullHighlight) return true;
    if (!el || !el.isConnected) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return false;
      var viewH = window.innerHeight;
      var threshold = VIEWPORT_THRESHOLD * viewH;
      return rect.bottom > -threshold && rect.top < viewH + threshold;
    } catch (e) {
      return true;
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'APPLY_HIGHLIGHT') {
      applyHighlight(msg.rules || [], msg.settings || {});
    }
    // 临时高亮由后台统一持有（按标签页持久化），这里只接收后台广播的结果并渲染
    if (msg.type === 'SYNC_TEMP_STATE') {
      if (msg.scope) tempScope = msg.scope;
      // 切到「仅当前页面」时的单纯范围通知：页面现有的临时高亮不动
      if (msg.keepLocal) return;
      applyTempState(msg.keywords || [], msg.hiddenIds || []);
    }
    if (msg.type === 'CLEAR_TEMP') {
      applyTempState([], []);
    }
    if (msg.type === 'SET_HIDDEN_IDS') {
      hiddenKwIds = msg.hiddenIds || [];
      manualShowKwIds = msg.manualShowIds || [];
      applyVisibility();
    }
    if (msg.type === 'TOGGLE_PAGE_DISABLED') {
      pageDisabled = msg.disabled === true;
      if (pageDisabled) {
        removeHighlights();
      } else {
        reHighlight();
      }
      sendResponse({ success: true });
    }
    if (msg.type === 'GET_HIGHLIGHT_COUNT') {
      // 与角标 / 箭头跳转共用 collectVisibleGroups 分组，保证三个数字永远一致
      var groups = collectVisibleGroups(getAllHighlightMarks(), undefined);
      var keywordMap = {};
      var kwOrders = {};
      var kwExclusive = {};
      var visibleTotal = 0;
      for (var gi = 0; gi < groups.length; gi++) {
        var g0 = groups[gi][0];
        var kwId = g0.dataset.ahKeywordId;
        visibleTotal++;
        if (!keywordMap[kwId]) keywordMap[kwId] = 0;
        keywordMap[kwId]++;
        if (g0.dataset.ahGlobalOrder !== undefined) {
          kwOrders[kwId] = parseInt(g0.dataset.ahGlobalOrder, 10);
        }
        if (g0.dataset.ahExclusive !== undefined) {
          kwExclusive[kwId] = g0.dataset.ahExclusive === '1';
        }
      }
      sendResponse({
        total: visibleTotal,
        byKeyword: keywordMap,
        hiddenIds: hiddenKwIds,
        manualShowIds: manualShowKwIds,
        exclusiveStopOrder: exclusiveStopOrder,
        kwOrders: kwOrders,
        kwExclusive: kwExclusive,
        pageDisabled: pageDisabled
      });
      return true;
    }
    // 「仅当前页面」范围下后台不持有临时高亮，弹窗读取时由后台逐 frame 收集这里的数据
    if (msg.type === 'GET_TEMP_KEYWORDS') {
      sendResponse(tempKeywords);
      return true;
    }
    if (msg.type === 'GET_HIDDEN_IDS') {
      sendResponse(hiddenKwIds);
      return true;
    }
    if (msg.type === 'NAV_MARK') {
      // 关键词导航改由 background 跨 frame 协调后走 NAV_MARK_AT，这里只处理「高亮此处」定位
      if (msg.kwId && msg.kwId.indexOf('spot_') === 0) navigateToSpotMark(msg.kwId);
    }
    if (msg.type === 'NAV_MARK_AT') {
      navigateToMarkAt(msg.kwId, msg.localIndex, msg.globalIndex, msg.globalTotal, msg.isRetry === true);
    }
    if (msg.type === 'GET_KW_COUNT') {
      sendResponse({ count: getVisibleKwGroups(msg.kwId).length });
      return true;
    }
    if (msg.type === 'CONTEXT_ADD_HIGHLIGHT') {
      var selText = msg.text;
      if (!selText) return;
      var kw = buildTempKeyword(selText);
      // 先交给后台落盘，再由广播回传渲染；内容脚本不本地 push，避免与后台状态各写一份
      reportTempKeyword(kw, function (ok) {
        var settingsResp = {};
        try { settingsResp = currentSettings || {}; } catch (e2) {}
        sendResponse({ count: ok ? 1 : 0, settings: settingsResp });
      });
      return true;
    }
    if (msg.type === 'CONTEXT_SPOT_HIGHLIGHT') {
      var spotSelText = msg.text;
      if (!spotSelText) return;
      var spotStyle = getNextSpotStyle();
      var spotId = CommonKit.uid('s_', 5);
      // 所有片段在创建时已统一带上 spotId，无需兄弟反查
      highlightSelectedRange(spotSelText, spotStyle, spotId);
      try {
        // 存完整样式（含自动黑白等文字配置），popup 预览/编辑才能还原
        chrome.runtime.sendMessage({ type: 'STORE_SPOT_HIGHLIGHT', spotId: spotId, text: spotSelText, style: spotStyle });
      } catch (e) {}
      var spotSettingsResp = {};
      try { spotSettingsResp = currentSettings || {}; } catch (e4) {}
      sendResponse({ settings: spotSettingsResp });
    }
    if (msg.type === 'SHORTCUT_ADD_HIGHLIGHT') {
      var selText = window.getSelection().toString();
      if (!selText) return;
      var kw = buildTempKeyword(selText);
      reportTempKeyword(kw, function (ok) {
        if (!ok) return;
        try {
          chrome.runtime.sendMessage({ type: 'SHORTCUT_HIGHLIGHT_DONE', action: 'add' });
        } catch (e) {}
      });
    }
    if (msg.type === 'SHORTCUT_SPOT_HIGHLIGHT') {
      var spotSelText = window.getSelection().toString();
      if (!spotSelText) return;
      var spotStyle = getNextSpotStyle();
      var spotId = CommonKit.uid('s_', 5);
      // 所有片段在创建时已统一带上 spotId，无需兄弟反查
      highlightSelectedRange(spotSelText, spotStyle, spotId);
      try {
        // 存完整样式（含自动黑白等文字配置），popup 预览/编辑才能还原
        chrome.runtime.sendMessage({ type: 'STORE_SPOT_HIGHLIGHT', spotId: spotId, text: spotSelText, style: spotStyle });
        chrome.runtime.sendMessage({ type: 'SHORTCUT_HIGHLIGHT_DONE', action: 'spot' });
      } catch (e) {}
    }
    if (msg.type === 'DELETE_SPOT') {
      removeSpotHighlight(msg.spotId);
    }
    if (msg.type === 'UPDATE_SPOT_STYLE') {
      updateSpotStyle(msg.spotId, msg.style || {});
    }
  });

  init();

  function init() {
    chrome.runtime.sendMessage({ type: 'IS_PAGE_DISABLED' }, function (resp) {
      if (resp && resp.disabled) {
        pageDisabled = true;
      }
      requestRulesFromBackground();
    });
  }

  /** 页面加载时拉取本标签页的临时高亮（关键词 + 隐藏态），跨网页后据此恢复 */
  function requestTempState(done) {
    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      done();
    };
    // 兜底：后台迟迟不回也不能把整页高亮卡住，先按现有状态渲染
    var timer = setTimeout(finish, 1500);
    try {
      chrome.runtime.sendMessage({ type: 'GET_TEMP_STATE' }, function (resp) {
        clearTimeout(timer);
        var late = settled;
        if (!chrome.runtime.lastError && resp) {
          tempScope = CommonKit.normalizeTempScope(resp.scope);
          tempKeywords = Array.isArray(resp.keywords) ? resp.keywords : [];
          hiddenKwIds = Array.isArray(resp.hidden) ? resp.hidden : [];
        }
        finish();
        // 回得比兜底计时还晚：首次渲染已经跑完了，补一次重建把临时高亮画出来
        if (late && tempKeywords.length > 0) reHighlight();
      });
    } catch (e) {
      clearTimeout(timer);
      finish();
    }
  }

  /**
   * 运行中同步后台广播下来的临时高亮状态。
   * 只替换 tmp_ 前缀的隐藏态，规则关键词的手动隐藏不受影响。
   */
  function applyTempState(keywords, tempHidden) {
    var kept = [];
    for (var i = 0; i < hiddenKwIds.length; i++) {
      if (!CommonKit.isTempKwId(hiddenKwIds[i])) kept.push(hiddenKwIds[i]);
    }
    var nextHidden = kept.concat(tempHidden || []);
    // 关键词和隐藏态都没变就是空转，直接跳过（广播会打到每个 frame，重复拆建代价高）。
    // 隐藏态变了必须重建：隐藏的临时关键词不生成 mark，取消隐藏时没有旧 mark 可以复用
    if (JSON.stringify(keywords) === JSON.stringify(tempKeywords) &&
        JSON.stringify(nextHidden) === JSON.stringify(hiddenKwIds)) {
      return;
    }
    hiddenKwIds = nextHidden;
    tempKeywords = keywords;
    reHighlight();
  }

  function buildTempKeyword(text) {
    return {
      id: CommonKit.uid('tmp_', 5),
      text: text,
      matchType: 'contains',
      caseSensitive: false,
      acrossElements: false,
      color: getRandomDistinctColor()
    };
  }

  /**
   * 新增临时关键词。
   * 「仅当前页面」范围下后台不保管，直接留在页面内存里（刷新即随文档回收）；
   * 其余范围交给后台按标签页 / 全局落盘，再由广播回传渲染。
   */
  function reportTempKeyword(kw, done) {
    if (tempScope === 'page') {
      tempKeywords.push(kw);
      reHighlight();
      done(true);
      return;
    }
    chrome.runtime.sendMessage({ type: 'ADD_TEMP_KEYWORD', keyword: kw }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok) { done(false); return; }
      done(true);
    });
  }

  function requestRulesFromBackground() {
    chrome.runtime.sendMessage({ type: 'GET_MATCHED_RULES', url: location.href }, function (response) {
      if (chrome.runtime.lastError) {
        setTimeout(requestRulesFromBackground, 1500);
        return;
      }
      var rules = response || [];
      // 即使没有匹配规则也要拿设置：currentSettings 里存着预设（含自动黑白），
      // 否则「高亮此处」在无规则页面上取不到预设样式
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, function (settings) {
        if (chrome.runtime.lastError) settings = {};
        // 先用设置里的范围兜底：requestTempState 拉回权威值前，右键添加也要走对分支
        tempScope = CommonKit.normalizeTempScope(settings && settings.tempScope);
        // 先恢复临时关键词再统一渲染：临时高亮按标签页保留，跨网页后要能一次画全，
        // 若先渲染规则再补临时词，整页会被拆建两次
        requestTempState(function () {
          // 必须传局部变量：applyHighlight 要拿 rules 与 currentRules（旧值）对比，
          // 若先把结果写回 currentRules 再传自身，unchanged 恒为 true，首次高亮会被短路
          applyHighlight(rules, settings || {});
        });
      });
    });
  }

  // ---- 运行时样式类：每个去重样式生成一条 .ah-kw-N 规则，mark 只写 class 不写内联样式。
  //      大量 mark 时省掉每元素 8 次内联样式写入与样式重算，这是密集页面的主要开销 ----
  var dynCssParts = [];
  var dynStyleVersion = 0;
  var dynStyleEl = null;
  var styleClassMap = {};

  function ensureDynStyleEl() {
    if (dynStyleEl && dynStyleEl.isConnected) return;
    dynStyleEl = document.getElementById('ah-dyn-styles');
    if (!dynStyleEl || !dynStyleEl.isConnected) {
      dynStyleEl = document.createElement('style');
      dynStyleEl.id = 'ah-dyn-styles';
      (document.head || document.documentElement).appendChild(dynStyleEl);
    }
  }

  function styleClassFor(style) {
    var key = StyleKit.serialize(style);
    if (styleClassMap[key] !== undefined) return 'ah-kw-' + styleClassMap[key];
    var idx = dynCssParts.length;
    styleClassMap[key] = idx;
    var decls = [];
    if (style.bgColor) {
      decls.push('background-color:' + style.bgColor, 'padding:0', 'border-radius:2px');
    } else {
      decls.push('background-color:transparent', 'padding:0', 'border-radius:0');
    }
    decls.push('color:' + StyleKit.resolveTextColor(style));
    if (style.fontSize && style.fontSize !== 1) decls.push('font-size:' + style.fontSize + 'em');
    if (style.bold) decls.push('font-weight:700');
    if (style.italic) decls.push('font-style:italic');
    var deco = StyleKit.decorationOf(style);
    if (deco) decls.push('text-decoration:' + deco);
    dynCssParts.push('.ah-kw-' + idx + '{' + decls.join(';') + '}');
    dynStyleVersion++;
    ensureDynStyleEl();
    dynStyleEl.textContent = dynCssParts.join('');
    return 'ah-kw-' + idx;
  }

  /** 高亮开始前为全部关键词预注册样式类，保证 shadow root 注入样式时规则已齐全 */
  function registerKeywordClasses(keywords) {
    for (var i = 0; i < keywords.length; i++) {
      styleClassFor(StyleKit.resolveStyle(keywords[i], currentSettings));
    }
  }

  /** 当前临时高亮状态签名：用于 applyHighlight 防重入比较（临时词可能在两次调用之间到达） */
  function tempStateSig() {
    return JSON.stringify([tempKeywords, hiddenKwIds, manualShowKwIds]);
  }
  var lastRenderedTempSig = '';

  function applyHighlight(rules, settings) {
    // 弹窗每次打开都会触发 REFRESH_HIGHLIGHT；规则与设置都没变时跳过重建，
    // 否则已有高亮被全部拆掉后只有视口附近会懒加载恢复，导航会退化成只看到 1 条。
    // 但「从未应用过高亮」时必须执行，否则首次加载即被短路，整个页面永远不高亮。
    // 注意必须把临时关键词状态一起比较：后台 onUpdated 广播往往赶在 GET_TEMP_STATE
    // 响应之前先渲染一遍（temp=0），响应到达后若只比 rules/settings 会被误判为「没变」，
    // 临时高亮就永远画不出来了
    var tempSig = tempStateSig();
    var unchanged = highlightEverApplied &&
      currentRules.length === rules.length &&
      JSON.stringify(currentRules) === JSON.stringify(rules) &&
      JSON.stringify(currentSettings) === JSON.stringify(settings) &&
      tempSig === lastRenderedTempSig;
    currentRules = rules;
    currentSettings = settings;
    if (unchanged) return;
    highlightEverApplied = true;
    lastRenderedTempSig = tempSig;
    // 规则或设置刚变过，样式缓存必须失效，否则会拿旧样式渲染新配置
    invalidateStyleMap();
    if (pageDisabled) return;

    var keywords = getActiveKeywords();
    if (keywords.length === 0) {
      var existingMarks = getAllHighlightMarks();
      if (existingMarks.length > 0) removeHighlights();
      updateBadge();  // 角标按 frame 各自上报，iframe 命中也计入
      return;
    }

    removeHighlights();
    if (typeof Matcher === 'undefined') return;

    registerKeywordClasses(keywords);
    injectStylesToAllShadowRoots();

    isHighlighting = true;
    highlightBatch(keywords, 0);
  }

  function injectStylesToAllShadowRoots() {
    // documentElement 的 TreeWalker 已覆盖 body 子树，无需重复遍历
    var walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_ELEMENT);
    var el;
    while (el = walker.nextNode()) {
      if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
        injectShadowStyles(el.shadowRoot);
      }
    }
  }

  function reHighlight() {
    if (pendingRehighlight) return;
    pendingRehighlight = true;
    setTimeout(function () {
      pendingRehighlight = false;
      _doReHighlight();
    }, 0);
  }

  function _doReHighlight() {
    // 临时关键词的增删改都走这里，kwId 可能复用而样式已变，缓存必须失效
    invalidateStyleMap();
    lastRenderedTempSig = tempStateSig();
    var keywords = getActiveKeywords();
    if (keywords.length === 0) {
      var existingMarks = getAllHighlightMarks();
      if (existingMarks.length > 0) removeHighlights();
      updateBadge();  // 角标按 frame 各自上报，iframe 命中也计入
      return;
    }

    removeHighlights();
    if (pageDisabled) return;

    if (typeof Matcher === 'undefined') return;

    registerKeywordClasses(keywords);
    injectStylesToAllShadowRoots();

    isHighlighting = true;
    highlightBatch(keywords, 0);
  }

  function incrementalHighlight() {
    if (pageDisabled) return;
    if (currentRules.length === 0 && tempKeywords.length === 0) return;

    if (isHighlighting || isLazyHighlighting) {
      pendingIncremental = true;
      return;
    }

    pendingIncremental = false;

    var keywords = getActiveKeywords();
    if (keywords.length === 0) return;

    if (typeof Matcher === 'undefined') return;

    registerKeywordClasses(keywords);
    injectStylesToAllShadowRoots();

    batchTextNodes = null;
    isHighlighting = true;
    highlightBatch(keywords, 0);
  }

  function precomputeExclusiveStopOrder(keywords, textNodes) {
    var exclusiveKeywords = [];
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i].exclusive) exclusiveKeywords.push(keywords[i]);
    }
    if (exclusiveKeywords.length === 0) {
      exclusiveStopOrder = -1;
      return;
    }

    var minExclusiveOrder = -1;

    var existingMarks = getAllHighlightMarks();
    for (var em = 0; em < existingMarks.length; em++) {
      if (existingMarks[em].dataset.ahExclusive === '1') {
        var emOrder = parseInt(existingMarks[em].dataset.ahGlobalOrder, 10);
        if (!isNaN(emOrder) && (minExclusiveOrder < 0 || emOrder < minExclusiveOrder)) {
          minExclusiveOrder = emOrder;
        }
      }
    }
    if (minExclusiveOrder === 0) {
      exclusiveStopOrder = 0;
      return;
    }

    if (!textNodes) textNodes = getAllTextNodes();
    for (var j = 0; j < textNodes.length; j++) {
      var textNode = textNodes[j];
      if (!textNode || !textNode.isConnected) continue;
      var text = textNode.textContent;

      for (var k = 0; k < exclusiveKeywords.length; k++) {
        var kw = exclusiveKeywords[k];
        try {
          if (Matcher.hasMatch(text, kw.text, kw.matchType, kw.caseSensitive)) {
            var order = keywordGlobalOrder[kw.id];
            if (minExclusiveOrder < 0 || order < minExclusiveOrder) {
              minExclusiveOrder = order;
            }
          }
        } catch (e) {}
      }
      if (minExclusiveOrder === 0) break;
    }

    exclusiveStopOrder = minExclusiveOrder;
  }

  /** 视口阶段完成：立即挂 rail / 观察器 / 滚动监听，用户此刻就能看到并交互，不等后台远节点 */
  function onNearPhaseComplete() {
    invalidateKeywordMapCache();
    if (!isInIframe && shouldShowRail()) createRail();
    setupBodyObserver();
    setupLazyHighlightScroll();
    applyVisibility();
    updateBadge();  // 角标按 frame 各自上报，iframe 命中也计入
  }

  /** 全部节点（含后台补齐的远节点）处理完：收尾 */
  function onHighlightBatchComplete() {
    batchTextNodes = null;
    isHighlighting = false;
    forceFullHighlight = false;
    invalidateKeywordMapCache();
    invalidateElTopCache();
    // 兜底：关键词全部是跨元素类型时没有普通节点循环，视口钩子在此补触发
    if (!batchNearHookDone) {
      batchNearHookDone = true;
      onNearPhaseComplete();
    }
    if (!isInIframe && railEl) renderRail();
    // 远节点 mark 这时才存在，全部就绪后的最终角标上报（各 frame 各自报，后台求和）
    updateBadge();
    if (pendingNavigation) {
      var nav = pendingNavigation;
      pendingNavigation = null;
      setTimeout(function () { navigateToMarkAt(nav.kwId, nav.localIndex, nav.globalIndex, nav.globalTotal, true); }, 0);
    }
    if (pendingIncremental) {
      setTimeout(incrementalHighlight, 0);
    }
  }

  function highlightBatch(keywords, startIdx, gen) {
    // 代际校验：removeHighlights / 新一轮批处理会让旧链过期，避免两条链并发重复处理
    if (!gen) gen = ++batchGeneration;
    else if (gen !== batchGeneration) return;

    if (!batchTextNodes) {
      // 全量收集后重排：视口内节点排前（立即出效果），视口外节点排后在后台分片补齐。
      // 锚点跳转/快速滚动到页面任何位置时高亮都已存在，不再依赖滚动事件补齐
      var all = getAllTextNodes();
      var near = [], far = [];
      for (var n = 0; n < all.length; n++) {
        var par = all[n].parentElement;
        if (par && isElementNearViewport(par)) near.push(all[n]);
        else far.push(all[n]);
      }
      batchNearBoundary = near.length;
      batchNearHookDone = false;
      batchTextNodes = near.concat(far);
      // 匹配即停序号直接用本批已收集的节点计算，避免再走一遍全页 TreeWalker
      precomputeExclusiveStopOrder(keywords, batchTextNodes);
    }

    var hasAcross = false;
    for (var ak = 0; ak < keywords.length; ak++) {
      if (keywords[ak].acrossElements) { hasAcross = true; break; }
    }

    var normalKws = keywords;
    var acrossKws = null;
    if (hasAcross) {
      normalKws = [];
      acrossKws = [];
      for (var ak2 = 0; ak2 < keywords.length; ak2++) {
        if (keywords[ak2].acrossElements) acrossKws.push(keywords[ak2]);
        else normalKws.push(keywords[ak2]);
      }
    }

    if (normalKws.length > 0) {
      // 样式类与快筛只构建一次，整个批处理复用
      var kwClasses = buildKwClasses(normalKws);
      var quick = buildQuickFilter(normalKws);
      var end = Math.min(startIdx + BATCH_SIZE, batchTextNodes.length);
      var deadline = performance.now() + 12;
      for (var i = startIdx; i < end; i++) {
        // 时间片：超出预算就让出主线程，页面不冻结
        if (i > startIdx && ((i - startIdx) & 31) === 31 && performance.now() > deadline) {
          end = i;
          break;
        }
        var node = batchTextNodes[i];
        if (node && node.isConnected) highlightTextNode(node, normalKws, kwClasses, quick);
      }
      // 视口节点刚全部处理完：立即挂 rail / 观察器 / 滚动监听，不等后台远节点跑完
      if (!batchNearHookDone && end >= batchNearBoundary) {
        batchNearHookDone = true;
        onNearPhaseComplete();
      }
      if (end < batchTextNodes.length) {
        setTimeout(function () { highlightBatch(keywords, end, gen); }, 0);
        return;
      }
    }

    if (acrossKws && acrossKws.length > 0) {
      // 复用本批已收集的文本节点，避免再走一遍全页 TreeWalker
      highlightAcrossElements(acrossKws, batchTextNodes, buildKwClasses(acrossKws));
    }
    onHighlightBatchComplete();
  }

  function highlightAcrossElements(keywords, allTextNodes, kwClasses) {
    var containerMap = {};
    var containerOrder = [];
    // 通配正则按 关键词+大小写 编译一次复用，避免每个容器重复 new RegExp
    var wildCache = {};

    var blockTags = {
      'P':1,'DIV':1,'SECTION':1,'ARTICLE':1,'MAIN':1,'ASIDE':1,'HEADER':1,'FOOTER':1,'NAV':1,
      'LI':1,'TD':1,'TH':1,'DT':1,'DD':1,'BLOCKQUOTE':1,'PRE':1,'H1':1,'H2':1,'H3':1,'H4':1,'H5':1,'H6':1,
      'BODY':1,'FORM':1,'FIELDSET':1,'FIGCAPTION':1,'SUMMARY':1,'CENTER':1,'DIALOG':1
    };

    function findBlockContainer(el) {
      while (el && el !== document.documentElement && el !== document) {
        if (el.nodeType === 1 && blockTags[el.tagName]) return el;
        el = el.parentElement;
      }
      return document.body || document.documentElement;
    }

    for (var i = 0; i < allTextNodes.length; i++) {
      var node = allTextNodes[i];
      if (!node || !node.isConnected) continue;
      if (node.parentNode && node.parentNode.tagName === HIGHLIGHT_TAG.toUpperCase()) continue;
      var text = node.textContent;
      if (!text.trim()) continue;
      var block = findBlockContainer(node.parentNode);
      if (!block) continue;
      var key = null;
      try { key = block.id || block.className || ''; } catch(e) {}
      var uid = key + '__ah__' + (block.getAttribute && block.getAttribute('data-ah-bid') ? block.getAttribute('data-ah-bid') : '');
      if (!containerMap[uid]) {
        containerMap[uid] = { block: block, nodes: [] };
        containerOrder.push(uid);
      }
      containerMap[uid].nodes.push(node);
    }

    for (var ci = 0; ci < containerOrder.length; ci++) {
      var group = containerMap[containerOrder[ci]].nodes;
      if (group.length === 0) continue;

      var concatText = '';
      var nodeOffsets = [];
      for (var ni = 0; ni < group.length; ni++) {
        nodeOffsets.push(concatText.length);
        concatText += group[ni].textContent;
      }

      if (!concatText.trim()) continue;

      var allMatches = [];
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki];
        var kwCls = kwClasses ? kwClasses[ki] : styleClassFor(StyleKit.resolveStyle(kw, currentSettings));
        try {
          var matches;
          if (kw.matchType === 'wildcard') {
            var wkey = kw.text + '\x00' + (kw.caseSensitive ? '1' : '0');
            var wildRegex = wildCache[wkey];
            if (!wildRegex) {
            var wildPat = Matcher.escapeWildcard(kw.text)
              .replace(/\*/g, '[\\s\\S]*?')
              .replace(/\?/g, '[\\s\\S]');
              wildRegex = wildCache[wkey] = new RegExp(wildPat, kw.caseSensitive ? 'g' : 'gi');
            }
            matches = [];
            var m;
            wildRegex.lastIndex = 0;
            while ((m = wildRegex.exec(concatText)) !== null) {
              matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
              if (m[0].length === 0) wildRegex.lastIndex++;
            }
          } else {
            matches = Matcher.getMatches(concatText, kw.text, kw.matchType, kw.caseSensitive);
          }
          for (var mi = 0; mi < matches.length; mi++) {
            matches[mi].keywordId = kw.id || '__temp__';
            matches[mi].kwCls = kwCls;
            matches[mi].keywordText = kw.text;
            matches[mi].showRail = kw.showRail !== false;
            matches[mi].exclusive = kw.exclusive === true;
            matches[mi].globalOrder = keywordGlobalOrder[kw.id];
          }
          allMatches = allMatches.concat(matches);
        } catch (e) {}
      }

      if (allMatches.length === 0) continue;

      for (var ap = 0; ap < allMatches.length; ap++) {
        var isTempKwAp = CommonKit.isTempKwId(allMatches[ap].keywordId);
        allMatches[ap]._hide = exclusiveHidesOrder(allMatches[ap].globalOrder, isTempKwAp);
      }
      allMatches.sort(function (a, b) {
        if (a.start !== b.start) return a.start - b.start;
        if (a._hide !== b._hide) return a._hide ? 1 : -1;
        return b.end - a.end;
      });
      var merged = [];
      for (var mm = 0; mm < allMatches.length; mm++) {
        if (merged.length > 0 && allMatches[mm].start < merged[merged.length - 1].end) {
          if (!allMatches[mm]._hide && merged[merged.length - 1]._hide) {
            merged[merged.length - 1] = allMatches[mm];
          }
          continue;
        }
        merged.push(allMatches[mm]);
      }

      for (var mj = 0; mj < merged.length; mj++) {
        var match = merged[mj];
        applyCrossNodeMatch(group, nodeOffsets, match);
      }
    }
  }

  function setupLazyHighlightScroll() {
    window.removeEventListener('scroll', scheduleLazyHighlight, true);
    window.addEventListener('scroll', scheduleLazyHighlight, true);
  }

  function scheduleLazyHighlight() {
    if (pageDisabled) return;
    if (currentRules.length === 0 && tempKeywords.length === 0) return;
    clearTimeout(lazyHighlightTimer);
    lazyHighlightTimer = setTimeout(doLazyHighlight, LAZY_HIGHLIGHT_DELAY);
  }

  function doLazyHighlight() {
    if (isLazyHighlighting) return;
    if (pageDisabled) return;

    var keywords = getActiveKeywords();
    if (keywords.length === 0) return;

    var normalKws = [];
    var hasAcross = false;
    for (var ak = 0; ak < keywords.length; ak++) {
      if (keywords[ak].acrossElements) hasAcross = true;
      else normalKws.push(keywords[ak]);
    }

    if (hasAcross) {
      pendingIncremental = true;
    }

    if (normalKws.length === 0) {
      if (pendingIncremental) incrementalHighlight();
      return;
    }

    var textNodes = getAllTextNodes();
    precomputeExclusiveStopOrder(keywords, textNodes);
    var nearNodes = [];
    for (var i = 0; i < textNodes.length; i++) {
      var node = textNodes[i];
      if (node && node.isConnected && isElementNearViewport(node.parentElement)) {
        nearNodes.push(node);
      }
    }

    if (nearNodes.length === 0) return;

    isLazyHighlighting = true;
    lazyHighlightBatch(normalKws, nearNodes, 0, buildKwClasses(normalKws), buildQuickFilter(normalKws));
  }

  function lazyHighlightBatch(keywords, nodes, startIdx, kwClasses, quick) {
    if (!isLazyHighlighting) return;

    var end = Math.min(startIdx + BATCH_SIZE, nodes.length);
    var deadline = performance.now() + 12;
    for (var i = startIdx; i < end; i++) {
      if (i > startIdx && ((i - startIdx) & 31) === 31 && performance.now() > deadline) {
        end = i;
        break;
      }
      var node = nodes[i];
      if (node && node.isConnected) highlightTextNode(node, keywords, kwClasses, quick);
    }

    if (end < nodes.length) {
      setTimeout(function () { lazyHighlightBatch(keywords, nodes, end, kwClasses, quick); }, 0);
    } else {
      isLazyHighlighting = false;
      var visChanged = applyVisibility();
      if (!visChanged && !isInIframe) {
        if (shouldShowRail()) { if (!railEl) createRail(); else renderRail(); }
      }
      if (!visChanged) updateBadge();
      if (pendingIncremental) {
        setTimeout(incrementalHighlight, 0);
      }
    }
  }

  function applyCrossNodeMatch(nodeGroup, offsets, match) {
    // 一次命中可能横跨多个文本节点，拆出的每个片段 mark 共享同一组号
    if (!match.groupId) match.groupId = ++matchGroupCounter;
    var startOffset = match.start;
    var endOffset = match.end;

    var startNodeIdx = -1;
    var endNodeIdx = -1;
    for (var i = 0; i < offsets.length; i++) {
      if (offsets[i] <= startOffset) startNodeIdx = i;
      if (offsets[i] < endOffset) endNodeIdx = i;
    }
    if (startNodeIdx < 0 || endNodeIdx < 0) return;

    for (var ni = startNodeIdx; ni <= endNodeIdx; ni++) {
      var node = nodeGroup[ni];
      if (!node || !node.isConnected) continue;
      var nodeStart = Math.max(startOffset, offsets[ni]) - offsets[ni];
      var nodeEnd = (ni === endNodeIdx ? endOffset : offsets[ni + 1] || offsets[ni] + node.textContent.length) - offsets[ni];
      nodeEnd = Math.min(nodeEnd, node.textContent.length);
      if (nodeStart >= nodeEnd) continue;

      var parent = node.parentNode;
      if (!parent) continue;
      var text = node.textContent;
      var beforeText = text.slice(0, nodeStart);
      var matchText = text.slice(nodeStart, nodeEnd);
      var afterText = text.slice(nodeEnd);

      var fragment = document.createDocumentFragment();
      if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
      var mark = document.createElement(HIGHLIGHT_TAG);
      mark.textContent = matchText;
      mark.dataset.ahKeywordId = match.keywordId;
      mark.dataset.ahKeywordText = match.keywordText;
      mark.dataset.ahShowRail = match.showRail ? '1' : '0';
      mark.dataset.ahExclusive = match.exclusive ? '1' : '0';
      mark.dataset.ahGlobalOrder = String(match.globalOrder);
      mark.dataset.ahGroupId = String(match.groupId);

      var isTempKw = CommonKit.isTempKwId(match.keywordId);
      var matchHide = match._hide !== undefined ? match._hide : exclusiveHidesOrder(match.globalOrder, isTempKw);
      mark.className = matchHide ? classForMatch(match) + ' ah-hidden' : classForMatch(match);
      mark.dataset.ahHidden = matchHide ? 'true' : '';
      fragment.appendChild(mark);
      if (afterText) fragment.appendChild(document.createTextNode(afterText));
      try { parent.replaceChild(fragment, node); } catch (e) {}
    }
  }

  function updateBadge() {
    // 与弹窗计数 / 箭头跳转共用 collectVisibleGroups 分组，保证三个数字永远一致
    var count = collectVisibleGroups(getAllHighlightMarks(), undefined).length;
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: count });
    } catch (e) {}
  }

  var ALL_SPOT_COLORS = ['#ffeb3b','#ff6b6b','#a8e6cf','#ffd93d','#6bcb77','#4d96ff','#c084fc','#fb923c','#f48fb1','#80cbc4','#b39ddb','#90caf9','#fff176','#ffab91','#a5d6a7','#ce93d8'];

  // 计算后的 style.backgroundColor 是 rgb(...) 格式，与预设的 hex 比较前统一转 hex，
  // 否则去重永远失败、每次都取到第一个默认色
  function normalizeColorHex(c) {
    if (!c) return '';
    if (c.charAt(0) === '#') return c.toLowerCase();
    var m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
    if (!m) return '';
    return '#' + [m[1], m[2], m[3]].map(function (n) {
      var h = parseInt(n, 10).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  // 收集页面上已用过的背景色（统一转 hex，style.backgroundColor 是 rgb 格式）
  function collectUsedColors() {
    var usedColors = [];
    function addUsed(c) {
      c = normalizeColorHex(c);
      if (c && usedColors.indexOf(c) === -1) usedColors.push(c);
    }
    var tempMarks = document.querySelectorAll(HIGHLIGHT_TAG);
    for (var i = 0; i < tempMarks.length; i++) addUsed(tempMarks[i].style.backgroundColor);
    var spotMarks = document.querySelectorAll('ah-spot');
    for (var j = 0; j < spotMarks.length; j++) addUsed(spotMarks[j].style.backgroundColor);
    for (var k = 0; k < tempKeywords.length; k++) addUsed(tempKeywords[k].color);
    return usedColors;
  }

  // 取色池 = 用户预设背景色（按顺序）+ 扩展色兜底
  function presetColorPool() {
    var pool = [];
    var presets = (currentSettings && Array.isArray(currentSettings.stylePresets) && currentSettings.stylePresets.length)
      ? currentSettings.stylePresets
      : ((currentSettings && Array.isArray(currentSettings.colorPresets) && currentSettings.colorPresets.length)
        ? currentSettings.colorPresets : null);
    if (presets) {
      for (var pi = 0; pi < presets.length; pi++) {
        var pc = presets[pi] && presets[pi].bgColor;
        if (pc && pool.indexOf(pc) === -1) pool.push(pc);
      }
    }
    for (var ci = 0; ci < ALL_SPOT_COLORS.length; ci++) {
      if (pool.indexOf(ALL_SPOT_COLORS[ci]) === -1) pool.push(ALL_SPOT_COLORS[ci]);
    }
    return pool;
  }

  // 临时关键词取色：只取背景色，按预设顺序，全部用过才随机
  function getRandomDistinctColor() {
    var usedColors = collectUsedColors();
    var pool = presetColorPool();
    for (var si = 0; si < pool.length; si++) {
      if (usedColors.indexOf(normalizeColorHex(pool[si])) === -1) return pool[si];
    }
    return ALL_SPOT_COLORS[Math.floor(Math.random() * ALL_SPOT_COLORS.length)];
  }

  /** spot 用完整预设：背景色 + 文字样式（含自动黑白）整体取自同一个预设，
   *  预设全部用过才回退到扩展色（文字样式跟随全局默认） */
  function getNextSpotStyle() {
    var usedColors = collectUsedColors();
    var presets = (currentSettings && Array.isArray(currentSettings.stylePresets) && currentSettings.stylePresets.length)
      ? currentSettings.stylePresets
      : ((currentSettings && Array.isArray(currentSettings.colorPresets) && currentSettings.colorPresets.length)
        ? currentSettings.colorPresets : null);
    if (presets) {
      for (var pi = 0; pi < presets.length; pi++) {
        var p = StyleKit.normalizePreset(presets[pi]);
        if (usedColors.indexOf(normalizeColorHex(p.bgColor)) === -1) return p;
      }
    }
    for (var si = 0; si < ALL_SPOT_COLORS.length; si++) {
      if (usedColors.indexOf(ALL_SPOT_COLORS[si]) === -1) {
        var st = StyleKit.getDefaultStyle(currentSettings);
        st.bgColor = ALL_SPOT_COLORS[si];
        return st;
      }
    }
    var fb = StyleKit.getDefaultStyle(currentSettings);
    fb.bgColor = ALL_SPOT_COLORS[Math.floor(Math.random() * ALL_SPOT_COLORS.length)];
    return fb;
  }

  function highlightSelectedRange(text, style, spotId) {
    try {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var range = sel.getRangeAt(0);
      if (range.collapsed) return null;
      // 选区落在非 HTML 命名空间（SVG / MathML）内时直接放弃：
      // HTML 包裹元素插进去会破坏渲染，让选中文字直接消失——宁可不高亮
      var anc = range.commonAncestorContainer;
      var ancEl = anc.nodeType === 1 ? anc : anc.parentNode;
      var ancNs = ancEl && ancEl.namespaceURI;
      if (ancNs && ancNs !== 'http://www.w3.org/1999/xhtml') return null;
      var wrapper = document.createElement('ah-spot');
      // 整个预设样式（背景 + 文字含自动黑白）直接应用到片段
      StyleKit.applyToElement(wrapper, style, false);
      wrapper.style.padding = '1px 0';
      // 每个片段在创建时就带上 spotId：跨父元素的多片段无法靠兄弟反查统一赋值，
      // 否则删除时只能删掉同一父元素下的片段，其余残留
      if (spotId) wrapper.dataset.ahSpotId = spotId;
      try { range.surroundContents(wrapper); sel.removeAllRanges(); return wrapper; } catch (e) {}
      var treeWalker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        { acceptNode: function () { return NodeFilter.FILTER_ACCEPT; } }
      );
      var nodes = [];
      var skippedNs = false;
      while (treeWalker.nextNode()) {
        if (!range.intersectsNode(treeWalker.currentNode)) continue;
        // 跨 HTML/SVG 的混合选区：只包裹 HTML 命名空间的节点，SVG 部分保持原样
        var np = treeWalker.currentNode.parentNode;
        var nns = np && np.namespaceURI;
        if (nns && nns !== 'http://www.w3.org/1999/xhtml') { skippedNs = true; continue; }
        nodes.push(treeWalker.currentNode);
      }
      if (nodes.length === 0) {
        // 选区内只有非 HTML 文本：放弃，绝不能把 SVG 内容搬进 HTML 包裹元素
        if (skippedNs) return null;
        var fragment = range.extractContents();
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);
        sel.removeAllRanges();
        return wrapper;
      }
      var firstWrapper = null;
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        var start = (node === range.startContainer) ? range.startOffset : 0;
        var end = (node === range.endContainer) ? range.endOffset : node.nodeValue.length;
        if (start >= end || !node.parentNode) continue;
        var partRange = document.createRange();
        partRange.setStart(node, start);
        partRange.setEnd(node, end);
        var clone = wrapper.cloneNode(true);
        try { partRange.surroundContents(clone); } catch (wrapErr) {
          var frag = partRange.extractContents();
          clone.appendChild(frag);
          partRange.insertNode(clone);
        }
        if (!firstWrapper) firstWrapper = clone;
      }
      sel.removeAllRanges();
      return firstWrapper;
    } catch (e) {
      return null;
    }
  }

  function removeSpotHighlight(spotId) {
    var els = document.querySelectorAll('ah-spot[data-ah-spot-id="' + spotId + '"]');
    for (var ei = 0; ei < els.length; ei++) {
      var el = els[ei];
      if (!el.isConnected) continue;
      var parent = el.parentNode;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      try { parent.normalize(); } catch (e) {}
    }
  }

  function updateSpotStyle(spotId, style) {
    var els = document.querySelectorAll('ah-spot[data-ah-spot-id="' + spotId + '"]');
    for (var ui = 0; ui < els.length; ui++) {
      StyleKit.applyToElement(els[ui], style, false);
      els[ui].style.padding = '1px 0';
    }
  }

  function shouldShowRail() {
    if (isInIframe) return false;
    if (currentSettings.showRail === false) return false;
    for (var i = 0; i < currentRules.length; i++) {
      var rule = currentRules[i];
      if (!rule.enabled || !rule.keywords) continue;
      for (var j = 0; j < rule.keywords.length; j++) {
        if (rule.keywords[j].enabled && rule.keywords[j].showRail !== false) return true;
      }
    }
    for (var k = 0; k < tempKeywords.length; k++) {
      if (tempKeywords[k].showRail !== false) return true;
    }
    return false;
  }

  function getKeywordMap() {
    var now = Date.now();
    if (cachedKeywordMap && (now - cachedKeywordMapTime) < CACHE_TTL) {
      return cachedKeywordMap;
    }
    var marks = getAllHighlightMarks();
    var keywordMap = {};
    for (var i = 0; i < marks.length; i++) {
      var h = marks[i];
      if (h.dataset.ahShowRail !== '1') continue;
      // 过滤口径与计数 / 跳转 / 角标保持一致（isCountableMark 内含可见性检测，
      // 否则 display:none 区域的命中会挂到 rail 上：top=0 排最顶、点击也无从显示）
      if (!isCountableMark(h)) continue;
      var kwId = h.dataset.ahKeywordId;
      if (!keywordMap[kwId]) keywordMap[kwId] = { text: h.dataset.ahKeywordText || '', color: getStyleForKeywordId(kwId).bgColor, elements: [] };
      keywordMap[kwId].elements.push(h);
    }
    cachedKeywordMap = keywordMap;
    cachedKeywordMapTime = now;
    return keywordMap;
  }

  function invalidateKeywordMapCache() {
    cachedKeywordMap = null;
  }

  function getAllHighlightMarks() {
    var marks = [];
    if (!document.body && !document.documentElement) return marks;

    var rootEl = document.body || document.documentElement;
    var mainMarks = rootEl.querySelectorAll(HIGHLIGHT_TAG);
    for (var i = 0; i < mainMarks.length; i++) marks.push(mainMarks[i]);

    function collectFromShadow(root) {
      if (!root) return;
      try {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        var el;
        while (el = walker.nextNode()) {
          if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
            var shadowMarks = el.shadowRoot.querySelectorAll(HIGHLIGHT_TAG);
            for (var k = 0; k < shadowMarks.length; k++) marks.push(shadowMarks[k]);
            collectFromShadow(el.shadowRoot);
          }
        }
      } catch (e) {}
    }
    collectFromShadow(rootEl);
    return marks;
  }

  function getAllTextNodes() {
    var nodes = [];
    var docRoot = document.body || document.documentElement;
    if (!docRoot) return nodes;

    function isHidden(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'TEXTAREA' || tag === 'IFRAME') return true;
      try {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
      } catch (e) {}
      return false;
    }

    var shadowRoots = [];

    function walkNode(root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          var parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.tagName === 'AH-MARK') return NodeFilter.FILTER_REJECT;
          // 非 HTML 命名空间（SVG / MathML）的文本一律跳过：
          // HTML 的 <ah-mark> 插进去会破坏渲染，让关键词直接消失——宁可不高亮。
          // （SVG 内 foreignObject 里是 HTML 命名空间，仍会正常处理）
          var ns = parent.namespaceURI;
          if (ns && ns !== 'http://www.w3.org/1999/xhtml') return NodeFilter.FILTER_REJECT;
          // 只查直接父级：祖先级 display:none 的检测（每节点×深度的 getComputedStyle）
          // 成本远超收益；漏掉的隐藏区在显示时会直接呈现高亮，行为可接受
          if (isHidden(parent)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node;
      while (node = walker.nextNode()) nodes.push(node);

      var elWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      var el;
      while (el = elWalker.nextNode()) {
        if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
          shadowRoots.push(el.shadowRoot);
        }
      }
    }

    walkNode(docRoot);

    for (var s = 0; s < shadowRoots.length; s++) {
      walkNode(shadowRoots[s]);
    }

    return nodes;
  }

  /** 批处理入口：预注册每个关键词的样式类（索引与 keywords 对齐），循环里只查数组 */
  function buildKwClasses(keywords) {
    var classes = new Array(keywords.length);
    for (var i = 0; i < keywords.length; i++) {
      classes[i] = styleClassFor(StyleKit.resolveStyle(keywords[i], currentSettings));
    }
    return classes;
  }

  /**
   * 合并快筛：把 contains/exact 关键词拼成一个 alternation 正则，对节点文本先测一次；
   * 不命中即可跳过全部这批词（regex/wildcard 不参与，仍逐词跑）。
   * 统一加 i 令快筛只会误报不会漏报，误报由后续精确匹配兜住。
   */
  function buildQuickFilter(keywords) {
    var parts = [];
    var plain = new Array(keywords.length);
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      var mt = kw.matchType || 'contains';
      if ((mt === 'contains' || mt === 'exact') && kw.text) {
        parts.push(Matcher.escapeRegex(String(kw.text)));
        plain[i] = true;
      } else {
        plain[i] = false;
      }
    }
    if (parts.length < 3) return null;
    try {
      return { re: new RegExp(parts.join('|'), 'i'), plain: plain };
    } catch (e) {
      return null;
    }
  }

  function getActiveKeywords() {
    var keywords = [];
    var order = 0;
    for (var i = 0; i < currentRules.length; i++) {
      var rule = currentRules[i];
      if (!rule.enabled || !rule.keywords) continue;
      for (var j = 0; j < rule.keywords.length; j++) {
        var kw = rule.keywords[j];
        if (kw.enabled && kw.text) {
          keywordGlobalOrder[kw.id] = order++;
          keywords.push(kw);
        }
      }
    }
    for (var k = 0; k < tempKeywords.length; k++) {
      var tkw = tempKeywords[k];
      if (!tkw.text) continue;
      // 眼形按钮隐藏的临时关键词直接不参与匹配（以前是弹窗发名单前先过滤掉，
      // 现在名单要跨网页保留，隐藏态也一起持久化，改在这里过滤）
      if (hiddenKwIds.indexOf(tkw.id) >= 0 && manualShowKwIds.indexOf(tkw.id) < 0) continue;
      keywordGlobalOrder[tkw.id] = order++;
      keywords.push(tkw);
    }
    return keywords;
  }

  function highlightTextNode(textNode, keywords, kwClasses, quick) {
    var text = textNode.textContent;
    var allMatches = [];
    // 合并快筛：一次 alternation 正则测完全部 contains/exact 词，不命中整批跳过
    var quickHit = quick ? quick.re.test(text) : true;
    for (var i = 0; i < keywords.length; i++) {
      if (quick && quick.plain[i] && !quickHit) continue;
      var kw = keywords[i];
      // 样式类由批处理入口预注册（kwClasses 与 keywords 索引对齐），这里只引用
      var kwCls = kwClasses ? kwClasses[i] : styleClassFor(StyleKit.resolveStyle(kw, currentSettings));
      try {
        var matches = Matcher.getMatches(text, kw.text, kw.matchType, kw.caseSensitive);
        for (var j = 0; j < matches.length; j++) {
          matches[j].keywordId = kw.id || '__temp__';
          matches[j].kwCls = kwCls;
          matches[j].keywordText = kw.text;
          matches[j].showRail = kw.showRail !== false;
          matches[j].exclusive = kw.exclusive === true;
          matches[j].globalOrder = keywordGlobalOrder[kw.id];
        }
        allMatches = allMatches.concat(matches);
      } catch (e) {}
    }
    if (allMatches.length === 0) return;
    for (var p = 0; p < allMatches.length; p++) {
      var isTempKwP = CommonKit.isTempKwId(allMatches[p].keywordId);
      allMatches[p]._hide = exclusiveHidesOrder(allMatches[p].globalOrder, isTempKwP);
    }
    allMatches.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      if (a._hide !== b._hide) return a._hide ? 1 : -1;
      return b.end - a.end;
    });
    var merged = [];
    for (var k = 0; k < allMatches.length; k++) {
      if (merged.length > 0 && allMatches[k].start < merged[merged.length - 1].end) {
        if (!allMatches[k]._hide && merged[merged.length - 1]._hide) {
          merged[merged.length - 1] = allMatches[k];
        }
        continue;
      }
      merged.push(allMatches[k]);
    }
    var parent = textNode.parentNode;
    if (!parent) return;
    var fragment = document.createDocumentFragment();
    var lastEnd = 0;
    for (var l = 0; l < merged.length; l++) {
      var match = merged[l];
      if (match.start > lastEnd) fragment.appendChild(document.createTextNode(text.slice(lastEnd, match.start)));
      var mark = document.createElement(HIGHLIGHT_TAG);
      mark.textContent = text.slice(match.start, match.end);
      mark.dataset.ahKeywordId = match.keywordId;
      mark.dataset.ahKeywordText = match.keywordText;
      mark.dataset.ahShowRail = match.showRail ? '1' : '0';
      mark.dataset.ahExclusive = match.exclusive ? '1' : '0';
      mark.dataset.ahGlobalOrder = String(match.globalOrder);
      mark.dataset.ahGroupId = String(++matchGroupCounter);
      // 样式走 class（规则在 <style> 里统一注入），隐藏态叠加 .ah-hidden
      mark.className = match._hide ? classForMatch(match) + ' ah-hidden' : classForMatch(match);
      mark.dataset.ahHidden = match._hide ? 'true' : '';

      fragment.appendChild(mark);
      lastEnd = match.end;
    }
    if (lastEnd < text.length) fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    try { parent.replaceChild(fragment, textNode); } catch (e) {
    }
  }

  // ---- 样式解析：统一走 utils/style.js，保证与 options / popup 的预览一致 ----

  var styleMap = {};

  function invalidateStyleMap() {
    styleMap = {};
  }

  /** 按关键词 id 取解析后的完整样式（关键词覆写 + 全局默认），带缓存 */
  function getStyleForKeywordId(kwId) {
    if (styleMap[kwId]) return styleMap[kwId];
    var s = StyleKit.resolveStyle(findKeywordById(kwId), currentSettings);
    styleMap[kwId] = s;
    return s;
  }

  function findKeywordById(kwId) {
    for (var i = 0; i < currentRules.length; i++) {
      var kws = currentRules[i] && currentRules[i].keywords;
      if (!kws) continue;
      for (var j = 0; j < kws.length; j++) {
        if (kws[j].id === kwId) return kws[j];
      }
    }
    for (var k = 0; k < tempKeywords.length; k++) {
      if (tempKeywords[k].id === kwId) return tempKeywords[k];
    }
    return null;
  }

  /** 兜底：match 上没带样式类时（跨元素匹配等边界路径）现注册一次 */
  function classForMatch(match) {
    if (match && match.kwCls) return match.kwCls;
    if (match && match.keywordId) {
      var kw = findKeywordById(match.keywordId);
      if (kw) return styleClassFor(StyleKit.resolveStyle(kw, currentSettings));
    }
    return styleClassFor(StyleKit.getDefaultStyle(currentSettings));
  }

  function applyVisibility() {
    invalidateKeywordMapCache();
    var marks = getAllHighlightMarks();
    var changed = false;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var kwId = m.dataset.ahKeywordId;
      var order = parseInt(m.dataset.ahGlobalOrder, 10);
      var isTempKw = CommonKit.isTempKwId(kwId);
      var isManuallyShown = manualShowKwIds.indexOf(kwId) >= 0;
      var isHiddenByExclusive = exclusiveHidesOrder(order, isTempKw);
      var isManuallyHidden = hiddenKwIds.indexOf(kwId) >= 0;

      var shouldHide = (isManuallyHidden && !isManuallyShown) || (isHiddenByExclusive && !isManuallyShown);
      if (shouldHide) {
        if (m.dataset.ahHidden !== 'true') {
          m.classList.add('ah-hidden');
          m.dataset.ahHidden = 'true';
          changed = true;
        }
      } else if (m.dataset.ahHidden === 'true') {
        // 样式类创建时已固定，取消隐藏只需摘掉 .ah-hidden，无需重算样式
        m.classList.remove('ah-hidden');
        m.dataset.ahHidden = '';
        changed = true;
      }
    }
    if (changed) {
      if (!isInIframe) {
        if (shouldShowRail()) { if (!railEl) createRail(); else renderRail(); }
        else if (railEl) { railEl.remove(); railEl = null; }
      }
      updateBadge();
    }
    return changed;
  }

  function removeHighlights() {
    disconnectObservers();
    clearTimeout(lazyHighlightTimer);
    isLazyHighlighting = false;
    activeHighlight = null; isHighlighting = false;
    exclusiveStopOrder = -1;
    batchTextNodes = null;
    batchNearBoundary = 0;
    batchNearHookDone = false;
    // 让在途的批处理链过期（下次 startIdx 推进时自动退出）
    batchGeneration++;
    pendingIncremental = false;
    invalidateElTopCache();
    var marks = getAllHighlightMarks();
    if (marks.length > 0) {
      // 只在移除过 mark 的父节点上 normalize，不再全页合并文本节点（大页面上的隐性大开销）
      var parents = [];
      var seenParents = new Set();
      for (var i = 0; i < marks.length; i++) {
        var el = marks[i];
        var parent = el.parentNode;
        if (!parent) continue;
        try { parent.replaceChild(document.createTextNode(el.textContent), el); } catch (e) { continue; }
        if (!seenParents.has(parent)) { seenParents.add(parent); parents.push(parent); }
      }
      for (var p = 0; p < parents.length; p++) {
        try { parents[p].normalize(); } catch (e) {}
      }
    }
    if (!isInIframe && railEl) { railEl.remove(); railEl = null; }
    invalidateKeywordMapCache();
  }

  function disconnectObservers() {
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    for (var i = 0; i < shadowObservers.length; i++) {
      try {
        shadowObservers[i].disconnect();
        if (shadowObservers[i]._ahShadowRoot) {
          shadowObservers[i]._ahShadowRoot._ahObserved = false;
        }
      } catch (e) {}
    }
    shadowObservers = [];
  }

  function setupBodyObserver() {
    disconnectObservers();
    if (!document.body) return;
    var debounceTimer = null;
    var firstMutationTime = 0;
    var DEBOUNCE_DELAY = 500;
    var MAX_WAIT = 1500;
    bodyObserver = new MutationObserver(function (mutations) {
      var shouldRefresh = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'AH-MARK') {
            shouldRefresh = true;
            break;
          }
        }
        if (shouldRefresh) break;
      }
      if (shouldRefresh) {
        var now = Date.now();
        if (firstMutationTime === 0) firstMutationTime = now;
        clearTimeout(debounceTimer);
        var elapsed = now - firstMutationTime;
        var delay = Math.max(0, Math.min(DEBOUNCE_DELAY, MAX_WAIT - elapsed));
        debounceTimer = setTimeout(function () {
          firstMutationTime = 0;
          if (currentRules.length > 0 || tempKeywords.length > 0) {
            observeExistingShadowRoots();
            incrementalHighlight();
          }
        }, delay);
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    observeExistingShadowRoots();
  }

  function observeShadowRoot(shadowRoot) {
    if (!shadowRoot || shadowRoot._ahObserved) return;
    shadowRoot._ahObserved = true;
    injectShadowStyles(shadowRoot);
    var debounceTimer = null;
    var firstMutationTime = 0;
    var DEBOUNCE_DELAY = 500;
    var MAX_WAIT = 1500;
    var observer = new MutationObserver(function (mutations) {
      var shouldRefresh = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== 'childList' && m.type !== 'characterData') continue;
        shouldRefresh = true;
        break;
      }
      if (shouldRefresh) {
        var now = Date.now();
        if (firstMutationTime === 0) firstMutationTime = now;
        clearTimeout(debounceTimer);
        var elapsed = now - firstMutationTime;
        var delay = Math.max(0, Math.min(DEBOUNCE_DELAY, MAX_WAIT - elapsed));
        debounceTimer = setTimeout(function () {
          firstMutationTime = 0;
          if (currentRules.length > 0 || tempKeywords.length > 0) incrementalHighlight();
        }, delay);
      }
    });
    observer.observe(shadowRoot, { childList: true, subtree: true, characterData: true });
    observer._ahShadowRoot = shadowRoot;
    shadowObservers.push(observer);
  }

  function injectShadowStyles(shadowRoot) {
    if (!shadowRoot) return;
    var el = shadowRoot.querySelector('style[data-ah-style]');
    var ver = String(dynStyleVersion);
    if (el && el.dataset.ahVer === ver) return;
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-ah-style', '1');
      try { shadowRoot.appendChild(el); } catch (e) { return; }
    }
    // 样式类规则变化时按版本号刷新，保证 shadow root 内的 mark 也能吃到 .ah-kw-N 规则
    el.dataset.ahVer = ver;
    el.textContent = 'ah-mark{transition:outline 0.15s}@keyframes ah-blink{0%,100%{opacity:1}50%{opacity:0.3}}ah-mark.ah-blinking{animation:ah-blink 0.3s ease-in-out 3}' + dynCssParts.join('');
  }

  function observeExistingShadowRoots() {
    var docRoot = document.body || document.documentElement;
    if (!docRoot) return;
    var walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_ELEMENT);
    var el;
    while (el = walker.nextNode()) {
      if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
        observeShadowRoot(el.shadowRoot);
      }
    }
  }

  function createRail() {
    if (isInIframe) return;
    if (railEl) railEl.remove();
    railEl = document.createElement(RAIL_TAG);
    railEl.id = 'ah-rail';
    try { (document.documentElement || document.body).appendChild(railEl); } catch (e) { return; }
    renderRail();
    window.removeEventListener('resize', scheduleRailUpdate);
    window.removeEventListener('resize', invalidateElTopCache);
    window.removeEventListener('scroll', scheduleRailUpdate, true);
    window.addEventListener('resize', scheduleRailUpdate);
    // 窗口尺寸变化才会改变文档坐标，此时清掉位置缓存
    window.addEventListener('resize', invalidateElTopCache);
    window.addEventListener('scroll', scheduleRailUpdate, true);
  }

  function scheduleRailUpdate() {
    clearTimeout(railUpdateTimer);
    railUpdateTimer = setTimeout(renderRail, 200);
  }

  function renderRail() {
    if (!railEl || !railEl.isConnected || isInIframe) return;
    var docH = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    var viewH = window.innerHeight;
    if (docH <= viewH) { railEl.style.display = 'none'; return; }
    railEl.style.display = '';
    var keywordMap = getKeywordMap();
    var railMarks = [];
    for (var kwKey in keywordMap) {
      if (!keywordMap.hasOwnProperty(kwKey)) continue;
      var kw = keywordMap[kwKey];
      for (var j = 0; j < kw.elements.length; j++) {
        var el = kw.elements[j];
        if (el.isConnected) railMarks.push({ el: el, color: kw.color, kwKey: kwKey, idx: j });
      }
    }
    if (railMarks.length === 0) { railEl.style.display = 'none'; return; }

    railMarks.sort(function(a, b) {
      return getElTopPosition(a.el) - getElTopPosition(b.el);
    });

    var minGap = 3;
    var mergedMarks = [];
    var hasValidRect = false;
    for (var m = 0; m < railMarks.length; m++) {
      var item = railMarks[m];
      var rect = getSafeRect(item.el);
      var pct;
      if (rect) {
        hasValidRect = true;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        var topPos = scrollTop + rect.top;
        pct = Math.max(0, Math.min(100, topPos / docH * 100));
      } else {
        pct = (m / railMarks.length) * 100;
      }

      if (mergedMarks.length > 0) {
        var last = mergedMarks[mergedMarks.length - 1];
        if (pct - last.pct < minGap / viewH * 100 && hasValidRect) {
          continue;
        }
      }
      item.pct = pct;
      mergedMarks.push(item);
    }

    railMarkTargets = [];
    railEl.innerHTML = '';
    for (var n = 0; n < mergedMarks.length; n++) {
      var item2 = mergedMarks[n];
      var color = item2.color;
      if (color && color.indexOf('rgb') === 0) {
        var rm = color.match(/(\d+)/g);
        if (rm && rm.length >= 3) {
          color = '#' + ((1 << 24) + (parseInt(rm[0]) << 16) + (parseInt(rm[1]) << 8) + parseInt(rm[2])).toString(16).slice(1);
        }
      }
      if (!color || color.charAt(0) !== '#') color = '#ffeb3b';
      railMarkTargets.push(item2.el);
      var markEl = document.createElement('div');
      markEl.className = 'ah-rail-mark';
      markEl.style.top = item2.pct + '%';
      markEl.style.backgroundColor = color;
      railMarkMap.set(markEl, item2.el);
      markEl.addEventListener('click', onRailMarkClick);
      railEl.appendChild(markEl);
    }
  }

  /** 与 GET_HIGHLIGHT_COUNT 同口径收集本 frame 内该关键词的可见匹配组。
   *  跨元素匹配会把一个词拆成多个相邻 mark（如 关<span>键</span>词 -> 关/键/词 三段），
   *  按 ahGroupId 聚成一组：计数与跳转都以「一次完整命中」为单位 */
  /**
   * mark 是否真实可见。getAllTextNodes 的隐藏检测只查文本节点直接父级，
   * display:none 祖先下的命中仍会建 mark；这类命中 Ctrl+F 搜不到、跳过去也无从显示，
   * 计数与导航必须与 Ctrl+F 同口径，把没有渲染盒的 mark 过滤掉
   */
  function isMarkVisible(el) {
    try {
      if (el.getClientRects().length === 0) return false;
      return window.getComputedStyle(el).visibility !== 'hidden';
    } catch (e) {
      return true;
    }
  }

  /**
   * 一条 mark 是否计入计数 / 跳转 / 角标——三者共用的唯一过滤口径。
   * 新的过滤条件只加在这里，不要在调用方再各写一份，否则改口径时必然漏。
   */
  function isCountableMark(m) {
    var kwId = m.dataset.ahKeywordId;
    if (!kwId) return false;
    var isTempKw = CommonKit.isTempKwId(kwId);
    var isManuallyShown = manualShowKwIds.indexOf(kwId) >= 0;
    if (hiddenKwIds.indexOf(kwId) >= 0 && !isManuallyShown) return false;
    if (exclusiveHidesOrder(m.dataset.ahGlobalOrder, isTempKw)) return false;
    if (m.dataset.ahHidden === 'true' && !isManuallyShown) return false;
    if (!m.isConnected) return false;
    if (!isMarkVisible(m)) return false;
    return true;
  }

  /**
   * 匹配即停的唯一判定：排在即停词之后的命中被清除。
   * order 接受数字 / 数字字符串 / undefined；临时关键词不受匹配即停清除影响。
   * 匹配期（_hide 标记）与渲染期（dataset 判定）都必须走这里，禁止再内联公式
   */
  function exclusiveHidesOrder(order, isTempKw) {
    return CommonKit.isExclusiveCleared(order, isTempKw, exclusiveStopOrder);
  }

  /**
   * 把 mark 按命中分组：跨元素匹配拆出的多个片段共享 ahGroupId，算一次完整命中。
   * 弹窗计数（GET_HIGHLIGHT_COUNT）、图标角标（updateBadge）、箭头跳转
   * （getVisibleKwGroups）全部经此分组，保证三个数字永远一致。
   * kwIdFilter 传 kwId 只统计该关键词；传 undefined 统计全部。
   */
  function collectVisibleGroups(marks, kwIdFilter) {
    var groupMap = {};
    var groupIds = [];
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (kwIdFilter !== undefined && m.dataset.ahKeywordId !== kwIdFilter) continue;
      if (!isCountableMark(m)) continue;
      var gid = m.dataset.ahGroupId || ('g' + i);
      if (!groupMap[gid]) { groupMap[gid] = []; groupIds.push(gid); }
      groupMap[gid].push(m);
    }
    var groups = [];
    for (var g = 0; g < groupIds.length; g++) {
      var arr = groupMap[groupIds[g]];
      arr.sort(function (a, b) { return getElTopPosition(a) - getElTopPosition(b); });
      groups.push(arr);
    }
    groups.sort(function (a, b) { return getElTopPosition(a[0]) - getElTopPosition(b[0]); });
    return groups;
  }

  function getVisibleKwGroups(kwId) {
    return collectVisibleGroups(getAllHighlightMarks(), kwId);
  }

  function navigateToSpotMark(kwId) {
    var spotId = kwId.replace('spot_', '');
    var spotEls = document.querySelectorAll('ah-spot[data-ah-spot-id="' + spotId + '"]');
    if (spotEls.length === 0) return;
    var connectedEls = [];
    for (var se = 0; se < spotEls.length; se++) {
      if (spotEls[se].isConnected) connectedEls.push(spotEls[se]);
    }
    if (connectedEls.length === 0) return;
    try { connectedEls[0].scrollIntoView({ block: 'center' }); } catch (e) {}
    if (activeHighlight) activeHighlight.classList.remove('ah-blinking');
    for (var ce = 0; ce < connectedEls.length; ce++) {
      connectedEls[ce].classList.add('ah-blinking');
    }
    activeHighlight = connectedEls[0];
    setTimeout(function () {
      for (var ce2 = 0; ce2 < connectedEls.length; ce2++) {
        if (connectedEls[ce2].isConnected) connectedEls[ce2].classList.remove('ah-blinking');
      }
    }, 900);
    try {
      chrome.runtime.sendMessage({ type: 'NAV_MARK_RESULT', kwId: kwId, index: 0, total: connectedEls.length });
    } catch (e) {}
  }

  /** 跳转到本 frame 内第 localIndex 个（0 起）可见匹配组；全局序号由 background 计算后一并带回 */
  function navigateToMarkAt(kwId, localIndex, globalIndex, globalTotal, isRetry) {
    var groups = getVisibleKwGroups(kwId);
    if (groups.length === 0) {
      // 兜底：懒加载区域的目标可能尚未生成 mark，强制全量高亮后重试一次；isRetry 防止死循环
      if (!isRetry) {
        forceFullHighlight = true;
        pendingNavigation = { kwId: kwId, localIndex: localIndex, globalIndex: globalIndex, globalTotal: globalTotal, isRetry: true };
        reHighlight();
      }
      return;
    }

    if (!(localIndex >= 0)) localIndex = 0;
    if (localIndex >= groups.length) localIndex = groups.length - 1;

    var group = groups[localIndex];
    var target = group[0];
    if (!target || !target.isConnected) return;

    try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
    // 同源 iframe 内的目标：把 iframe 自身也滚进父页面视口，避免父页面纹丝不动
    try { if (isInIframe && window.frameElement) window.frameElement.scrollIntoView({ block: 'center' }); } catch (e) {}
    // 整组闪烁：跨元素匹配拆出的多个片段一起亮，视觉上是一次完整命中
    if (activeHighlight) activeHighlight.classList.remove('ah-blinking');
    for (var gi = 0; gi < group.length; gi++) group[gi].classList.add('ah-blinking');
    activeHighlight = target;
    var blinkGroup = group;
    setTimeout(function () {
      for (var bi = 0; bi < blinkGroup.length; bi++) {
        if (blinkGroup[bi].isConnected) blinkGroup[bi].classList.remove('ah-blinking');
      }
    }, 900);

    try {
      chrome.runtime.sendMessage({ type: 'NAV_MARK_RESULT', kwId: kwId, index: globalIndex, total: globalTotal });
    } catch (e) {}
  }

  function onRailMarkClick(e) {
    e.stopPropagation();
    var targetEl = railMarkMap.get(this);
    if (!targetEl || !targetEl.isConnected) return;

    if (activeHighlight) {
      activeHighlight.classList.remove('ah-blinking');
    }
    activeHighlight = targetEl;
    activeHighlight.classList.add('ah-blinking');
    try { activeHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    setTimeout(function() {
      if (activeHighlight) activeHighlight.classList.remove('ah-blinking');
    }, 900);
  }
})();
