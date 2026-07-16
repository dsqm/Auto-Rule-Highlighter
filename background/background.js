var RULES_KEY = 'ah_rules';
var SETTINGS_KEY = 'ah_settings';
var STORAGE_MODE_KEY = 'ah_storage_mode';
var _bgIsLocal = false;
var _bgFallbackChecked = false;

async function _bgCheckFallback() {
  if (_bgFallbackChecked) return;
  _bgFallbackChecked = true;
  var d = await chrome.storage.local.get(STORAGE_MODE_KEY);
  _bgIsLocal = d[STORAGE_MODE_KEY] === 'local';
}

async function _bgGetStorage(keys) {
  await _bgCheckFallback();
  if (_bgIsLocal) {
    return await chrome.storage.local.get(keys);
  }
  return await chrome.storage.sync.get(keys);
}
var disabledTabs = {};
var tabBadgeCounts = {};

async function loadDisabledTabs() {
  var data = await chrome.storage.local.get('ah_disabled_tabs');
  disabledTabs = data['ah_disabled_tabs'] || {};
}

async function saveDisabledTabs() {
  await chrome.storage.local.set({ 'ah_disabled_tabs': disabledTabs });
}

function bgLog() {
  if (false) {
    var a = ['[AH BG]'];
    for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
    console.log.apply(console, a);
  }
}

function urlMatch(url, pattern, matchType) {
  if (!pattern) return false;
  try {
    switch (matchType) {
      case 'contains':
        return url.indexOf(pattern) !== -1;
      case 'exact':
        return url === pattern;
      case 'regex':
        return new RegExp(pattern).test(url);
      case 'wildcard':
        var regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
        return new RegExp(regexStr).test(url);
      default:
        return url.indexOf(pattern) !== -1;
    }
  } catch (e) {
    return false;
  }
}

async function getRules() {
  var d = await _bgGetStorage(RULES_KEY);
  return d[RULES_KEY] || [];
}

async function getSettings() {
  var defaults = { showRail: true, defaultColor: '#ffeb3b' };
  var d = await _bgGetStorage(SETTINGS_KEY);
  return Object.assign({}, defaults, d[SETTINGS_KEY] || {});
}

async function getMatchedRules(url) {
  var rules = await getRules();
  var matched = null;
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].enabled && urlMatch(url, rules[i].urlPattern, rules[i].urlMatchType)) {
      matched = rules[i];
      break;
    }
  }
  return matched ? [matched] : [];
}

function setIconDisabled(tabId, disabled) {
  if (disabled) {
    chrome.action.setBadgeText({ text: 'OFF', tabId: tabId }).catch(function () {});
    chrome.action.setBadgeBackgroundColor({ color: '#999999', tabId: tabId }).catch(function () {});
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId }).catch(function () {});
  }
}

async function sendToTopFrame(tabId, msg) {
  try { await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }); } catch (e) {}
}

async function sendToAllFrames(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    try { await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }); } catch (e2) {}
  }
}

