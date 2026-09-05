// 共用工具与存储层（CommonKit / Matcher / StyleKit / Storage）
// 规则与设置的读取全部走 Storage：默认值、预设迁移、URL 匹配与 popup/options 同源，
// 避免这里再抄一份 getSettings/urlMatch 造成口径漂移
importScripts('../utils/common.js', '../utils/matcher.js', '../utils/style.js', '../utils/storage.js');

var disabledTabs = {};
var tabBadgeCounts = {};
// 关键词导航的全局游标（跨 frame 合并计数后按全局序号接力）：key = tabId|kwId
var navStates = {};

function clearNavStatesForTab(tabId) {
  var prefix = tabId + '|';
  for (var key in navStates) {
    if (navStates.hasOwnProperty(key) && key.indexOf(prefix) === 0) delete navStates[key];
  }
}

async function loadDisabledTabs() {
  var data = await chrome.storage.local.get('ah_disabled_tabs');
  disabledTabs = data['ah_disabled_tabs'] || {};
}

async function saveDisabledTabs() {
  await chrome.storage.local.set({ 'ah_disabled_tabs': disabledTabs });
}

// ---- 临时高亮：按标签页持久化 ----
// 之前临时关键词只活在内容脚本的内存里，页面一跳转就随文档一起被回收。
// 现在数据落在后台并按 tabId 索引：内容脚本加载时主动拉取，运行中的增删改由后台广播，
// 于是刷新 / 跳转 / 前进后退都能保留；target=_blank 的新标签页再从来源标签页继承一份副本。
var TEMP_KEY = 'ah_temp_keywords';
// 生效范围（设置项 settings.tempScope）：
//   page   —— 不入库，关键词只活在内容脚本内存里，刷新/跳转即失效
//   tab    —— key = tab_<tabId>，刷新/跳转保留，target=_blank 新标签页继承来源快照
//   global —— key = __global__，所有标签页共用一份
var TEMP_SCOPE_PAGE = 'page';
var TEMP_SCOPE_TAB = 'tab';
var TEMP_SCOPE_GLOBAL = 'global';
var TEMP_GLOBAL_KEY = '__global__';

/** 每次都实时读设置：用户可能在另一个页面刚改过范围，缓存会拿到过期值 */
async function bgGetTempScope() {
  var s = await getSettings();
  return CommonKit.normalizeTempScope(s.tempScope);
}

function tempTabKey(scope, tabId) {
  if (scope === TEMP_SCOPE_GLOBAL) return TEMP_GLOBAL_KEY;
  return 'tab_' + tabId;
}

async function bgGetTempMap() {
  var d = await chrome.storage.local.get(TEMP_KEY);
  return d[TEMP_KEY] || {};
}

async function bgGetTempState(scope, tabId) {
  var empty = { keywords: [], hidden: [] };
  if (scope === TEMP_SCOPE_PAGE) return empty;
  if (scope === TEMP_SCOPE_GLOBAL) tabId = 0;
  if (!tabId && scope !== TEMP_SCOPE_GLOBAL) return empty;
  var map = await bgGetTempMap();
  var entry = map[tempTabKey(scope, tabId)];
  if (!entry) return empty;
  return {
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    hidden: Array.isArray(entry.hidden) ? entry.hidden : []
  };
}

async function bgSaveTempState(scope, tabId, state) {
  if (scope === TEMP_SCOPE_PAGE) return;
  if (scope === TEMP_SCOPE_GLOBAL) tabId = 0;
  if (!tabId && scope !== TEMP_SCOPE_GLOBAL) return;
  var map = await bgGetTempMap();
  var keywords = (state && state.keywords) || [];
  var hidden = (state && state.hidden) || [];
  var key = tempTabKey(scope, tabId);
  if (keywords.length === 0 && hidden.length === 0) delete map[key];
  else map[key] = { keywords: keywords, hidden: hidden };
  await chrome.storage.local.set({ [TEMP_KEY]: map });
}

