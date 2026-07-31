(function () {
  var HIGHLIGHT_TAG = 'ah-mark';
  var RAIL_TAG = 'ah-rail';
  var MAX_HIGHLIGHT_INDEX = 10000000;

  var isInIframe = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  var currentRules = [];
  var currentSettings = {};
  var highlightIndex = 0;
  var railEl = null;
  var activeHighlight = null;
  var bodyObserver = null;
  var shadowObservers = [];
  var isHighlighting = false;
  var railUpdateTimer = null;
  var tempKeywords = [];
  var hiddenKwIds = [];
  var manualShowKwIds = [];
  var cachedKeywordMap = null;
  var cachedKeywordMapTime = 0;
  var CACHE_TTL = 100;
  var railMarkTargets = [];
  var railMarkMap = new WeakMap();
  var batchTextNodes = null;
  var BATCH_SIZE = 200;
  var keywordGlobalOrder = {};
  var exclusiveStopOrder = -1;
  var pageDisabled = false;
  var navMarkIndex = {};
  var domOrderCache = new WeakMap();
  var domOrderCounter = 0;
  var highlightDirty = false;
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

  function getElTopPosition(el) {
    var rect = getSafeRect(el);
    if (rect) {
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
      return scrollTop + rect.top;
    }
    var order = domOrderCache.get(el);
    if (typeof order === 'number') return order;
    order = domOrderCounter++;
    domOrderCache.set(el, order);
    return order;
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
    if (msg.type === 'TEMP_HIGHLIGHT') {
      tempKeywords = msg.keywords || [];
      reHighlight();
    }
    if (msg.type === 'CLEAR_TEMP') {
      tempKeywords = [];
      reHighlight();
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
      var marks = getAllHighlightMarks();
      var keywordMap = {};
      var kwOrders = {};
      var kwExclusive = {};
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        var kwId = m.dataset.ahKeywordId;
        if (!keywordMap[kwId]) keywordMap[kwId] = 0;
        keywordMap[kwId]++;
        if (m.dataset.ahGlobalOrder !== undefined) {
          kwOrders[kwId] = parseInt(m.dataset.ahGlobalOrder, 10);
        }
        if (m.dataset.ahExclusive !== undefined) {
          kwExclusive[kwId] = m.dataset.ahExclusive === '1';
        }
      }
      sendResponse({ 
        total: marks.length, 
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
    if (msg.type === 'GET_TEMP_KEYWORDS') {
      sendResponse(tempKeywords);
      return true;
    }
    if (msg.type === 'GET_HIDDEN_IDS') {
      sendResponse(hiddenKwIds);
      return true;
    }
    if (msg.type === 'NAV_MARK') {
      navigateToMark(msg.kwId, msg.direction);
    }
    if (msg.type === 'CONTEXT_ADD_HIGHLIGHT') {
      var selText = msg.text;
      if (!selText) return;
      var rndColor = getRandomDistinctColor();
      var kw = { id: 'tmp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5), text: selText, matchType: 'contains', caseSensitive: false, acrossElements: false, color: rndColor };
      tempKeywords.push(kw);
      reHighlight();
      var settingsResp = {};
      try { settingsResp = currentSettings || {}; } catch (e2) {}
      sendResponse({ count: 1, settings: settingsResp });
    }
    if (msg.type === 'CONTEXT_SPOT_HIGHLIGHT') {
      var spotSelText = msg.text;
      if (!spotSelText) return;
      var spotColor = getRandomDistinctColor();
      var spotId = 's_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      var spotEl = highlightSelectedRange(spotSelText, spotColor);
      if (spotEl) {
        spotEl.dataset.ahSpotId = spotId;
        var siblings = spotEl.parentElement.querySelectorAll('ah-spot');
        var found = false;
        for (var si = 0; si < siblings.length; si++) {
          if (!siblings[si].dataset.ahSpotId && siblings[si].style.backgroundColor === spotEl.style.backgroundColor) {
            siblings[si].dataset.ahSpotId = spotId;
            found = true;
          }
        }
      }
      try {
        chrome.runtime.sendMessage({ type: 'STORE_SPOT_HIGHLIGHT', spotId: spotId, text: spotSelText, color: spotColor });
      } catch (e) {}
      var spotSettingsResp = {};
      try { spotSettingsResp = currentSettings || {}; } catch (e4) {}
      sendResponse({ settings: spotSettingsResp });
    }
    if (msg.type === 'SHORTCUT_ADD_HIGHLIGHT') {
      var selText = window.getSelection().toString();
      if (!selText) return;
      var rndColor = getRandomDistinctColor();
      var kw = { id: 'tmp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5), text: selText, matchType: 'contains', caseSensitive: false, acrossElements: false, color: rndColor };
      tempKeywords.push(kw);
      reHighlight();
      try {
        chrome.runtime.sendMessage({ type: 'SHORTCUT_HIGHLIGHT_DONE', action: 'add' });
      } catch (e) {}
    }
    if (msg.type === 'SHORTCUT_SPOT_HIGHLIGHT') {
      var spotSelText = window.getSelection().toString();
      if (!spotSelText) return;
      var spotColor = getRandomDistinctColor();
      var spotId = 's_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      var spotEl = highlightSelectedRange(spotSelText, spotColor);
      if (spotEl) {
        spotEl.dataset.ahSpotId = spotId;
        var siblings = spotEl.parentElement.querySelectorAll('ah-spot');
        for (var si = 0; si < siblings.length; si++) {
          if (!siblings[si].dataset.ahSpotId && siblings[si].style.backgroundColor === spotEl.style.backgroundColor) {
            siblings[si].dataset.ahSpotId = spotId;
          }
        }
      }
      try {
        chrome.runtime.sendMessage({ type: 'STORE_SPOT_HIGHLIGHT', spotId: spotId, text: spotSelText, color: spotColor });
        chrome.runtime.sendMessage({ type: 'SHORTCUT_HIGHLIGHT_DONE', action: 'spot' });
      } catch (e) {}
    }
    if (msg.type === 'DELETE_SPOT') {
      removeSpotHighlight(msg.spotId);
    }
    if (msg.type === 'UPDATE_SPOT_COLOR') {
      updateSpotColor(msg.spotId, msg.color);
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

  function requestRulesFromBackground() {
    chrome.runtime.sendMessage({ type: 'GET_MATCHED_RULES', url: location.href }, function (response) {
      if (chrome.runtime.lastError) {
        setTimeout(requestRulesFromBackground, 1500);
        return;
      }
      if (response && response.length > 0) {
        currentRules = response;
        requestSettingsFromBackground();
      }
    });
  }

  function requestSettingsFromBackground() {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, function (settings) {
      if (chrome.runtime.lastError) settings = {};
      currentSettings = settings || {};
      applyHighlight(currentRules, currentSettings);
    });
  }

  function applyHighlight(rules, settings) {
    currentRules = rules;
    currentSettings = settings;
    if (pageDisabled) return;

    var keywords = getActiveKeywords();
    if (keywords.length === 0) {
      var existingMarks = getAllHighlightMarks();
      if (existingMarks.length > 0) removeHighlights();
      if (!isInIframe) updateBadge();
      return;
    }

    removeHighlights();
    if (typeof Matcher === 'undefined') return;

    injectStylesToAllShadowRoots();

    precomputeExclusiveStopOrder(keywords);

    isHighlighting = true;
    highlightBatch(keywords, 0);
  }

  function injectStylesToAllShadowRoots() {
    var walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_ELEMENT);
    var el;
    while (el = walker.nextNode()) {
      if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
        injectShadowStyles(el.shadowRoot);
      }
    }
    if (document.body) {
      var bodyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (el = bodyWalker.nextNode()) {
        if (el.shadowRoot && el.shadowRoot.mode !== 'closed') {
          injectShadowStyles(el.shadowRoot);
        }
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
    var keywords = getActiveKeywords();
    if (keywords.length === 0) {
      var existingMarks = getAllHighlightMarks();
      if (existingMarks.length > 0) removeHighlights();
      if (!isInIframe) updateBadge();
      return;
    }

    removeHighlights();
    if (pageDisabled) return;

    injectStylesToAllShadowRoots();

    if (typeof Matcher === 'undefined') return;

    precomputeExclusiveStopOrder(keywords);

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

    injectStylesToAllShadowRoots();
    precomputeExclusiveStopOrder(keywords);

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

  function onHighlightBatchComplete() {
    batchTextNodes = null;
    isHighlighting = false;
    forceFullHighlight = false;
    if (!isInIframe && shouldShowRail()) createRail();
    setupBodyObserver();
    setupLazyHighlightScroll();
    applyVisibility();
    if (!isInIframe) updateBadge();
    if (pendingNavigation) {
      var nav = pendingNavigation;
      pendingNavigation = null;
      setTimeout(function () { navigateToMark(nav.kwId, nav.direction); }, 0);
    }
    if (pendingIncremental) {
      setTimeout(incrementalHighlight, 0);
    }
  }

  function highlightBatch(keywords, startIdx) {
    if (!batchTextNodes) batchTextNodes = getAllTextNodes();

    var hasAcross = false;
    for (var ak = 0; ak < keywords.length; ak++) {
      if (keywords[ak].acrossElements) { hasAcross = true; break; }
    }

    if (!hasAcross) {
      var end = Math.min(startIdx + BATCH_SIZE, batchTextNodes.length);
      for (var i = startIdx; i < end; i++) {
        var node = batchTextNodes[i];
        if (node && node.isConnected && isElementNearViewport(node.parentElement)) highlightTextNode(node, keywords);
      }
      if (end < batchTextNodes.length) {
        setTimeout(function () { highlightBatch(keywords, end); }, 0);
      } else {
        onHighlightBatchComplete();
      }
      return;
    }

    var normalKws = [];
    var acrossKws = [];
    for (var ak2 = 0; ak2 < keywords.length; ak2++) {
      if (keywords[ak2].acrossElements) acrossKws.push(keywords[ak2]);
      else normalKws.push(keywords[ak2]);
    }

    var end2 = Math.min(startIdx + BATCH_SIZE, batchTextNodes.length);
    for (var i2 = startIdx; i2 < end2; i2++) {
      var node2 = batchTextNodes[i2];
      if (!node2 || !node2.isConnected) continue;
      if (!isElementNearViewport(node2.parentElement)) continue;
      if (normalKws.length > 0) highlightTextNode(node2, normalKws);
    }

    if (end2 >= batchTextNodes.length) {
      if (acrossKws.length > 0) highlightAcrossElements(acrossKws, getAllTextNodes());
      onHighlightBatchComplete();
    } else {
      setTimeout(function () { highlightBatch(keywords, end2); }, 0);
    }
  }

  function highlightAcrossElements(keywords, allTextNodes) {
    var containerMap = {};
    var containerOrder = [];

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
        try {
          var matches;
          if (kw.matchType === 'wildcard') {
            var wildPat = kw.text
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '[\\s\\S]*?')
              .replace(/\?/g, '[\\s\\S]');
            var wildFlags = kw.caseSensitive ? 'g' : 'gi';
            var wildRegex = new RegExp(wildPat, wildFlags);
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
            matches[mi].color = kw.color || currentSettings.defaultColor || '#ffeb3b';
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
        var isTempKwAp = allMatches[ap].keywordId && allMatches[ap].keywordId.indexOf('tmp_') === 0;
        allMatches[ap]._hide = !isTempKwAp && exclusiveStopOrder >= 0 && !allMatches[ap].exclusive;
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

  function buildTextNodeGroups(allTextNodes) {
    return [];
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
    lazyHighlightBatch(normalKws, nearNodes, 0);
  }

  function lazyHighlightBatch(keywords, nodes, startIdx) {
    if (!isLazyHighlighting) return;

    var end = Math.min(startIdx + BATCH_SIZE, nodes.length);
    for (var i = startIdx; i < end; i++) {
      var node = nodes[i];
      if (node && node.isConnected) highlightTextNode(node, keywords);
    }

    if (end < nodes.length) {
      setTimeout(function () { lazyHighlightBatch(keywords, nodes, end); }, 0);
    } else {
      isLazyHighlighting = false;
      var visChanged = applyVisibility();
      if (!visChanged && !isInIframe) {
        if (shouldShowRail()) { if (!railEl) createRail(); else renderRail(); }
        updateBadge();
      }
      if (pendingIncremental) {
        setTimeout(incrementalHighlight, 0);
      }
    }
  }

  function applyCrossNodeMatch(nodeGroup, offsets, match) {
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
      mark.dataset.ahIndex = String(highlightIndex);
      highlightIndex++;
      if (highlightIndex > MAX_HIGHLIGHT_INDEX) highlightIndex = 0;

      var isTempKw = match.keywordId && match.keywordId.indexOf('tmp_') === 0;
      var matchHide = match._hide !== undefined ? match._hide : (!isTempKw && exclusiveStopOrder >= 0 && !match.exclusive);
      if (matchHide) {
        mark.style.backgroundColor = 'transparent';
        mark.style.color = 'inherit';
        mark.style.padding = '0';
        mark.style.borderRadius = '0';
        mark.dataset.ahHidden = 'true';
      } else {
        mark.style.backgroundColor = match.color;
        mark.style.color = getContrastColor(match.color);
        mark.style.padding = '0';
        mark.style.borderRadius = '2px';
      }
      fragment.appendChild(mark);
      if (afterText) fragment.appendChild(document.createTextNode(afterText));
      try { parent.replaceChild(fragment, node); } catch (e) {}
    }
  }

  function updateBadge() {
    var marks = getAllHighlightMarks();
    var count = 0;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var kwId = m.dataset.ahKeywordId;
      var isTempKw = kwId && kwId.indexOf('tmp_') === 0;
      var isManuallyShown = manualShowKwIds.indexOf(kwId) >= 0;
      var isManuallyHidden = hiddenKwIds.indexOf(kwId) >= 0;
      var isExclusiveMark = m.dataset.ahExclusive === '1';
      var isHiddenByExclusive = !isTempKw && exclusiveStopOrder >= 0 && !isExclusiveMark;
      
      if (isManuallyHidden && !isManuallyShown) continue;
      if (isHiddenByExclusive && !isManuallyShown) continue;
      if (m.dataset.ahHidden === 'true' && !isManuallyShown) continue;
      count++;
    }
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: count });
    } catch (e) {}
  }

  var ALL_SPOT_COLORS = ['#ffeb3b','#ff6b6b','#a8e6cf','#ffd93d','#6bcb77','#4d96ff','#c084fc','#fb923c','#f48fb1','#80cbc4','#b39ddb','#90caf9','#fff176','#ffab91','#a5d6a7','#ce93d8'];

  function getRandomDistinctColor() {
    var usedColors = [];
    var tempMarks = document.querySelectorAll(HIGHLIGHT_TAG);
    for (var i = 0; i < tempMarks.length; i++) {
      var color = tempMarks[i].style.backgroundColor;
      if (color && usedColors.indexOf(color) === -1) usedColors.push(color);
    }
    var spotMarks = document.querySelectorAll('ah-spot');
    for (var j = 0; j < spotMarks.length; j++) {
      var sc = spotMarks[j].style.backgroundColor;
      if (sc && usedColors.indexOf(sc) === -1) usedColors.push(sc);
    }
    for (var ti = 0; ti < tempKeywords.length; ti++) {
      var tc = tempKeywords[ti].color;
      if (tc && usedColors.indexOf(tc) === -1) usedColors.push(tc);
    }
    var shuffled = ALL_SPOT_COLORS.slice().sort(function () { return Math.random() - 0.5; });
    for (var si = 0; si < shuffled.length; si++) {
      if (usedColors.indexOf(shuffled[si]) === -1) return shuffled[si];
    }
    return shuffled[Math.floor(Math.random() * shuffled.length)];
  }

  function highlightSelectedRange(text, color) {
    try {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var range = sel.getRangeAt(0);
      if (range.collapsed) return null;
      var wrapper = document.createElement('ah-spot');
      wrapper.style.cssText = 'background-color:' + color + ';padding:1px 0;border-radius:2px;';
      try { range.surroundContents(wrapper); sel.removeAllRanges(); return wrapper; } catch (e) {}
      var treeWalker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        { acceptNode: function () { return NodeFilter.FILTER_ACCEPT; } }
      );
      var nodes = [];
      while (treeWalker.nextNode()) {
        if (range.intersectsNode(treeWalker.currentNode)) nodes.push(treeWalker.currentNode);
      }
      if (nodes.length === 0) {
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

  function updateSpotColor(spotId, color) {
    var els = document.querySelectorAll('ah-spot[data-ah-spot-id="' + spotId + '"]');
    for (var ui = 0; ui < els.length; ui++) {
      els[ui].style.backgroundColor = color;
      els[ui].style.cssText = 'background-color:' + color + ';padding:1px 0;border-radius:2px;';
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
      var kwId = h.dataset.ahKeywordId;
      if (!kwId) continue;
      var isTempKw = kwId.indexOf('tmp_') === 0;
      var isManuallyShown = manualShowKwIds.indexOf(kwId) >= 0;
      var isManuallyHidden = hiddenKwIds.indexOf(kwId) >= 0;
      var isExclusiveMark = h.dataset.ahExclusive === '1';
      var isHiddenByExclusive = !isTempKw && exclusiveStopOrder >= 0 && !isExclusiveMark;
      
      if (isManuallyHidden && !isManuallyShown) continue;
      if (isHiddenByExclusive && !isManuallyShown) continue;
      if (h.dataset.ahHidden === 'true' && !isManuallyShown) continue;
      
      if (!keywordMap[kwId]) keywordMap[kwId] = { text: h.dataset.ahKeywordText || '', color: h.style.backgroundColor, elements: [] };
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
          if (isHidden(parent)) return NodeFilter.FILTER_REJECT;
          var p = parent.parentElement;
          while (p && p !== root && p !== docRoot) {
            if (isHidden(p)) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
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
      if (tempKeywords[k].text) {
        keywordGlobalOrder[tempKeywords[k].id] = order++;
        keywords.push(tempKeywords[k]);
      }
    }
    return keywords;
  }

  function highlightTextNode(textNode, keywords) {
    var text = textNode.textContent;
    var allMatches = [];
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      try {
        var matches = Matcher.getMatches(text, kw.text, kw.matchType, kw.caseSensitive);
        for (var j = 0; j < matches.length; j++) {
          matches[j].keywordId = kw.id || '__temp__';
          matches[j].color = kw.color || currentSettings.defaultColor || '#ffeb3b';
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
      var isTempKwP = allMatches[p].keywordId && allMatches[p].keywordId.indexOf('tmp_') === 0;
      allMatches[p]._hide = !isTempKwP && exclusiveStopOrder >= 0 && !allMatches[p].exclusive;
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
      mark.dataset.ahIndex = String(highlightIndex);
      highlightIndex++;
      if (highlightIndex > MAX_HIGHLIGHT_INDEX) highlightIndex = 0;

      if (match._hide) {
        mark.style.backgroundColor = 'transparent';
        mark.style.color = 'inherit';
        mark.style.padding = '0';
        mark.style.borderRadius = '0';
        mark.dataset.ahHidden = 'true';
      } else {
        mark.style.backgroundColor = match.color;
        mark.style.color = getContrastColor(match.color);
        mark.style.padding = '0';
        mark.style.borderRadius = '2px';
      }

      fragment.appendChild(mark);
      lastEnd = match.end;
    }
    if (lastEnd < text.length) fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    try { parent.replaceChild(fragment, textNode); } catch (e) {}
  }

  function getContrastColor(hexColor) {
    if (!hexColor || hexColor.charAt(0) !== '#') return '#000000';
    var hex = hexColor.replace('#', '');
    if (hex.length < 6) return '#000000';
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return '#000000';
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
  }

  function applyVisibility() {
    invalidateKeywordMapCache();
    var marks = getAllHighlightMarks();
    var changed = false;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var kwId = m.dataset.ahKeywordId;
      var isTempKw = kwId && kwId.indexOf('tmp_') === 0;
      var isManuallyShown = manualShowKwIds.indexOf(kwId) >= 0;
      var isExclusiveMark = m.dataset.ahExclusive === '1';
      var isHiddenByExclusive = !isTempKw && exclusiveStopOrder >= 0 && !isExclusiveMark;
      var isManuallyHidden = hiddenKwIds.indexOf(kwId) >= 0;

      if (isManuallyHidden && !isManuallyShown) {
        if (m.dataset.ahHidden !== 'true') {
          m.style.backgroundColor = 'transparent';
          m.style.color = 'inherit';
          m.style.padding = '0';
          m.style.borderRadius = '0';
          m.dataset.ahHidden = 'true';
          changed = true;
        }
        continue;
      }

      if (isHiddenByExclusive && !isManuallyShown) {
        if (m.dataset.ahHidden !== 'true') {
          m.style.backgroundColor = 'transparent';
          m.style.color = 'inherit';
          m.style.padding = '0';
          m.style.borderRadius = '0';
          m.dataset.ahHidden = 'true';
          changed = true;
        }
        continue;
      }

      if (m.dataset.ahHidden === 'true' || isManuallyShown) {
        var wasHidden = m.dataset.ahHidden === 'true';
        m.dataset.ahHidden = '';
        var color = currentSettings.defaultColor || '#ffeb3b';
        for (var j = 0; j < currentRules.length; j++) {
          if (!currentRules[j].keywords) continue;
          for (var k = 0; k < currentRules[j].keywords.length; k++) {
            if (currentRules[j].keywords[k].id === kwId) {
              color = currentRules[j].keywords[k].color || color;
              break;
            }
          }
        }
        for (var l = 0; l < tempKeywords.length; l++) {
          if (tempKeywords[l].id === kwId) {
            color = tempKeywords[l].color || color;
            break;
          }
        }
        m.style.backgroundColor = color;
        m.style.color = getContrastColor(color);
        m.style.padding = '0';
        m.style.borderRadius = '2px';
        if (wasHidden) changed = true;
      }
    }
    if (changed && !isInIframe) {
      if (shouldShowRail()) { if (!railEl) createRail(); else renderRail(); }
      else if (railEl) { railEl.remove(); railEl = null; }
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
    navMarkIndex = {};
    highlightDirty = false;
    pendingIncremental = false;
    if (highlightIndex > MAX_HIGHLIGHT_INDEX) highlightIndex = 0;
    var marks = getAllHighlightMarks();
    if (marks.length > 0) {
      for (var i = 0; i < marks.length; i++) {
        var el = marks[i];
        var parent = el.parentNode;
        if (!parent) continue;
        try { parent.replaceChild(document.createTextNode(el.textContent), el); } catch (e) {}
      }
      try { document.normalize(); } catch (e) {}
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
    if (!shadowRoot || shadowRoot.querySelector('style[data-ah-style]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-ah-style', '1');
    style.textContent = 'ah-mark{transition:outline 0.15s}@keyframes ah-blink{0%,100%{opacity:1}50%{opacity:0.3}}ah-mark.ah-blinking{animation:ah-blink 0.3s ease-in-out 3}';
    shadowRoot.appendChild(style);
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
    window.removeEventListener('scroll', scheduleRailUpdate, true);
    window.addEventListener('resize', scheduleRailUpdate);
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

  function navigateToMark(kwId, direction) {
    if (kwId && kwId.indexOf('spot_') === 0) {
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
      return;
    }
    var allMarks = getAllHighlightMarks();
    var kwMarks = [];
    for (var i = 0; i < allMarks.length; i++) {
      var m = allMarks[i];
      if (m.dataset.ahKeywordId !== kwId) continue;
      if (m.dataset.ahHidden === 'true') continue;
      if (!m.isConnected) continue;
      kwMarks.push(m);
    }
    if (kwMarks.length === 0) {
      if (!forceFullHighlight) {
        forceFullHighlight = true;
        pendingNavigation = { kwId: kwId, direction: direction };
        reHighlight();
      }
      return;
    }

    kwMarks.sort(function (a, b) {
      return getElTopPosition(a) - getElTopPosition(b);
    });

    if (!(kwId in navMarkIndex)) navMarkIndex[kwId] = -1;

    if (direction === 'next') {
      navMarkIndex[kwId]++;
      if (navMarkIndex[kwId] >= kwMarks.length) navMarkIndex[kwId] = 0;
    } else {
      navMarkIndex[kwId]--;
      if (navMarkIndex[kwId] < 0) navMarkIndex[kwId] = kwMarks.length - 1;
    }

    var target = kwMarks[navMarkIndex[kwId]];
    if (!target || !target.isConnected) return;

    try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
    if (activeHighlight) activeHighlight.classList.remove('ah-blinking');
    activeHighlight = target;
    activeHighlight.classList.add('ah-blinking');
    setTimeout(function () { if (activeHighlight) activeHighlight.classList.remove('ah-blinking'); }, 900);

    try {
      chrome.runtime.sendMessage({ type: 'NAV_MARK_RESULT', kwId: kwId, index: navMarkIndex[kwId], total: kwMarks.length });
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
