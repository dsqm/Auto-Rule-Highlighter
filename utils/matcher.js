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
          regex = this._getCachedRegex(this._escapeRegex(keyword), flags);
          break;
        case 'exact':
          regex = this._getCachedRegex('\\b' + this._escapeRegex(keyword) + '\\b', flags);
          break;
        case 'regex':
          regex = this._getCachedRegex(keyword, flags);
          break;
        case 'wildcard':
          regex = this._getCachedRegex(this._wildcardToRegex(keyword), flags);
          break;
        default:
          regex = this._getCachedRegex(this._escapeRegex(keyword), flags);
      }
      if (!regex) return [];

      var matches = [];
      var m;
      regex.lastIndex = 0;
      while ((m = regex.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        if (m[0].length === 0) regex.lastIndex++;
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
          regex = this._getCachedRegex('\\b' + this._escapeRegex(keyword) + '\\b', flags);
          return regex ? regex.test(text) : false;
        case 'regex':
          regex = this._getCachedRegex(keyword, flags);
          return regex ? regex.test(text) : false;
        case 'wildcard':
          regex = this._getCachedRegex(this._wildcardToRegex(keyword), flags);
          return regex ? regex.test(text) : false;
        default:
          if (caseSensitive) return text.indexOf(keyword) !== -1;
          return text.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
      }
    } catch (e) {
      return false;
    }
  },

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  _wildcardMatch(str, pattern, ignoreCase) {
    var regex = this._getCachedRegex(this._wildcardToRegex(pattern), ignoreCase ? 'i' : '');
    return regex ? regex.test(str) : false;
  },

  _wildcardToRegex(pattern) {
    return '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$';
  }
};
