var Storage = {
  KEYS: {
    RULES: 'ah_rules',
    SETTINGS: 'ah_settings',
    STORAGE_MODE: 'ah_storage_mode'
  },

  defaultSettings: {
    showRail: true,
    stylePresets: [],
    // 临时高亮的默认样式（popup 搜索区「自定义样式」配置，持久化记忆）
    tempStyle: null,
    historyEnabled: true,
    tempHistory: [],
    // 临时高亮生效范围：page=仅当前页面（刷新/跳转即失效）
    // tab=跟随标签页（刷新、前进后退、跳转保留，target=_blank 新标签页继承来源快照）
    // global=全局所有网页（所有标签页共用一份，手动清空为止）
    tempScope: 'tab',
    defaultMatchType: 'contains',
    defaultCaseSensitive: false,
    defaultAcrossElements: false,
    contextMenuEnabled: true,
    openPopupOnAdd: true,
    openPopupOnSpot: true,
    openPopupOnAddShortcut: true,
    openPopupOnSpotShortcut: true,
    spotContextMenuEnabled: true,
    // 捐赠提醒：donateDismissed = 点过「不再提示」，永久关闭；
    // donateLastVisitAt = 点过「去看看」的时间戳，冷却期内不再弹
    donateDismissed: false,
    donateLastVisitAt: 0
  },

  _fallbackChecked: false,
  _isLocal: false,

  async _checkFallback() {
    if (this._fallbackChecked) return;
    this._fallbackChecked = true;
    var data = await chrome.storage.local.get(this.KEYS.STORAGE_MODE);
    this._isLocal = data[this.KEYS.STORAGE_MODE] === 'local';
  },

  async _get(keys) {
    await this._checkFallback();
    if (this._isLocal) {
      return await chrome.storage.local.get(keys);
    }
    return await chrome.storage.sync.get(keys);
  },

  async _set(obj) {
    await this._checkFallback();
    if (this._isLocal) {
      await chrome.storage.local.set(obj);
      return;
    }
    try {
      await chrome.storage.sync.set(obj);
    } catch (e) {
      if (e.message && (e.message.indexOf('QUOTA') !== -1 || e.message.indexOf('MAX') !== -1)) {
        await chrome.storage.local.set({ [this.KEYS.STORAGE_MODE]: 'local' });
        this._isLocal = true;
        await chrome.storage.local.set(obj);
        try { await chrome.storage.sync.remove([this.KEYS.RULES, this.KEYS.SETTINGS]); } catch (ignore) {}
        return;
      }
      throw e;
    }
  },

  isLocal() {
    return this._isLocal;
  },

  async getStorageInfo() {
    await this._checkFallback();
    if (this._isLocal) {
      var localBytes = await new Promise(function (r) { chrome.storage.local.getBytesInUse(null, r); });
      var localMax = chrome.storage.local.QUOTA_BYTES || 5242880;
      return { bytesUsed: localBytes, maxBytes: localMax, isLocal: true };
    }
    var syncBytes = await new Promise(function (r) { chrome.storage.sync.getBytesInUse(null, r); });
    var syncMax = chrome.storage.sync.QUOTA_BYTES || 102400;
    return { bytesUsed: syncBytes, maxBytes: syncMax, isLocal: false };
  },

  async getRules() {
    var data = await this._get(this.KEYS.RULES);
    return data[this.KEYS.RULES] || [];
  },

  async saveRules(rules) {
    await this._set({ [this.KEYS.RULES]: rules });
  },

  async getSettings() {
    await this._checkFallback();
    var stored;
    if (this._isLocal) {
      var localData = await chrome.storage.local.get(this.KEYS.SETTINGS);
      stored = localData[this.KEYS.SETTINGS] || {};
    } else {
      var data = await chrome.storage.sync.get(this.KEYS.SETTINGS);
      stored = data[this.KEYS.SETTINGS] || {};
    }
    var s = Object.assign({}, this.defaultSettings, stored);
    s.stylePresets = this._resolvePresets(stored);
    return s;
  },

  /**
   * 预设迁移：旧字段 colorPresets（hex 字符串数组）首次读取时转换为 stylePresets。
   * 字段完全不存在（全新安装）时给一份出厂预设；显式存了空数组则保持空，
   * 由 StyleKit.getDefaultStyle 回退到内置默认样式。
   */
  _resolvePresets(stored) {
    if (typeof StyleKit === 'undefined') return [];
    var list;
    if (Array.isArray(stored.stylePresets)) list = stored.stylePresets;
    else if (Array.isArray(stored.colorPresets)) list = stored.colorPresets;
    else return StyleKit.getDefaultPresets();
    return StyleKit.normalizePresets(list);
  },

  async saveSettings(settings) {
    await this._set({ [this.KEYS.SETTINGS]: settings });
  },

  async addRule(rule) {
    var rules = await this.getRules();
    rule.id = this._uuid();
    rule.enabled = true;
    rule.name = rule.name || '';
    rule.keywords = [];
    rules.push(rule);
    await this.saveRules(rules);
    return rule;
  },

  async updateRule(ruleId, updates) {
    var rules = await this.getRules();
    var idx = rules.findIndex(function (r) { return r.id === ruleId; });
    if (idx !== -1) {
      Object.assign(rules[idx], updates);
      await this.saveRules(rules);
      return rules[idx];
    }
    return null;
  },

  async deleteRule(ruleId) {
    var rules = await this.getRules();
    var filtered = rules.filter(function (r) { return r.id !== ruleId; });
    await this.saveRules(filtered);
  },

  async addKeyword(ruleId, keyword) {
    var rules = await this.getRules();
    var rule = rules.find(function (r) { return r.id === ruleId; });
    if (!rule) return null;
    keyword.id = this._uuid();
    keyword.enabled = true;
    // 样式字段一律不设默认值：缺省即「继承全局默认」（stylePresets[0]），
    // 这样新增关键词会跟随全局样式的变化，而不是被创建时的默认值钉死。
    if (!keyword.matchType) keyword.matchType = 'contains';
    if (keyword.caseSensitive === undefined) keyword.caseSensitive = false;
    if (keyword.acrossElements === undefined) keyword.acrossElements = false;
    if (keyword.showRail === undefined) keyword.showRail = true;
    if (keyword.exclusive === undefined) keyword.exclusive = false;
    rule.keywords.push(keyword);
    await this.saveRules(rules);
    return keyword;
  },

  async updateKeyword(ruleId, keywordId, updates) {
    var rules = await this.getRules();
    var rule = rules.find(function (r) { return r.id === ruleId; });
    if (!rule) return null;
    var kw = rule.keywords.find(function (k) { return k.id === keywordId; });
    if (!kw) return null;
    Object.assign(kw, updates);
    await this.saveRules(rules);
    return kw;
  },

  async deleteKeyword(ruleId, keywordId) {
    var rules = await this.getRules();
    var rule = rules.find(function (r) { return r.id === ruleId; });
    if (!rule) return;
    rule.keywords = rule.keywords.filter(function (k) { return k.id !== keywordId; });
    await this.saveRules(rules);
  },

  async getMatchedRules(url) {
    var rules = await this.getRules();
    var matched = null;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].enabled && Matcher.matchUrl(url, rules[i].urlPattern, rules[i].urlMatchType)) {
        matched = rules[i];
        break;
      }
    }
    return matched ? [matched] : [];
  },

  _uuid() {
    return CommonKit.uid();
  },

  SPOT_KEY: 'ah_spot_highlights',

  _spotFrameKey(tabId, frameId) {
    return 'spot_' + tabId + '_' + (frameId || 0);
  },

  async getSpotHighlights(tabId, frameId) {
    var data = await chrome.storage.local.get(this.SPOT_KEY);
    var all = data[this.SPOT_KEY] || {};
    var key = this._spotFrameKey(tabId, frameId);
    return all[key] || [];
  },

  async getAllSpotHighlightsForTab(tabId) {
    var data = await chrome.storage.local.get(this.SPOT_KEY);
    var all = data[this.SPOT_KEY] || {};
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
  },

  async saveSpotHighlights(tabId, frameId, highlights) {
    var data = await chrome.storage.local.get(this.SPOT_KEY);
    var all = data[this.SPOT_KEY] || {};
    var key = this._spotFrameKey(tabId, frameId);
    all[key] = highlights;
    await chrome.storage.local.set({ [this.SPOT_KEY]: all });
  },

  async addSpotHighlight(tabId, frameId, highlight) {
    var list = await this.getSpotHighlights(tabId, frameId);
    highlight.id = this._uuid();
    highlight.createdAt = Date.now();
    list.push(highlight);
    await this.saveSpotHighlights(tabId, frameId, list);
    return highlight;
  },

  async deleteSpotHighlight(tabId, frameId, spotId) {
    var list = await this.getSpotHighlights(tabId, frameId);
    list = list.filter(function (s) { return s.id !== spotId; });
    await this.saveSpotHighlights(tabId, frameId, list);
  },

  async clearSpotHighlights(tabId, frameId) {
    await this.saveSpotHighlights(tabId, frameId, []);
  },

  // 以下三个是 background 用的变体：写入时 spotId 已定、删除/改样式要扫遍该 tab
  // 所有 frame 的 key（子 frame 里创建的 spot 只按单 frame 删不干净）。
  // spot 的存储键格式只在这里维护，background 通过这些方法读写，不要再拼 'spot_' 字符串
  async storeSpotHighlight(tabId, frameId, spotId, data) {
    var dataAll = await chrome.storage.local.get(this.SPOT_KEY);
    var all = dataAll[this.SPOT_KEY] || {};
    var key = this._spotFrameKey(tabId, frameId);
    var list = all[key] || [];
    list.push({
      id: spotId,
      text: data.text,
      color: data.color,
      textColor: data.textColor,
      fontSize: data.fontSize,
      bold: data.bold === true,
      italic: data.italic === true,
      underline: data.underline === true,
      strike: data.strike === true,
      createdAt: Date.now()
    });
    all[key] = list;
    await chrome.storage.local.set({ [this.SPOT_KEY]: all });
  },

  async deleteSpotHighlightForTab(tabId, spotId) {
    var data = await chrome.storage.local.get(this.SPOT_KEY);
    var all = data[this.SPOT_KEY] || {};
    var prefix = 'spot_' + tabId + '_';
    for (var key in all) {
      if (all.hasOwnProperty(key) && key.indexOf(prefix) === 0) {
        all[key] = all[key].filter(function (s) { return s.id !== spotId; });
      }
    }
    await chrome.storage.local.set({ [this.SPOT_KEY]: all });
  },

  async updateSpotStyle(tabId, spotId, style) {
    var data = await chrome.storage.local.get(this.SPOT_KEY);
    var all = data[this.SPOT_KEY] || {};
    var prefix = 'spot_' + tabId + '_';
    for (var key in all) {
      if (all.hasOwnProperty(key) && key.indexOf(prefix) === 0) {
        var list = all[key];
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === spotId) {
            if (style.bgColor !== undefined) list[i].color = style.bgColor || '';
            list[i].textColor = style.textColor;
            list[i].fontSize = style.fontSize;
            list[i].bold = style.bold === true;
            list[i].italic = style.italic === true;
            list[i].underline = style.underline === true;
            list[i].strike = style.strike === true;
          }
        }
      }
    }
    await chrome.storage.local.set({ [this.SPOT_KEY]: all });
  }
};