function queryAllFrames(tabId, msg) {
  return new Promise(function (resolve) {
    chrome.webNavigation.getAllFrames({ tabId: tabId }, function (frames) {
      if (!frames || frames.length === 0 || chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      var results = [];
      var pending = 0;
      var done = false;
      for (var i = 0; i < frames.length; i++) {
        (function (frameId) {
          pending++;
          chrome.tabs.sendMessage(tabId, msg, { frameId: frameId }, function (resp) {
            if (done) return;
            if (chrome.runtime.lastError || !resp) {
              pending--;
              if (pending === 0) { done = true; resolve(results); }
              return;
            }
            results.push(resp);
            pending--;
            if (pending === 0) { done = true; resolve(results); }
          });
        })(frames[i].frameId);
      }
      if (pending === 0) { done = true; resolve(results); }
    });
  });
}

function buildContextMenus(settings) {
  chrome.contextMenus.removeAll(function () {
    if (settings.contextMenuEnabled !== false) {
      chrome.contextMenus.create({
        id: 'add-highlight',
        title: '添加高亮',
        contexts: ['selection']
      });
    }
    if (settings.spotContextMenuEnabled !== false) {
      chrome.contextMenus.create({
        id: 'spot-highlight',
        title: '高亮此处',
        contexts: ['selection']
      });
    }
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_MATCHED_RULES') {
    getMatchedRules(msg.url).then(sendResponse).catch(function () { sendResponse([]); });
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse).catch(function () { sendResponse({}); });
    return true;
  }
  if (msg.type === 'IS_PAGE_DISABLED') {
    var tabId = sender.tab ? sender.tab.id : 0;
    sendResponse({ disabled: disabledTabs[tabId] === true });
    return true;
  }
  if (msg.type === 'RULES_CHANGED') {
    broadcastRulesUpdate().catch(function () {});
    return false;
  }
  if (msg.type === 'SETTINGS_CHANGED') {
    broadcastRulesUpdate().catch(function () {});
    getSettings().then(function (s) { buildContextMenus(s); }).catch(function () {});
    return false;
  }
  if (msg.type === 'REFRESH_HIGHLIGHT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) sendHighlightToTab(tabs[0].id, tabs[0].url);
    });
    return false;
  }
  if (msg.type === 'TRIGGER_HIGHLIGHT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) sendHighlightToTab(tabs[0].id, tabs[0].url);
    });
    return false;
  }
  if (msg.type === 'TEMP_HIGHLIGHT' || msg.type === 'CLEAR_TEMP' || msg.type === 'SET_HIDDEN_IDS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) sendToAllFrames(tabs[0].id, msg);
    });
    return false;
  }
  if (msg.type === 'TOGGLE_PAGE_DISABLED') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      var tabId = tabs[0].id;
      disabledTabs[tabId] = msg.disabled;
      setIconDisabled(tabId, msg.disabled);
      sendToAllFrames(tabId, msg);
      saveDisabledTabs();
    });
    return false;
  }
  if (msg.type === 'NAV_MARK') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) sendToAllFrames(tabs[0].id, msg);
    });
    return false;
  }
  if (msg.type === 'GET_HIGHLIGHT_COUNT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse({ total: 0, visible: 0, byKeyword: {} }); return; }
      queryAllFrames(tabs[0].id, msg).then(function (results) {
        var total = 0;
        var byKeyword = {};
        var allHiddenIds = [];
        var allManualShowIds = [];
        var mergedKwOrders = {};
        var mergedKwExclusive = {};
        var anyPageDisabled = false;
        for (var r = 0; r < results.length; r++) {
          var res = results[r];
          total += (res.total || 0);
          if (res.byKeyword) {
            for (var kwId in res.byKeyword) {
              byKeyword[kwId] = (byKeyword[kwId] || 0) + res.byKeyword[kwId];
            }
          }
          if (res.hiddenIds && Array.isArray(res.hiddenIds)) {
            for (var h = 0; h < res.hiddenIds.length; h++) {
              if (allHiddenIds.indexOf(res.hiddenIds[h]) === -1) allHiddenIds.push(res.hiddenIds[h]);
            }
          }
          if (res.manualShowIds && Array.isArray(res.manualShowIds)) {
            for (var s = 0; s < res.manualShowIds.length; s++) {
              if (allManualShowIds.indexOf(res.manualShowIds[s]) === -1) allManualShowIds.push(res.manualShowIds[s]);
            }
          }
          if (res.kwOrders) Object.assign(mergedKwOrders, res.kwOrders);
          if (res.kwExclusive) Object.assign(mergedKwExclusive, res.kwExclusive);
          if (res.pageDisabled === true) anyPageDisabled = true;
        }
        sendResponse({
          total: total,
          visible: total,
          byKeyword: byKeyword,
          hiddenIds: allHiddenIds,
          manualShowIds: allManualShowIds,
          exclusiveStopOrder: results.length > 0 ? (results[0].exclusiveStopOrder || -1) : -1,
          kwOrders: mergedKwOrders,
          kwExclusive: mergedKwExclusive,
          pageDisabled: disabledTabs[tabs[0].id] === true
        });
      }).catch(function () {
        sendResponse({ total: 0, visible: 0, byKeyword: {} });
      });
    });
    return true;
  }
  if (msg.type === 'GET_TEMP_KEYWORDS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse([]); return; }
      queryAllFrames(tabs[0].id, msg).then(function (results) {
        var merged = [];
        var seen = {};
        for (var r = 0; r < results.length; r++) {
          var arr = results[r];
          if (!Array.isArray(arr)) continue;
          for (var i = 0; i < arr.length; i++) {
            var key = arr[i].text + '|' + arr[i].color + '|' + arr[i].matchType;
            if (!seen[key]) { seen[key] = true; merged.push(arr[i]); }
          }
        }
        sendResponse(merged);
      }).catch(function () { sendResponse([]); });
    });
    return true;
  }
  if (msg.type === 'UPDATE_BADGE') {
    if (sender.tab && sender.tab.id) {
      var tid = sender.tab.id;
      var frameId = sender.frameId !== undefined ? sender.frameId : 0;
      if (!tabBadgeCounts[tid]) tabBadgeCounts[tid] = { frames: {} };
      tabBadgeCounts[tid].frames[frameId] = msg.count || 0;
      var total = 0;
      var frames = tabBadgeCounts[tid].frames;
      for (var fid in frames) {
        if (frames.hasOwnProperty(fid)) total += frames[fid];
      }
      updateBadge(tid, total);
    }
    return false;
  }
  if (msg.type === 'NAV_MARK_RESULT') {
    try { chrome.runtime.sendMessage(msg); } catch (e) {}
    return false;
  }
  if (msg.type === 'STORE_SPOT_HIGHLIGHT') {
    var tabId = (sender.tab && sender.tab.id) ? sender.tab.id : 0;
    var frameId = (sender.tab && sender.frameId !== undefined) ? sender.frameId : 0;
    _bgStoreSpotHighlight(tabId, frameId, msg.spotId, { text: msg.text, color: msg.color }).catch(function () {});
    return false;
  }
  if (msg.type === 'GET_SPOT_HIGHLIGHTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse([]); return; }
      _bgGetAllSpotHighlightsForTab(tabs[0].id).then(sendResponse).catch(function () { sendResponse([]); });
    });
    return true;
  }
  if (msg.type === 'DELETE_SPOT_HIGHLIGHT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'DELETE_SPOT', spotId: msg.spotId });
      _bgDeleteSpotHighlight(tabs[0].id, 0, msg.spotId).catch(function () {});
    });
    return false;
  }
  if (msg.type === 'UPDATE_SPOT_COLOR') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'UPDATE_SPOT_COLOR', spotId: msg.spotId, color: msg.color });
    });
    return false;
  }
  if (msg.type === 'SHORTCUT_HIGHLIGHT_DONE') {
    getSettings().then(function (s) {
      if (msg.action === 'add' && s.openPopupOnAddShortcut !== false) {
        chrome.action.openPopup().catch(function () {});
      }
      if (msg.action === 'spot' && s.openPopupOnSpotShortcut !== false) {
        chrome.action.openPopup().catch(function () {});
      }
    }).catch(function () {});
    return false;
  }
});