async function bgDeleteTempState(tabId) {
  if (!tabId) return;
  var map = await bgGetTempMap();
  // 只清该标签页自己的条目，全局条目（__global__）不受影响
  var key = 'tab_' + tabId;
  if (map[key] === undefined) return;
  delete map[key];
  await chrome.storage.local.set({ [TEMP_KEY]: map });
}

/**
 * 新标签页继承：target=_blank / window.open 打开的标签页，从来源标签页复制一份临时高亮。
 * 复制的是快照，之后两个标签页各自独立增删，互不影响。
 * 仅「跟随标签页」需要：全局范围天然共享同一份；仅当前页面不入库，无东西可继承。
 */
async function bgInheritTempState(fromTabId, toTabId) {
  if (!fromTabId || !toTabId || fromTabId === toTabId) return;
  var scope = await bgGetTempScope();
  if (scope !== TEMP_SCOPE_TAB) return;
  var state = await bgGetTempState(scope, fromTabId);
  if (state.keywords.length === 0 && state.hidden.length === 0) return;
  await bgSaveTempState(scope, toTabId, state);
}

/** 只跨页面保留临时关键词的隐藏态；规则关键词的手动隐藏维持原行为（不跨页面保留） */
function filterTempHiddenIds(ids) {
  var out = [];
  for (var i = 0; i < (ids || []).length; i++) {
    var id = ids[i];
    if (CommonKit.isTempKwId(id) && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

async function bgPushTempState(scope, tabId, state, keepLocal) {
  var payload = {
    type: 'SYNC_TEMP_STATE',
    keywords: state.keywords || [],
    hiddenIds: state.hidden || [],
    scope: scope
  };
  // keepLocal：只让页面改认新的生效范围，不要动它现有的关键词（切到「仅当前页面」时用）
  if (keepLocal) payload.keepLocal = true;
  // 全局范围下任何一个标签页的改动都要同步到所有标签页，不只是当前这一个
  if (scope !== TEMP_SCOPE_GLOBAL) {
    await sendToAllFrames(tabId, payload);
    return;
  }
  var tabs = await chrome.tabs.query({});
  for (var i = 0; i < tabs.length; i++) {
    await sendToAllFrames(tabs[i].id, payload);
  }
}

/** 「仅当前页面」范围不入库，弹窗读取时只能回到页面里逐个 frame 收集（即改动前的行为） */
async function bgCollectTempFromFrames(tabId) {
  var results = await queryAllFrames(tabId, { type: 'GET_TEMP_KEYWORDS' });
  var merged = [];
  var seen = {};
  for (var r = 0; r < results.length; r++) {
    var arr = results[r];
    if (!Array.isArray(arr)) continue;
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      // 去重 key 覆盖全部样式字段，避免同文本不同样式的临时关键词被误合并
      var key = item.text + '|' + item.color + '|' + item.matchType +
        '|' + (item.fontSize || 1) +
        '|' + (item.textColor === undefined ? '' : (item.textColor === null ? '@auto' : item.textColor)) +
        '|' + (item.bold ? '1' : '0') +
        '|' + (item.italic ? '1' : '0') +
        '|' + (item.underline ? '1' : '0') +
        '|' + (item.strike ? '1' : '0');
      if (!seen[key]) { seen[key] = true; merged.push(item); }
    }
  }
  return merged;
}

/** 切换生效范围后，让已打开的页面立刻按新范围重取一份，省去手动刷新 */
async function bgRefreshTempEverywhere() {
  var scope = await bgGetTempScope();
  await bgPurgeOtherScopes(scope);
  var tabs = await chrome.tabs.query({});
  for (var i = 0; i < tabs.length; i++) {
    if (scope === TEMP_SCOPE_PAGE) {
      // 切到「仅当前页面」：页面内存里的现有高亮保留不动，只把范围通知下去，刷新后自然失效
      await sendToAllFrames(tabs[i].id, { type: 'SYNC_TEMP_STATE', scope: scope, keepLocal: true });
      continue;
    }
    var state = await bgGetTempState(scope, tabs[i].id);
    await bgPushTempState(scope, tabs[i].id, state);
  }
}

/** 切换范围时清掉其他范围留下的条目，避免切回来时冒出上一次的旧高亮 */
async function bgPurgeOtherScopes(scope) {
  var map = await bgGetTempMap();
  var changed = false;
  for (var key in map) {
    if (!map.hasOwnProperty(key)) continue;
    var isGlobal = key === TEMP_GLOBAL_KEY;
    var keep = scope === TEMP_SCOPE_GLOBAL ? isGlobal : (scope === TEMP_SCOPE_TAB ? !isGlobal : false);
    if (!keep) { delete map[key]; changed = true; }
  }
  if (changed) await chrome.storage.local.set({ [TEMP_KEY]: map });
}

function bgLog() {
  if (false) {
    var a = ['[AH BG]'];
    for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
    console.log.apply(console, a);
  }
}

async function getRules() {
  return await Storage.getRules();
}

async function getSettings() {
  // 与 popup / options 完全同源：完整默认值 + 出厂预设迁移都在 Storage.getSettings 里
  // 全局默认样式由 settings.stylePresets[0] 提供，不再使用 defaultColor
  return await Storage.getSettings();
}

async function getMatchedRules(url) {
  // 网站规则同优先级（顺序即优先级）：多条规则匹配同一网站时，只有最上方的一条生效。
  // 高亮只下发这一条；popup 的「匹配规则」列表由 popup 自行过滤展示，不受此限制。
  // URL 匹配统一走 Storage.getMatchedRules（内部是 Matcher.matchUrl），不再本地抄一份
  return await Storage.getMatchedRules(url);
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

function queryAllFramesWithIds(tabId, msg) {
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
            results.push({ frameId: frameId, resp: resp });
            pending--;
            if (pending === 0) { done = true; resolve(results); }
          });
        })(frames[i].frameId);
      }
      if (pending === 0) { done = true; resolve(results); }
    });
  });
}

