document.addEventListener('DOMContentLoaded', function () {
  var pageToggle = document.getElementById('pageToggle');
  var railToggle = document.getElementById('railToggle');
  var searchInput = document.getElementById('searchInput');
  var btnSearch = document.getElementById('btnSearch');
  var tempSection = document.getElementById('tempSection');
  var tempList = document.getElementById('tempList');
  var tempCountEl = document.getElementById('tempCount');
  var ruleSection = document.getElementById('ruleSection');
  var ruleListEl = document.getElementById('ruleList');
  var ruleCountEl = document.getElementById('ruleCount');
  var emptyHint = document.getElementById('emptyHint');
  var btnManageRules = document.getElementById('btnManageRules');
  var btnHistory = document.getElementById('btnHistory');
  var historyDropdown = document.getElementById('historyDropdown');
  var spotSection = document.getElementById('spotSection');
  var spotList = document.getElementById('spotList');
  var spotCountEl = document.getElementById('spotCount');

  var currentTabUrl = '';
  var currentTabHost = '';
  var currentTabId = null;
  var tempKeywords = [];
  var spotKeywords = [];
  var matchedRules = [];
  var hiddenKwIds = new Set();
  var manualShowKwIds = new Set();
  var highlightCounts = {};
  var exclusiveStopOrder = -1;
  var kwOrders = {};
  var kwExclusive = {};
  var pageDisabled = false;
  var stylePresets = [];
  var selectedTempStyle = null;
  var currentSettings = {};
  var selectedMatchType = 'contains';
  var caseSensitive = false;
  var acrossElements = false;
  var historyEnabled = true;
  var tempHistory = [];
  var historyOpen = false;
  var historyIndex = -1;
  var navIndexMap = {};
  var cppTarget = null;
  var cppPopup = null;
  var cppStyleBody = null;
  var cppStyleEditor = null;
  var cppCancel = null;
  var cppApply = null;
  var cppOpenSnapshot = '';
  var styleBar = null;

  cppPopup = document.getElementById('colorPickerPopup');
  cppStyleBody = document.getElementById('cppStyleBody');
  cppCancel = document.getElementById('cppCancel');
  cppApply = document.getElementById('cppApply');

  /** 模板串里只能放占位符，插入 DOM 后再用 StyleKit 渲染，保证三端预览规则一致 */
  function previewPlaceholder(style, action, idAttr, extraAttrs) {
    var json = CommonKit.escapeHtml(JSON.stringify(StyleKit.makeStyle(style)));
    return '<span class="kw-preview" data-style="' + json + '"' +
      (action ? ' data-action="' + action + '"' : '') +
      (idAttr ? ' ' + idAttr : '') +
      (extraAttrs || '') +
      ' title="点击修改样式"></span>';
  }

  function hydratePreviews(container) {
    var els = container.querySelectorAll('.kw-preview[data-style]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var parsed;
      try { parsed = JSON.parse(el.dataset.style); } catch (e) { parsed = null; }
      if (parsed) StyleKit.renderPreview(el, StyleKit.makeStyle(parsed), 28, 20);
    }
  }

  function findRuleKeyword(kwId) {
    for (var ri = 0; ri < matchedRules.length; ri++) {
      var rule = matchedRules[ri];
      for (var ki = 0; ki < (rule.keywords || []).length; ki++) {
        if (rule.keywords[ki].id === kwId) return rule.keywords[ki];
      }
    }
    return null;
  }

  async function updateRuleKeyword(kwId, changes) {
    var allRules = await Storage.getRules();
    for (var ri = 0; ri < allRules.length; ri++) {
      var rule = allRules[ri];
      for (var ki = 0; ki < (rule.keywords || []).length; ki++) {
        if (rule.keywords[ki].id === kwId) {
          for (var key in changes) {
            if (changes.hasOwnProperty(key)) {
              rule.keywords[ki][key] = changes[key];
            }
          }
          await Storage.saveRules(allRules);
          chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(function () {});
          fetchHighlightCounts();
          return;
        }
      }
    }
  }

  /** 把当前临时高亮默认样式持久化（只存有显式值的字段，undefined 字段不落盘），下次打开弹窗仍是它 */
  function persistTempStyle() {
    Storage.getSettings().then(function (s) {
      s.tempStyle = StyleKit.keywordOverrides(selectedTempStyle);
      return Storage.saveSettings(s);
    }).catch(function () {});
  }

  Storage.getSettings().then(function (settings) {
    railToggle.checked = settings.showRail !== false;
    currentSettings = settings;
    // Storage.getSettings 已做过迁移，这里再 normalize 一次以兼容直接导入的旧数据
    stylePresets = StyleKit.normalizePresets(settings.stylePresets || settings.colorPresets);
    // 临时高亮默认样式优先读记忆值；从未设置过则取全局默认（预设第一项）
    selectedTempStyle = settings.tempStyle
      ? StyleKit.keywordOverrides(settings.tempStyle)
      : StyleKit.keywordOverrides(stylePresets[0] || StyleKit.getDefaultStyle(settings));
    historyEnabled = settings.historyEnabled !== false;
    tempHistory = Array.isArray(settings.tempHistory) ? settings.tempHistory.slice() : [];
    if (settings.defaultMatchType) selectedMatchType = settings.defaultMatchType;
    if (settings.defaultCaseSensitive) caseSensitive = true;
    if (settings.defaultAcrossElements) acrossElements = true;
    // 共享样式选项栏：popup 搜索区 / 管理关键词弹窗 / 编辑关键词样式弹窗 三处复用同一组件（mountStyleBar）
    styleBar = StyleEditor.mountStyleBar(document.getElementById('searchOptionsBar'), {
      presets: stylePresets,
      currentStyle: selectedTempStyle,
      settings: currentSettings,
      matchType: selectedMatchType,
      caseSensitive: caseSensitive,
      acrossElements: acrossElements,
      onStateChange: function (s) {
        selectedMatchType = s.matchType;
        caseSensitive = s.caseSensitive;
        acrossElements = s.acrossElements;
        selectedTempStyle = s.style;
        persistTempStyle();
      },
      onEditStyle: function () {
        cppTarget = { isTempStyle: true };
        openStylePanel(selectedTempStyle, null);
      }
    });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      currentTabUrl = tabs[0].url || '';
      currentTabId = tabs[0].id;
      try { currentTabHost = new URL(currentTabUrl).hostname; } catch (e) { currentTabHost = currentTabUrl; }
      chrome.runtime.sendMessage({ type: 'REFRESH_HIGHLIGHT' }).catch(function () {});
      loadMatchedRules();
      loadTempKeywords();
      loadSpotKeywords();
    }
  });

  async function loadMatchedRules() {
    var allRules = await Storage.getRules();
    matchedRules = allRules.filter(function (r) {
      return r.enabled && Matcher.matchUrl(currentTabUrl, r.urlPattern, r.urlMatchType);
    });
    fetchHighlightCounts();
  }

  function loadTempKeywords() {
    var timeoutId = setTimeout(function () {
      tempKeywords = [];
      renderAll();
    }, 2000);
    chrome.runtime.sendMessage({ type: 'GET_TEMP_KEYWORDS' }, function (resp) {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError || !Array.isArray(resp)) { tempKeywords = []; }
      else { tempKeywords = resp; }
      renderAll();
    });
  }

  function loadSpotKeywords() {
    chrome.runtime.sendMessage({ type: 'GET_SPOT_HIGHLIGHTS' }, function (resp) {
      if (chrome.runtime.lastError || !Array.isArray(resp)) { spotKeywords = []; }
      else { spotKeywords = resp; }
      renderAll();
    });
  }

  function fetchHighlightCounts() {
    var timeoutId = setTimeout(function () {
      highlightCounts = {};
      renderAll();
    }, 2000);
    chrome.runtime.sendMessage({ type: 'GET_HIGHLIGHT_COUNT' }, function (resp) {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError || !resp) { highlightCounts = {}; }
      else {
        highlightCounts = resp.byKeyword || {};
        if (resp.hiddenIds && Array.isArray(resp.hiddenIds)) {
          hiddenKwIds = new Set(resp.hiddenIds);
        }
        if (resp.manualShowIds && Array.isArray(resp.manualShowIds)) {
          manualShowKwIds = new Set(resp.manualShowIds);
        }
        exclusiveStopOrder = typeof resp.exclusiveStopOrder === 'number' ? resp.exclusiveStopOrder : -1;
        kwOrders = resp.kwOrders || {};
        kwExclusive = resp.kwExclusive || {};
        pageDisabled = resp.pageDisabled === true;
        pageToggle.checked = !pageDisabled;
      }
      renderAll();
    });
  }

  function renderAll() {
    renderTempSection();
    renderSpotSection();
    renderRuleSection();
    // 预览块在模板串里只是占位符，插入 DOM 后统一渲染
    hydratePreviews(tempList);
    hydratePreviews(spotList);
    hydratePreviews(ruleListEl);
    var hasAny = tempKeywords.length > 0 || spotKeywords.length > 0 || matchedRules.some(function (r) {
      return (r.keywords || []).some(function (k) { return k.enabled && (highlightCounts[k.id] || 0) > 0; });
    });
    emptyHint.style.display = hasAny ? 'none' : '';
  }

  function renderTempSection() {
    if (tempKeywords.length === 0) { tempSection.style.display = 'none'; return; }
    tempSection.style.display = '';
    tempCountEl.textContent = tempKeywords.length;

    tempList.innerHTML = tempKeywords.map(function (kw) {
      var isExclusive = kwExclusive[kw.id] || kw.exclusive || false;
      var isManuallyHidden = hiddenKwIds.has(kw.id);
      var exclusiveIcon = isExclusive ? '<span class="kw-exclusive-icon" title="匹配即停">⭐</span>' : '';
      var kwCount = highlightCounts[kw.id] || 0;
      var kwCase = kw.caseSensitive || false;
      var kwAcross = kw.acrossElements || false;
      var kwMt = kw.matchType || 'contains';

      return '<div class="kw-item" data-kw-id="' + kw.id + '">' +
        previewPlaceholder(StyleKit.resolveStyle(kw, currentSettings), 'change-color', 'data-kw-id="' + kw.id + '" data-is-temp="1"') +
        exclusiveIcon +
        '<span class="kw-text' + (isManuallyHidden ? ' dim' : '') + '" title="' + CommonKit.escapeHtml(kw.text) + '">' + CommonKit.escapeHtml(kw.name || kw.text) + '</span>' +
        '<select class="kw-match-type-select" data-action="change-match-type" data-kw-id="' + kw.id + '" data-is-temp="1">' +
          '<option value="contains"' + (kwMt === 'contains' ? ' selected' : '') + '>包含</option>' +
          '<option value="exact"' + (kwMt === 'exact' ? ' selected' : '') + '>精确</option>' +
          '<option value="regex"' + (kwMt === 'regex' ? ' selected' : '') + '>正则</option>' +
          '<option value="wildcard"' + (kwMt === 'wildcard' ? ' selected' : '') + '>通配</option>' +
        '</select>' +
        '<button class="toggle-opt-btn' + (kwCase ? ' active' : '') + '" data-action="toggle-case" data-kw-id="' + kw.id + '" data-is-temp="1" title="' + (kwCase ? '区分大小写：开' : '区分大小写：关') + '">Aa</button>' +
        '<button class="toggle-opt-btn across' + (kwAcross ? ' active' : '') + '" data-action="toggle-across" data-kw-id="' + kw.id + '" data-is-temp="1" title="' + (kwAcross ? '跨元素匹配：开' : '跨元素匹配：关') + '">↔</button>' +
        '<div class="kw-actions">' +
          '<span class="kw-nav-index" data-kw-id="' + kw.id + '">' + (kwCount === 0 ? '0' : ((navIndexMap[kw.id] || 0) + 1)) + '/' + kwCount + '</span>' +
          '<button class="kw-nav-btn" data-action="nav-prev" data-kw-id="' + kw.id + '" title="上一个"' + (kwCount === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="kw-nav-btn" data-action="nav-next" data-kw-id="' + kw.id + '" title="下一个"' + (kwCount === 0 ? ' disabled' : '') + '>▼</button>' +
          '<button class="btn btn-sm" data-action="toggle-temp" data-kw-id="' + kw.id + '" title="' + (isManuallyHidden ? '显示' : '隐藏') + '">' + (isManuallyHidden ? '👁' : '👁‍🗨') + '</button>' +
          '<button class="btn btn-sm" data-action="save-temp" data-kw-id="' + kw.id + '" title="永久保存">💾</button>' +
          '<button class="btn btn-sm btn-danger" data-action="del-temp" data-kw-id="' + kw.id + '" title="删除">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var hasManualOps = tempKeywords.some(function (kw) { return hiddenKwIds.has(kw.id); });
    if (hasManualOps) {
      var existingBadge = tempSection.querySelector('.manual-clear-badge');
      if (!existingBadge) {
        var badge = document.createElement('div');
        badge.className = 'manual-clear-badge';
        badge.innerHTML = '<button class="btn btn-sm" data-action="clear-manual" title="重置所有手动操作">重置</button>';
        tempSection.appendChild(badge);
      }
    } else {
      var existingBadge2 = tempSection.querySelector('.manual-clear-badge');
      if (existingBadge2) existingBadge2.remove();
    }
  }

  function renderSpotSection() {
    if (spotKeywords.length === 0) { spotSection.style.display = 'none'; return; }
    spotSection.style.display = '';
    spotCountEl.textContent = spotKeywords.length;

    spotList.innerHTML = spotKeywords.map(function (spot) {
      return '<div class="kw-item" data-spot-id="' + spot.id + '">' +
        previewPlaceholder(StyleKit.resolveStyle(spot, currentSettings), 'change-spot-color', 'data-spot-id="' + spot.id + '"') +
        '<span class="kw-text" title="' + CommonKit.escapeHtml(spot.text) + '">' + CommonKit.escapeHtml(spot.text) + '</span>' +
        '<span class="kw-type">高亮此处</span>' +
        '<div class="kw-actions">' +
          '<button class="btn btn-sm" data-action="nav-spot" data-spot-id="' + spot.id + '" title="定位到此处">📍</button>' +
          '<button class="btn btn-sm btn-danger" data-action="del-spot" data-spot-id="' + spot.id + '" title="删除">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderRuleSection() {
    var allKws = [];
    for (var ri = 0; ri < matchedRules.length; ri++) {
      var rule = matchedRules[ri];
      var displayName = rule.name || rule.urlPattern;
      for (var ki = 0; ki < (rule.keywords || []).length; ki++) {
        var kw = rule.keywords[ki];
        if (!kw.enabled || !kw.text) continue;
        var count = highlightCounts[kw.id] || 0;
        if (count === 0) continue;
        var order = kwOrders[kw.id];
        var isExclusive = kwExclusive[kw.id] || kw.exclusive || false;
        var isHiddenByExclusive = exclusiveStopOrder >= 0 && typeof order === 'number' && order !== exclusiveStopOrder;
        allKws.push({
          id: kw.id,
          text: kw.text,
          name: kw.name,
          color: kw.color,
          matchType: kw.matchType,
          ruleId: rule.id,
          ruleName: displayName,
          count: count,
          order: order,
          isExclusive: isExclusive,
          isHiddenByExclusive: isHiddenByExclusive
        });
      }
    }

    allKws.sort(function (a, b) {
      var orderA = typeof a.order === 'number' ? a.order : 999999;
      var orderB = typeof b.order === 'number' ? b.order : 999999;
      return orderA - orderB;
    });

    if (allKws.length === 0) { ruleSection.style.display = 'none'; return; }
    ruleSection.style.display = '';

    var total = 0;
    for (var ai = 0; ai < allKws.length; ai++) {
      var akw = allKws[ai];
      var isManuallyShown = manualShowKwIds.has(akw.id);
      var isManuallyHidden = hiddenKwIds.has(akw.id);
      var isEffectivelyHidden = isManuallyHidden || (akw.isHiddenByExclusive && !isManuallyShown);
      if (!isEffectivelyHidden) {
        total += akw.count;
      }
    }
    ruleCountEl.textContent = total + ' 处';

    var hasManualOps = allKws.some(function (kw) { return manualShowKwIds.has(kw.id) || hiddenKwIds.has(kw.id); });

    ruleListEl.innerHTML = allKws.map(function (kw) {
      var isManuallyShown = manualShowKwIds.has(kw.id);
      var isManuallyHidden = hiddenKwIds.has(kw.id);
      var isEffectivelyHidden = isManuallyHidden || (kw.isHiddenByExclusive && !isManuallyShown);
      var exclusiveIcon = kw.isExclusive ? '<span class="kw-exclusive-icon" title="匹配即停">⭐</span>' : '';

      var statusClass = '';
      if (kw.isHiddenByExclusive && !isManuallyShown) {
        statusClass = 'kw-auto-hidden';
      }

      return '<div class="kw-item ' + statusClass + '" data-kw-id="' + kw.id + '" data-rule-id="' + kw.ruleId + '">' +
        '<span class="kw-rule-name" title="' + CommonKit.escapeHtml(kw.ruleName) + '">' + CommonKit.escapeHtml(kw.ruleName) + '</span>' +
        previewPlaceholder(StyleKit.resolveStyle(kw, currentSettings), '', '') +
        exclusiveIcon +
        '<span class="kw-text' + (isEffectivelyHidden ? ' dim' : '') + '" title="' + CommonKit.escapeHtml(kw.text) + '">' + CommonKit.escapeHtml(kw.name || kw.text) + '</span>' +
        '<span class="kw-type">' + CommonKit.getMatchTypeLabel(kw.matchType) + '</span>' +
        '<div class="kw-actions">' +
          '<span class="kw-nav-index" data-kw-id="' + kw.id + '">' + (kw.count === 0 ? '0' : ((navIndexMap[kw.id] || 0) + 1)) + '/' + kw.count + '</span>' +
          '<button class="kw-nav-btn" data-action="nav-prev" data-kw-id="' + kw.id + '" title="上一个"' + (kw.count === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="kw-nav-btn" data-action="nav-next" data-kw-id="' + kw.id + '" title="下一个"' + (kw.count === 0 ? ' disabled' : '') + '>▼</button>' +
          '<button class="btn btn-sm" data-action="toggle-rule-kw" data-kw-id="' + kw.id + '" title="' + (isEffectivelyHidden ? '显示' : '隐藏') + '">' + (isEffectivelyHidden ? '👁' : '👁‍🗨') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    if (hasManualOps) {
      var existingBadge = ruleSection.querySelector('.manual-clear-badge');
      if (!existingBadge) {
        var badge = document.createElement('div');
        badge.className = 'manual-clear-badge';
        badge.innerHTML = '<button class="btn btn-sm" data-action="clear-manual" title="重置所有手动操作">重置</button>';
        ruleSection.appendChild(badge);
      }
    } else {
      var existingBadge2 = ruleSection.querySelector('.manual-clear-badge');
      if (existingBadge2) existingBadge2.remove();
    }
  }

  function openStylePanel(style, anchorEl) {
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      var popupW = 300;
      var popupH = 320;
      var viewW = document.documentElement.clientWidth || document.body.clientWidth || 420;
      var viewH = document.documentElement.clientHeight || document.body.clientHeight || 640;
      var left = Math.min(rect.left, viewW - popupW - 8);
      if (left < 8) left = 8;
      var topBelow = rect.bottom + 4;
      var topAbove = rect.top - popupH - 4;
      var useTop;
      if (topBelow + popupH > viewH - 8) {
        useTop = topAbove > 8 ? topAbove : Math.max(8, viewH - popupH - 8);
      } else {
        useTop = topBelow;
      }
      cppPopup.style.left = left + 'px';
      cppPopup.style.top = useTop + 'px';
    }
    // 与设置页同一套带开关的样式编辑器
    cppStyleEditor = StyleEditor.mountStyleEditor(cppStyleBody, StyleKit.resolveStyle(style || {}, currentSettings), StyleKit.keywordOverrides(style || {}), { bgColor: (stylePresets[0] || {}).bgColor });
    cppPopup.classList.add('show');
    // 记录打开时的快照：点击面板外部时据此判断是否有未保存改动
    try { cppOpenSnapshot = JSON.stringify(cppStyleEditor.read()); } catch (e) { cppOpenSnapshot = ''; }
  }

  function closeColorPicker() {
    cppPopup.classList.remove('show');
    cppTarget = null;
    cppStyleEditor = null;
  }

  function applyStyle(overrides) {
    if (!cppTarget) return;
    if (cppTarget.isTempStyle) {
      // 搜索区临时样式：应用到「新增临时关键词」的默认样式并持久化记忆
      selectedTempStyle = StyleKit.keywordOverrides(overrides);
      persistTempStyle();
      closeColorPicker();
      if (styleBar) styleBar.setState({ style: selectedTempStyle });
      return;
    }
    if (cppTarget.isSpot) {
      // spot 应用整个样式（背景 + 文字含自动反色），并更新本地与后台存储
      chrome.runtime.sendMessage({ type: 'UPDATE_SPOT_STYLE', spotId: cppTarget.spotId, style: overrides }).catch(function () {});
      var spot = spotKeywords.find(function (s) { return s.id === cppTarget.spotId; });
      if (spot) Object.assign(spot, StyleKit.keywordOverrides(overrides));
      closeColorPicker();
      renderAll();
      return;
    }
    if (cppTarget.isTemp) {
      StyleKit.applyStyleToKeyword(cppTarget.kw, overrides);
      sendTempHighlight();
    } else {
      // 只传有显式值的字段；undefined 字段即让关键词恢复「跟随全局默认」
      updateRuleKeyword(cppTarget.kwId, StyleKit.keywordOverrides(overrides));
    }
    closeColorPicker();
    renderAll();
  }

  cppApply.addEventListener('click', function () {
    if (cppStyleEditor) applyStyle(cppStyleEditor.read());
  });

  cppCancel.addEventListener('click', closeColorPicker);

  function sendTempHighlight() {
    var visible = tempKeywords.filter(function (kw) { return !hiddenKwIds.has(kw.id); });
    chrome.runtime.sendMessage({ type: 'TEMP_HIGHLIGHT', keywords: visible }).catch(function () {});
    setTimeout(fetchHighlightCounts, 600);
  }

  function sendHiddenIds() {
    chrome.runtime.sendMessage({
      type: 'SET_HIDDEN_IDS',
      hiddenIds: Array.from(hiddenKwIds),
      manualShowIds: Array.from(manualShowKwIds)
    }).catch(function () {});
  }

  /** 临时高亮保存为永久规则：自渲染网址输入弹窗，替代原生 prompt，与弹窗风格统一 */
  function showSaveUrlModal(kw) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal">' +
        '<h3>永久保存关键词到规则</h3>' +
        '<div class="modal-tip">请输入匹配的网址（当前网站：' + CommonKit.escapeHtml(currentTabHost) + '）</div>' +
        '<input type="text" id="saveUrlInput" value="' + CommonKit.escapeHtml(currentTabHost) + '">' +
        '<div class="modal-actions">' +
          '<button class="btn" id="saveUrlCancel">取消</button>' +
          '<button class="btn btn-primary" id="saveUrlOk">保存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#saveUrlInput');
    var okBtn = overlay.querySelector('#saveUrlOk');
    var cancelBtn = overlay.querySelector('#saveUrlCancel');

    function close() { overlay.remove(); }
    function submit() {
      var urlPattern = input.value.trim();
      if (!urlPattern) { input.focus(); return; }
      close();
      persistTempKeyword(kw, urlPattern);
    }

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', close);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') close();
    });
    input.focus();
    input.select();
  }

  async function persistTempKeyword(kw, urlPattern) {
    var allRules = await Storage.getRules();
    var existingRule = allRules.find(function (r) { return r.urlPattern === urlPattern; });
    var kwData = { text: kw.text, matchType: kw.matchType, caseSensitive: kw.caseSensitive, acrossElements: kw.acrossElements, color: kw.color, textColor: kw.textColor, fontSize: kw.fontSize, bold: kw.bold, italic: kw.italic, underline: kw.underline, strike: kw.strike };
    if (existingRule) {
      await Storage.addKeyword(existingRule.id, kwData);
    } else {
      var newRule = await Storage.addRule({ urlPattern: urlPattern, urlMatchType: 'contains' });
      await Storage.addKeyword(newRule.id, kwData);
    }
    tempKeywords = tempKeywords.filter(function (k) { return k.id !== kw.id; });
    hiddenKwIds.delete(kw.id);
    manualShowKwIds.delete(kw.id);
    chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(function () {});
    sendTempHighlight();
    sendHiddenIds();
    loadMatchedRules();
  }

  pageToggle.addEventListener('change', function () {
    pageDisabled = !pageToggle.checked;
    chrome.runtime.sendMessage({ type: 'TOGGLE_PAGE_DISABLED', disabled: pageDisabled }).catch(function () {});
  });

  railToggle.addEventListener('change', async function () {
    var settings = await Storage.getSettings();
    settings.showRail = railToggle.checked;
    await Storage.saveSettings(settings);
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' }).catch(function () {});
  });

  async function saveToHistory(text) {
    if (!historyEnabled || !text) return;
    tempHistory = tempHistory.filter(function (h) { return h.text !== text; });
    tempHistory.unshift({ text: text, matchType: selectedMatchType, caseSensitive: caseSensitive, acrossElements: acrossElements, style: selectedTempStyle ? StyleKit.keywordOverrides(selectedTempStyle) : null });
    if (tempHistory.length > 50) tempHistory = tempHistory.slice(0, 50);
    var settings = await Storage.getSettings();
    settings.tempHistory = tempHistory;
    await Storage.saveSettings(settings);
  }

  function addTempKeyword() {
    var text = searchInput.value.trim();
    if (!text) return;
    var kw = { id: CommonKit.uid('tmp_', 5), text: text, matchType: selectedMatchType, caseSensitive: caseSensitive, acrossElements: acrossElements };
    // 把当前选中样式写入关键词字段（不含继承语义：临时关键词用完即弃）
    StyleKit.applyStyleToKeyword(kw, selectedTempStyle || {});
    tempKeywords.push(kw);
    saveToHistory(text);
    searchInput.value = '';
    historyIndex = -1;
    sendTempHighlight();
    renderAll();
  }

  btnSearch.addEventListener('click', addTempKeyword);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { addTempKeyword(); return; }

    if (!historyEnabled || tempHistory.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < tempHistory.length - 1) historyIndex++;
      else historyIndex = 0;
      fillFromHistory();
      closeHistoryDropdown();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) historyIndex--;
      else historyIndex = tempHistory.length - 1;
      fillFromHistory();
      closeHistoryDropdown();
    }
    if (e.key === 'Escape') {
      historyIndex = -1;
      closeHistoryDropdown();
    }
  });

  searchInput.addEventListener('wheel', function (e) {
    if (!historyEnabled || tempHistory.length === 0) return;
    e.preventDefault();
    if (e.deltaY > 0) {
      if (historyIndex < tempHistory.length - 1) historyIndex++;
      else historyIndex = 0;
    } else {
      if (historyIndex > 0) historyIndex--;
      else historyIndex = tempHistory.length - 1;
    }
    fillFromHistory();
    closeHistoryDropdown();
  });

  function fillFromHistory() {
    if (historyIndex < 0 || historyIndex >= tempHistory.length) return;
    var h = tempHistory[historyIndex];
    searchInput.value = h.text;
    selectedMatchType = h.matchType;
    caseSensitive = h.caseSensitive;
    acrossElements = h.acrossElements || false;
    // 新格式存 style 对象；旧记录只有 color，转成「仅背景色」样式
    selectedTempStyle = StyleKit.keywordOverrides(h.style || { bgColor: h.color || '' });
    persistTempStyle();
    if (styleBar) styleBar.setState({ matchType: selectedMatchType, caseSensitive: caseSensitive, acrossElements: acrossElements, style: selectedTempStyle });
  }

  btnHistory.addEventListener('click', function (e) {
    e.stopPropagation();
    if (historyOpen) { closeHistoryDropdown(); return; }
    openHistoryDropdown();
  });

  function openHistoryDropdown() {
    historyOpen = true;
    btnHistory.style.color = '#1890ff';
    var wrapper = searchInput.parentElement;
    var bodyTop = document.body.getBoundingClientRect().top;
    historyDropdown.style.top = (wrapper.getBoundingClientRect().bottom - bodyTop + 3) + 'px';
    historyDropdown.classList.add('show');
    renderHistoryDropdown();
  }

  function closeHistoryDropdown() {
    historyOpen = false;
    btnHistory.style.color = '';
    historyDropdown.classList.remove('show');
  }

  function renderHistoryDropdown() {
    if (tempHistory.length === 0) {
      historyDropdown.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      return;
    }
    historyDropdown.innerHTML = tempHistory.map(function (h, i) {
      var tags = '';
      if (h.caseSensitive) tags += '<span class="hist-tag hist-case">Aa</span>';
      if (h.acrossElements) tags += '<span class="hist-tag hist-across">↔</span>';
      return '<div class="history-item' + (i === historyIndex ? ' active' : '') + '" data-history-idx="' + i + '">' +
        '<span class="hist-text">' + CommonKit.escapeHtml(h.text) + '</span>' +
        '<span class="hist-match">' + CommonKit.getMatchTypeLabel(h.matchType) + '</span>' +
        tags +
        '<span class="hist-del" data-hist-del="' + i + '" title="删除">✕</span>' +
      '</div>';
    }).join('') + '<div class="history-footer"><button id="btnClearHistory">清空历史</button></div>';

    historyDropdown.querySelectorAll('.history-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.closest('.hist-del')) return;
        e.stopPropagation();
        historyIndex = parseInt(item.dataset.historyIdx);
        fillFromHistory();
        closeHistoryDropdown();
      });
    });

    historyDropdown.querySelectorAll('.hist-del').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.histDel);
        tempHistory.splice(idx, 1);
        if (historyIndex >= tempHistory.length) historyIndex = tempHistory.length - 1;
        if (historyIndex >= 0 && idx <= historyIndex) historyIndex--;
        renderHistoryDropdown();
        var settings = await Storage.getSettings();
        settings.tempHistory = tempHistory;
        await Storage.saveSettings(settings);
      });
    });

    var clearBtn = historyDropdown.querySelector('#btnClearHistory');
    if (clearBtn) {
      clearBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        tempHistory = [];
        historyIndex = -1;
        var settings = await Storage.getSettings();
        settings.tempHistory = [];
        await Storage.saveSettings(settings);
        closeHistoryDropdown();
      });
    }
  }

  document.addEventListener('change', function (e) {
    var select = e.target.closest('[data-action="change-match-type"]');
    if (!select) return;
    var kwId = select.dataset.kwId;
    var isTemp = select.dataset.isTemp === '1';
    var newType = select.value;
    if (isTemp) {
      var kw = tempKeywords.find(function (k) { return k.id === kwId; });
      if (kw) {
        kw.matchType = newType;
        sendTempHighlight();
      }
    }
  });

  document.addEventListener('click', function (e) {
    if (historyOpen && !historyDropdown.contains(e.target) && e.target !== btnHistory && !(cppPopup && cppPopup.contains(e.target))) {
      closeHistoryDropdown();
    }
    if (cppPopup && cppPopup.classList.contains('show') && !cppPopup.contains(e.target) && !e.target.closest('.kw-preview') && !e.target.closest('.kw-style-preview')) {
      // 原生颜色拾色器弹出时会盖住面板底部的「应用」按钮，用户常误点面板外想关掉拾色器；
      // 有未保存改动时不关闭面板，闪红边提示，必须显式点「应用 / 取消」，避免颜色直接丢失
      var dirty = false;
      try { dirty = !!cppStyleEditor && JSON.stringify(cppStyleEditor.read()) !== cppOpenSnapshot; } catch (e2) {}
      if (dirty) {
        cppPopup.style.boxShadow = '0 0 0 2px #ff4d4f';
        setTimeout(function () { cppPopup.style.boxShadow = ''; }, 500);
      } else {
        closeColorPicker();
      }
    }
  });

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var kwId = btn.dataset.kwId;

    if (action === 'toggle-temp') {
      if (hiddenKwIds.has(kwId)) {
        hiddenKwIds.delete(kwId);
      } else {
        hiddenKwIds.add(kwId);
      }
      sendTempHighlight();
      sendHiddenIds();
      renderAll();
    }

    if (action === 'del-temp') {
      tempKeywords = tempKeywords.filter(function (k) { return k.id !== kwId; });
      hiddenKwIds.delete(kwId);
      manualShowKwIds.delete(kwId);
      sendTempHighlight();
      sendHiddenIds();
      renderAll();
    }

    if (action === 'save-temp') {
      var kw = tempKeywords.find(function (k) { return k.id === kwId; });
      if (!kw) return;
      showSaveUrlModal(kw);
    }

    if (action === 'toggle-rule-kw') {
      var order = kwOrders[kwId];
      var isHiddenByExclusive = exclusiveStopOrder >= 0 && typeof order === 'number' && order !== exclusiveStopOrder;
      var isManuallyShown = manualShowKwIds.has(kwId);
      var isManuallyHidden = hiddenKwIds.has(kwId);
      var isEffectivelyHidden = isManuallyHidden || (isHiddenByExclusive && !isManuallyShown);

      if (isEffectivelyHidden) {
        if (isManuallyHidden) {
          hiddenKwIds.delete(kwId);
        }
        if (isHiddenByExclusive && !isManuallyShown) {
          manualShowKwIds.add(kwId);
        }
      } else {
        hiddenKwIds.add(kwId);
        manualShowKwIds.delete(kwId);
      }
      sendHiddenIds();
      renderAll();
    }

    if (action === 'clear-manual') {
      hiddenKwIds.clear();
      manualShowKwIds.clear();
      sendHiddenIds();
      renderAll();
    }

    if (action === 'change-color') {
      var isTemp = btn.dataset.isTemp === '1';
      var kw = isTemp ? tempKeywords.find(function (k) { return k.id === kwId; }) : null;
      if (!kw) kw = findRuleKeyword(kwId);
      if (kw) {
        cppTarget = { kwId: kwId, isTemp: isTemp, kw: kw };
        openStylePanel(kw, btn);
      }
    }

    if (action === 'toggle-case') {
      var isTemp = btn.dataset.isTemp === '1';
      if (isTemp) {
        var kwT = tempKeywords.find(function (k) { return k.id === kwId; });
        if (kwT) {
          kwT.caseSensitive = !kwT.caseSensitive;
          sendTempHighlight();
          renderAll();
        }
      }
    }

    if (action === 'toggle-across') {
      var isTemp = btn.dataset.isTemp === '1';
      if (isTemp) {
        var kwA = tempKeywords.find(function (k) { return k.id === kwId; });
        if (kwA) {
          kwA.acrossElements = !kwA.acrossElements;
          sendTempHighlight();
          renderAll();
        }
      }
    }

    if (action === 'nav-prev' || action === 'nav-next') {
      chrome.runtime.sendMessage({ type: 'NAV_MARK', kwId: kwId, direction: action === 'nav-prev' ? 'prev' : 'next' }).catch(function () {});
    }

    if (action === 'del-spot') {
      var spotId = btn.dataset.spotId;
      chrome.runtime.sendMessage({ type: 'DELETE_SPOT_HIGHLIGHT', spotId: spotId }).catch(function () {});
      spotKeywords = spotKeywords.filter(function (s) { return s.id !== spotId; });
      renderAll();
    }

    if (action === 'nav-spot') {
      var spotId2 = btn.dataset.spotId;
      chrome.runtime.sendMessage({ type: 'NAV_MARK', kwId: 'spot_' + spotId2, direction: 'next' }).catch(function () {});
    }

    if (action === 'change-spot-color') {
      var spotId3 = btn.dataset.spotId;
      var spot = spotKeywords.find(function (s) { return s.id === spotId3; });
      if (spot) {
        cppTarget = { spotId: spotId3, isSpot: true, kw: spot };
        openStylePanel(spot, btn);
      }
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'NAV_MARK_RESULT') {
      navIndexMap[msg.kwId] = msg.index;
      var idxEl = document.querySelector('.kw-nav-index[data-kw-id="' + msg.kwId + '"]');
      if (idxEl) {
        idxEl.textContent = (msg.index + 1) + '/' + msg.total;
      }
    }
  });

  btnManageRules.addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
});