var SPOT_KEY = 'ah_spot_highlights';

async function _bgGetAllSpotHighlightsForTab(tabId) {
  var data = await chrome.storage.local.get(SPOT_KEY);
  var all = data[SPOT_KEY] || {};
  var prefix = 'spot_' + tabId + '_';
  var merged = [];
  for (var key in all) {
    if (all.hasOwnProperty(key) && key.indexOf(prefix) === 0) {
      var arr = all[key];
      for (var i = 0; i < arr.length; i++) {
        merged.push(arr[i]);
      }
    }
  }
  return merged;
}

async function _bgDeleteSpotHighlight(tabId, frameId, spotId) {
  var data = await chrome.storage.local.get(SPOT_KEY);
  var all = data[SPOT_KEY] || {};
  var key = 'spot_' + tabId + '_' + (frameId || 0);
  var list = all[key] || [];
  list = list.filter(function (s) { return s.id !== spotId; });
  all[key] = list;
  await chrome.storage.local.set({ [SPOT_KEY]: all });
}

async function _bgStoreSpotHighlight(tabId, frameId, spotId, data) {
  var allData = await chrome.storage.local.get(SPOT_KEY);
  var all = allData[SPOT_KEY] || {};
  var key = 'spot_' + tabId + '_' + (frameId || 0);
  var list = all[key] || [];
  list.push({ id: spotId, text: data.text, color: data.color, createdAt: Date.now() });
  all[key] = list;
  await chrome.storage.local.set({ [SPOT_KEY]: all });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || !tab.id) return;
  var selectedText = info.selectionText;
  if (!selectedText) return;

  if (info.menuItemId === 'add-highlight') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_ADD_HIGHLIGHT',
      text: selectedText
    }, function (resp) {
      if (resp && resp.count > 0 && resp.settings) {
        if (resp.settings.openPopupOnAdd !== false) {
          chrome.action.openPopup().catch(function () {});
        }
      }
    });
  }

  if (info.menuItemId === 'spot-highlight') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_SPOT_HIGHLIGHT',
      text: selectedText
    }, function (resp) {
      if (resp && resp.settings) {
        if (resp.settings.openPopupOnSpot !== false) {
          chrome.action.openPopup().catch(function () {});
        }
      }
    });
  }
});

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'toggle-page-highlight') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      var tabId = tabs[0].id;
      var newDisabled = !disabledTabs[tabId];
      disabledTabs[tabId] = newDisabled;
      setIconDisabled(tabId, newDisabled);
      sendToAllFrames(tabId, { type: 'TOGGLE_PAGE_DISABLED', disabled: newDisabled });
      saveDisabledTabs();
    });
  }
  if (command === 'add-highlight') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'SHORTCUT_ADD_HIGHLIGHT' });
    });
  }
  if (command === 'spot-highlight') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'SHORTCUT_SPOT_HIGHLIGHT' });
    });
  }
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url) {
    if (!disabledTabs[tabId]) {
      sendHighlightToTab(tabId, tab.url);
    }
  }
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    if (tab.url) {
      setIconDisabled(tab.id, disabledTabs[tab.id] === true);
      if (!disabledTabs[tab.id]) {
        sendHighlightToTab(tab.id, tab.url);
      }
    }
  });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  delete disabledTabs[tabId];
  delete tabBadgeCounts[tabId];
  saveDisabledTabs();
});

async function sendHighlightToTab(tabId, url) {
  try {
    tabBadgeCounts[tabId] = { frames: {} };
    var rules = await getMatchedRules(url);
    var settings = await getSettings();
    await sendToAllFrames(tabId, { type: 'APPLY_HIGHLIGHT', rules: rules, settings: settings });
  } catch (e) {}
}

async function broadcastRulesUpdate() {
  var tabs = await chrome.tabs.query({});
  var promises = [];
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].url && tabs[i].id) {
      promises.push(sendHighlightToTab(tabs[i].id, tabs[i].url).catch(function () {}));
    }
  }
  await Promise.all(promises);
}

function updateBadge(tabId, count) {
  if (disabledTabs[tabId]) return;
  var text = '';
  if (count > 0) {
    text = count > 99 ? '99+' : String(count);
  }
  chrome.action.setBadgeText({ text: text, tabId: tabId }).catch(function () {});
  chrome.action.setBadgeBackgroundColor({ color: '#666666', tabId: tabId }).catch(function () {});
}

getSettings().then(function (s) {
  buildContextMenus(s);
}).catch(function () {});

loadDisabledTabs().catch(function () {});