function queryAllFrames(tabId, msg) {
  return queryAllFramesWithIds(tabId, msg).then(function (results) {
    return results.map(function (r) { return r.resp; });
  });
}

/**
 * 关键词导航的跨 frame 协调：
 * 弹窗计数是全部 frame 合并后的总数，跳转也必须按全局序号在 frame 间接力，
 * 否则各 frame 各自为政时，某个只有 1 处匹配的 frame 回传的 1/1 会覆盖掉正确计数。
 */
async function handleNavMark(tabId, kwId, direction) {
  var results = await queryAllFramesWithIds(tabId, { type: 'GET_KW_COUNT', kwId: kwId });
  var frames = [];
  var total = 0;
  for (var i = 0; i < results.length; i++) {
    var count = (results[i].resp && results[i].resp.count) || 0;
    if (count > 0) {
      frames.push({ frameId: results[i].frameId, count: count });
      total += count;
    }
  }
  if (total === 0) return;
  frames.sort(function (a, b) { return a.frameId - b.frameId; });

  var key = tabId + '|' + kwId;
  if (!navStates[key]) navStates[key] = { pos: -1 };
  var st = navStates[key];
  if (direction === 'next') st.pos = (st.pos + 1) % total;
  else st.pos = (st.pos - 1 + total) % total;

  var acc = 0;
  for (var f = 0; f < frames.length; f++) {
    if (st.pos < acc + frames[f].count) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'NAV_MARK_AT',
          kwId: kwId,
          localIndex: st.pos - acc,
          globalIndex: st.pos,
          globalTotal: total
        }, { frameId: frames[f].frameId });
      } catch (e) {}
      return;
    }
    acc += frames[f].count;
  }
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
      if (tabs[0]) {
        // 弹窗重新打开：导航游标归零，与弹窗初始显示的 1/N 对齐
        clearNavStatesForTab(tabs[0].id);
        sendHighlightToTab(tabs[0].id, tabs[0].url);
      }
    });
    return false;
  }
  if (msg.type === 'TRIGGER_HIGHLIGHT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) sendHighlightToTab(tabs[0].id, tabs[0].url);
    });
    return false;
  }
  // 临时高亮的增删改统一走 SYNC_TEMP / ADD_TEMP_KEYWORD，经后台落盘后再广播，这里不再直接转发
  if (msg.type === 'SET_HIDDEN_IDS') {
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
      if (!tabs[0]) return;
      // 「高亮此处」没有序号展示，保持广播定位；关键词导航走跨 frame 协调
      if (msg.kwId && msg.kwId.indexOf('spot_') === 0) {
        sendToAllFrames(tabs[0].id, msg);
      } else {
        handleNavMark(tabs[0].id, msg.kwId, msg.direction);
      }
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
  // 跟随标签页 / 全局范围：以后台存储为准，直接读；仅当前页面：回到页面里逐 frame 收集
  if (msg.type === 'GET_TEMP_KEYWORDS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse([]); return; }
      var tabId = tabs[0].id;
      bgGetTempScope().then(function (scope) {
        if (scope === TEMP_SCOPE_PAGE) return bgCollectTempFromFrames(tabId);
        return bgGetTempState(scope, tabId).then(function (state) { return state.keywords; });
      }).then(function (keywords) {
        sendResponse(keywords || []);
      }).catch(function () { sendResponse([]); });
    });
    return true;
  }
  // 页面加载后内容脚本主动拉取，用于恢复该标签页的临时高亮
  if (msg.type === 'GET_TEMP_STATE') {
    var tempTabId = (sender.tab && sender.tab.id) ? sender.tab.id : 0;
    bgGetTempScope().then(function (scope) {
      return bgGetTempState(scope, tempTabId).then(function (state) {
        sendResponse({ scope: scope, keywords: state.keywords, hidden: state.hidden });
      });
    }).catch(function () {
      sendResponse({ scope: TEMP_SCOPE_TAB, keywords: [], hidden: [] });
    });
    return true;
  }
  // 右键菜单 / 快捷键添加：先落盘再广播，保证跨网页后仍在
  // 「仅当前页面」不入后台，由内容脚本自行持有，这里不会收到该消息
  if (msg.type === 'ADD_TEMP_KEYWORD') {
    var tempTabId = (sender.tab && sender.tab.id) ? sender.tab.id : 0;
    if (!tempTabId || !msg.keyword) { sendResponse({ ok: false }); return true; }
    bgGetTempScope().then(function (scope) {
      return bgGetTempState(scope, tempTabId).then(function (state) {
        state.keywords.push(msg.keyword);
        return bgSaveTempState(scope, tempTabId, state);
      }).then(function () {
        sendResponse({ ok: true, count: 1 });
        return bgGetTempState(scope, tempTabId);
      }).then(function (state) {
        // 广播与响应解耦：落盘结果已回给内容脚本，推送失败不影响本次操作
        return bgPushTempState(scope, tempTabId, state);
      }).catch(function () {});
    }).catch(function () {
      sendResponse({ ok: false });
    });
    return true;
  }
  // 弹窗全量同步：关键词列表 + 隐藏态一起下发，避免两份状态各写一半
  if (msg.type === 'SYNC_TEMP') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse({ ok: false }); return; }
      var tempTabId = tabs[0].id;
      var nextState = {
        keywords: msg.keywords || [],
        hidden: filterTempHiddenIds(msg.hiddenIds)
      };
      bgGetTempScope().then(function (scope) {
        return bgSaveTempState(scope, tempTabId, nextState).then(function () {
          sendResponse({ ok: true });
          // 仅当前页面不落盘，但仍要把弹窗的结果广播给页面，否则改动留在弹窗里出不去
          return bgPushTempState(scope, tempTabId, nextState);
        }).catch(function () {
          sendResponse({ ok: false });
        });
      }).catch(function () {
        sendResponse({ ok: false });
      });
    });
    return true;
  }
  // 生效范围切换后，让已打开页面按新范围重取一份
  if (msg.type === 'TEMP_SCOPE_CHANGED') {
    bgRefreshTempEverywhere().catch(function () {});
    return false;
  }
  if (msg.type === 'CLEAR_TEMP') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      var tempTabId = tabs[0].id;
      var empty = { keywords: [], hidden: [] };
      bgGetTempScope().then(function (scope) {
        return bgSaveTempState(scope, tempTabId, empty).then(function () {
          return bgPushTempState(scope, tempTabId, empty);
        });
      }).catch(function () {});
    });
    return false;
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
    // 存完整样式（含自动黑白等文字配置），popup 预览/编辑需要还原，只存背景色会丢失
    var st = msg.style || {};
    Storage.storeSpotHighlight(tabId, frameId, msg.spotId, {
      text: msg.text,
      color: st.bgColor || msg.color,
      textColor: st.textColor,
      fontSize: st.fontSize,
      bold: st.bold === true,
      italic: st.italic === true,
      underline: st.underline === true,
      strike: st.strike === true
    }).catch(function () {});
    return false;
  }
  if (msg.type === 'GET_SPOT_HIGHLIGHTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) { sendResponse([]); return; }
      Storage.getAllSpotHighlightsForTab(tabs[0].id).then(sendResponse).catch(function () { sendResponse([]); });
    });
    return true;
  }
  if (msg.type === 'DELETE_SPOT_HIGHLIGHT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'DELETE_SPOT', spotId: msg.spotId });
      Storage.deleteSpotHighlightForTab(tabs[0].id, msg.spotId).catch(function () {});
    });
    return false;
  }
  if (msg.type === 'UPDATE_SPOT_STYLE') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      sendToAllFrames(tabs[0].id, { type: 'UPDATE_SPOT_STYLE', spotId: msg.spotId, style: msg.style });
      Storage.updateSpotStyle(tabs[0].id, msg.spotId, msg.style || {}).catch(function () {});
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

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || !tab.id) return;
  var selectedText = info.selectionText;
  if (!selectedText) return;

  if (info.menuItemId === 'add-highlight') {
    // 只发给发起右键的那一帧：不带 frameId 会广播到所有 frame，
    // 每个 frame 各生成一个不同 id / 不同随机色的关键词，落盘后就是一堆重复项
    var addOpts = (typeof info.frameId === 'number') ? { frameId: info.frameId } : null;
    var addCb = function (resp) {
      if (resp && resp.count > 0 && resp.settings) {
        if (resp.settings.openPopupOnAdd !== false) {
          chrome.action.openPopup().catch(function () {});
        }
      }
    };
    if (addOpts) chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_ADD_HIGHLIGHT', text: selectedText }, addOpts, addCb);
    else chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_ADD_HIGHLIGHT', text: selectedText }, addCb);
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
      // 文档重新加载时才清空角标计数；弹窗打开等场景高亮未重建，不能丢掉各 frame 已上报的数
      tabBadgeCounts[tabId] = { frames: {} };
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
  clearNavStatesForTab(tabId);
  bgDeleteTempState(tabId).catch(function () {});
  saveDisabledTabs();
});

// 临时高亮只在当前浏览器会话内有效：浏览器启动时整体清空
chrome.runtime.onStartup.addListener(function () {
  chrome.storage.local.remove(TEMP_KEY).catch(function () {});
});

// 新标签页继承：target=_blank / window.open 打开的标签页带走来源标签页的临时高亮。
// 两个事件都会触发，写入是幂等的覆盖，重复执行无副作用
chrome.tabs.onCreated.addListener(function (tab) {
  if (!tab || !tab.openerTabId || !tab.id) return;
  bgInheritTempState(tab.openerTabId, tab.id).catch(function () {});
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(function (details) {
  if (!details || !details.sourceTabId || !details.tabId) return;
  bgInheritTempState(details.sourceTabId, details.tabId).catch(function () {});
});

async function sendHighlightToTab(tabId, url) {
  try {
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
    text = count > 999 ? '999+' : String(count);
  }
  chrome.action.setBadgeText({ text: text, tabId: tabId }).catch(function () {});
  chrome.action.setBadgeBackgroundColor({ color: '#666666', tabId: tabId }).catch(function () {});
}

getSettings().then(function (s) {
  buildContextMenus(s);
}).catch(function () {});

loadDisabledTabs().catch(function () {});
