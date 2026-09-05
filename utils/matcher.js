var Matcher = {
  _regexCache: {},
  _cacheKeys: [],
  _maxCacheSize: 200,

  _getCachedRegex(pattern, flags) {
    var key = pattern + '\x00' + flags;
    var cached = this._regexCache[key];
    if (cached) return cached;
    try {
      var regex = new RegExp(pattern, flags);
      if (this._cacheKeys.length >= this._maxCacheSize) {
        var oldKey = this._cacheKeys.shift();
        delete this._regexCache[oldKey];
      }
      this._regexCache[key] = regex;
      this._cacheKeys.push(key);
      return regex;
    } catch (e) {
      return null;
    }
  },

  matchUrl(url, pattern, matchType) {
    if (!pattern) return false;
    try {
      switch (matchType) {
        case 'contains':
          return url.indexOf(pattern) !== -1;
        case 'exact':
          return url === pattern;
        case 'regex':
          var regex = this._getCachedRegex(pattern, '');
          return regex ? regex.test(url) : false;
        case 'wildcard':
          return this._wildcardMatch(url, pattern, false);
        default:
          return url.indexOf(pattern) !== -1;
      }
    } catch (e) {
      return false;
    }
  },

  getMatches(text, keyword, matchType, caseSensitive) {
    if (!keyword || !text) return [];
    try {
      var flags = caseSensitive ? 'g' : 'gi';
      var regex;
      switch (matchType) {
        case 'contains':
          // 子串匹配走 indexOf，比正则快数倍；关键词巨多时是主要热点
          var hay = caseSensitive ? text : text.toLowerCase();
          var needle = caseSensitive ? keyword : keyword.toLowerCase();
          var subMatches = [];
          var from = 0;
          var idx;
          while ((idx = hay.indexOf(needle, from)) !== -1) {
            subMatches.push({ start: idx, end: idx + needle.length, text: text.slice(idx, idx + needle.length) });
            from = idx + Math.max(1, needle.length);
          }
          return subMatches;
        case 'exact':
          return this._exactMatches(text, keyword, caseSensitive);
        case 'regex':
          regex = this._getCachedRegex(keyword, flags);
          break;
        case 'wildcard':
          // 文本匹配不锚定 ^...$，否则只能整段文本节点相等时命中，无法高亮文本中的子串
          regex = this._getCachedRegex(this._wildcardToRegex(keyword, false), flags);
          break;
        default:
          regex = this._getCachedRegex(this._escapeRegex(keyword), flags);
      }
      if (!regex) return [];

      var matches = [];
      var m;
      regex.lastIndex = 0;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }
      return matches;
    } catch (e) {
      return [];
    }
  },

  hasMatch(text, keyword, matchType, caseSensitive) {
    if (!keyword || !text) return false;
    try {
      var flags = caseSensitive ? '' : 'i';
      var regex;
      switch (matchType) {
        case 'contains':
          if (caseSensitive) return text.indexOf(keyword) !== -1;
          return text.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
        case 'exact':
          return this._exactHasMatch(text, keyword, caseSensitive);
        case 'regex':
          regex = this._getCachedRegex(keyword, flags);
          return regex ? regex.test(text) : false;
        case 'wildcard':
          regex = this._getCachedRegex(this._wildcardToRegex(keyword, false), flags);
          return regex ? regex.test(text) : false;
        default:
          if (caseSensitive) return text.indexOf(keyword) !== -1;
          return text.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
      }
    } catch (e) {
      return false;
    }
  },

  // 全量转义正则元字符（含 * ?），用于 contains / exact 等字面匹配。
  // 供 content 脚本的合并快筛复用，避免多处各自维护一套转义字符集。
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  // 通配符转义：不转义 * ?（它们是通配符），其余元字符转义。
  // 供 content 脚本的跨元素通配匹配复用。
  escapeWildcard(str) {
    return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  },

  _escapeRegex(str) {
    return this.escapeRegex(str);
  },

  _wildcardMatch(str, pattern, ignoreCase) {
    // URL 匹配语义 = 整串匹配，需要 ^...$ 锚定
    var regex = this._getCachedRegex(this._wildcardToRegex(pattern, true), ignoreCase ? 'i' : '');
    return regex ? regex.test(str) : false;
  },

  /**
   * 通配符转正则。anchored=true（默认）时加 ^...$ 用于 URL 整串匹配；
   * false 时只转义不锚定，用于文本子串匹配（高亮句子中的关键词）。
   */
  _wildcardToRegex(pattern, anchored) {
    var body = this.escapeWildcard(pattern)
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return anchored === false ? body : '^' + body + '$';
  },

  /**
   * 精确（整词）匹配：关键词前后都不能是 ASCII 词字符 [A-Za-z0-9_]。
   * 等价于 \b 对 ASCII 的行为，但把中文等非 ASCII 字符视为词边界，
   * 修复了 \b 只认 [A-Za-z0-9_]、导致中文关键词永远无法精确命中的问题。
   */
  _isAsciiWordChar(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  },

  _exactMatches(text, keyword, caseSensitive) {
    if (!keyword || !text) return [];
    var hay = caseSensitive ? text : text.toLowerCase();
    var needle = caseSensitive ? keyword : keyword.toLowerCase();
    var matches = [];
    var from = 0;
    var idx;
    while ((idx = hay.indexOf(needle, from)) !== -1) {
      var before = idx > 0 ? text.charAt(idx - 1) : '';
      var afterIdx = idx + needle.length;
      var after = afterIdx < text.length ? text.charAt(afterIdx) : '';
      if (!this._isAsciiWordChar(before) && !this._isAsciiWordChar(after)) {
        matches.push({ start: idx, end: afterIdx, text: text.slice(idx, afterIdx) });
      }
      from = idx + Math.max(1, needle.length);
    }
    return matches;
  },

  _exactHasMatch(text, keyword, caseSensitive) {
    if (!keyword || !text) return false;
    var hay = caseSensitive ? text : text.toLowerCase();
    var needle = caseSensitive ? keyword : keyword.toLowerCase();
    var from = 0;
    var idx;
    while ((idx = hay.indexOf(needle, from)) !== -1) {
      var before = idx > 0 ? text.charAt(idx - 1) : '';
      var after = idx + needle.length < text.length ? text.charAt(idx + needle.length) : '';
      if (!this._isAsciiWordChar(before) && !this._isAsciiWordChar(after)) return true;
      from = idx + Math.max(1, needle.length);
    }
    return false;
  }
};
