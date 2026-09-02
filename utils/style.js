// 高亮样式的单一数据源：content（渲染）/ options（配置）/ popup（快速编辑）三端共用
// 依赖：无。需在 manifest 的 content_scripts、options.html、popup.html 中分别引入
var StyleKit = (function () {
  'use strict';

  // 内置兜底：预设被删空时使用（textColor 用 'inherit' 保持原色，不默认自动反色）
  var BUILTIN_DEFAULT = {
    bgColor: '#ffeb3b',
    textColor: 'inherit',
    fontSize: 1,
    bold: false,
    italic: false,
    underline: false,
    strike: false
  };

  var STYLE_KEYS = ['bgColor', 'textColor', 'fontSize', 'bold', 'italic', 'underline', 'strike'];

  // 关键词上的样式字段名（背景色沿用历史的 color，其余同名）
  var KEYWORD_FIELDS = {
    bgColor: 'color',
    textColor: 'textColor',
    fontSize: 'fontSize',
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strike: 'strike'
  };

  var MIN_FONT_SIZE = 0.5;
  var MAX_FONT_SIZE = 3;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function blankStyle() {
    return {
      bgColor: '',
      textColor: 'inherit',
      fontSize: 1,
      bold: false,
      italic: false,
      underline: false,
      strike: false
    };
  }

  function clampFontSize(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return 1;
    if (n < MIN_FONT_SIZE) return MIN_FONT_SIZE;
    if (n > MAX_FONT_SIZE) return MAX_FONT_SIZE;
    return n;
  }

  // 兼容旧格式：hex 字符串 -> 样式对象（必须补全全部字段，否则预设残缺）
  function normalizePreset(raw) {
    var p = blankStyle();
    if (typeof raw === 'string') {
      p.bgColor = raw;
    } else if (raw && typeof raw === 'object') {
      p.bgColor = typeof raw.bgColor === 'string' ? raw.bgColor : '';
      p.textColor = raw.textColor === undefined ? 'inherit' : raw.textColor;
      p.fontSize = clampFontSize(raw.fontSize);
      p.bold = raw.bold === true;
      p.italic = raw.italic === true;
      p.underline = raw.underline === true;
      p.strike = raw.strike === true;
      if (raw.id) p.id = raw.id;
    }
    if (!p.id) p.id = uid();
    // 文字颜色：null（自动反色）/ 'inherit'（保持原色）/ '#rrggbb'；非法值归为保持原色
    if (p.textColor !== null && p.textColor !== 'inherit') {
      if (typeof p.textColor !== 'string' || p.textColor.charAt(0) !== '#') p.textColor = 'inherit';
    }
    return p;
  }

  function normalizePresets(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) out.push(normalizePreset(raw[i]));
    return out;
  }

  /** 全局默认 = 预设列表第一项；列表为空时回退内置样式。返回克隆，防止调用方误改预设对象 */
  function getDefaultStyle(settings) {
    // 兼容两种来源：stylePresets（新）与 colorPresets（旧导入数据）
    var raw = settings && (settings.stylePresets || settings.colorPresets);
    var presets = normalizePresets(raw);
    var base = presets.length > 0 ? presets[0] : BUILTIN_DEFAULT;
    return normalizePreset(base);
  }

  function getDefaultPresets() {
    return normalizePresets(['#ffeb3b', '#ff6b6b', '#a8e6cf', '#ffd93d', '#6bcb77', '#4d96ff', '#c084fc', '#fb923c']);
  }

  // 关键词覆写叠加到基底样式上，空值表示继承
  function resolveFrom(base, over) {
    var s = {
      bgColor: base.bgColor,
      // 文字颜色不做全局默认继承：未设置 = 保持页面原色
      textColor: undefined,
      fontSize: base.fontSize,
      bold: base.bold,
      italic: base.italic,
      underline: base.underline,
      strike: base.strike
    };
    if (!over) return s;

    var bg = over[KEYWORD_FIELDS.bgColor];
    if (bg === undefined || bg === null) bg = over.bgColor;
    if (bg !== undefined && bg !== null) s.bgColor = bg;

    var tc = over.textColor;
    if (tc !== undefined) s.textColor = tc;

    if (over.fontSize !== undefined && over.fontSize !== null) s.fontSize = clampFontSize(over.fontSize);
    if (over.bold !== undefined && over.bold !== null) s.bold = over.bold === true;
    if (over.italic !== undefined && over.italic !== null) s.italic = over.italic === true;
    if (over.underline !== undefined && over.underline !== null) s.underline = over.underline === true;
    if (over.strike !== undefined && over.strike !== null) s.strike = over.strike === true;

    return s;
  }

  function resolveStyle(kw, settings) {
    return resolveFrom(getDefaultStyle(settings), kw);
  }

  // 按亮度自动取黑/白
  function contrastColor(hexColor) {
    if (!hexColor || hexColor.charAt(0) !== '#') return '#000000';
    var hex = hexColor.replace('#', '');
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (hex.length < 6) return '#000000';
    var r = parseInt(hex.substr(0, 2), 16);
    var g = parseInt(hex.substr(2, 2), 16);
    var b = parseInt(hex.substr(4, 2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return '#000000';
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
  }

  // 文字颜色：'#xxx'=自定义；null=自动反色（按背景亮度取黑/白）；其余（undefined/'inherit'）= 保持页面原色
  function resolveTextColor(style) {
    if (typeof style.textColor === 'string' && style.textColor.charAt(0) === '#') return style.textColor;
    if (style.textColor === null) return contrastColor(style.bgColor);
    return 'inherit';
  }

  // 下划线与删除线可叠加
  function decorationOf(style) {
    var parts = [];
    if (style.underline) parts.push('underline');
    if (style.strike) parts.push('line-through');
    return parts.length ? parts.join(' ') : '';
  }

  // 应用到 ah-mark / ah-spot 元素
  function applyToElement(el, style, hidden) {
    if (!el) return;
    if (hidden) {
      el.classList.add('ah-hidden');
      return;
    }
    el.classList.remove('ah-hidden');

    if (style.bgColor) {
      el.style.backgroundColor = style.bgColor;
      el.style.padding = '0';
      el.style.borderRadius = '2px';
    } else {
      el.style.backgroundColor = 'transparent';
      el.style.padding = '0';
      el.style.borderRadius = '0';
    }

    el.style.color = resolveTextColor(style);
    // 1 倍时留空，减小 DOM 体积，且等价于继承父级字号
    el.style.fontSize = style.fontSize === 1 ? '' : style.fontSize + 'em';
    el.style.fontWeight = style.bold ? '700' : '';
    el.style.fontStyle = style.italic ? 'italic' : '';
    el.style.textDecoration = decorationOf(style);
  }

  // 预览块：只有背景 -> 整块填充；只有文字色 -> 文字 + 外框；只有字号 -> 纯块 + 右上角 +/− 角标
  /**
   * 样式是否显式定义了文本样式（文字色 / 字形）。
   * 自动反色（null）或自定义文字色（'#xxx'）都算「定义了文字颜色」；
   * 未设置（undefined / 'inherit'）= 保持页面原色，不算；
   * 字号不算文本样式——只有字号差异时预览不渲染 Aa，仅以 +/− 角标表达，
   * 否则「没调文字却出现文字」的预览会产生误导。
   */
  function styleHasText(style) {
    if (!style) return false;
    if (style.textColor === null) return true;
    if (typeof style.textColor === 'string' && style.textColor.charAt(0) === '#') return true;
    if (style.bold || style.italic || style.underline || style.strike) return true;
    return false;
  }

  /** 字号角标：字号偏离 1 时在预览块右上角显示一个小圆角标（+/−），
   *  比缩放预览文字更直观（大字号会撑爆小块、小变化又看不出来）。
   *  做成实底小圆而非裸字符：任何底色下都清晰，视觉上也更规整。
   *  +/− 用 CSS 渐变条绘制而非字符，避免字体度量导致的不居中。 */
  function appendFsBadge(el, style) {
    var fs = style && style.fontSize;
    if (!fs || fs === 1) return;
    var hasBg = !!style.bgColor;
    var badge = document.createElement('span');
    badge.style.position = 'absolute';
    badge.style.top = '-3px';
    badge.style.right = '-3px';
    badge.style.width = '14px';
    badge.style.height = '14px';
    badge.style.boxSizing = 'border-box';
    badge.style.borderRadius = '50%';
    // 底圆取与预览块反色的纯色（无背景时用中性深灰），配白色描边确保分离清晰
    var badgeBg = hasBg ? contrastColor(style.bgColor) : '#666666';
    badge.style.backgroundColor = badgeBg;
    badge.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.9)';
    // +/− 用绝对定位的子元素条绘制（translate 锚定圆心），避免字体度量或渐变层兼容问题
    var barColor = badgeBg === '#ffffff' ? '#333333' : '#ffffff';
    function bar(w, h) {
      var b = document.createElement('span');
      b.style.position = 'absolute';
      b.style.left = '50%';
      b.style.top = '50%';
      b.style.width = w;
      b.style.height = h;
      b.style.transform = 'translate(-50%, -50%)';
      b.style.backgroundColor = barColor;
      b.style.borderRadius = '1px';
      return b;
    }
    badge.appendChild(bar('6px', '1.5px'));
    if (fs > 1) badge.appendChild(bar('1.5px', '6px'));
    el.appendChild(badge);
  }

  function renderPreview(el, style, w, h) {
    if (!el) return;
    el.style.boxSizing = 'border-box';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.flexShrink = '0';
    el.style.lineHeight = '1';
    // 角标挂在预览块外沿，不能被裁掉
    el.style.overflow = 'visible';
    el.style.borderRadius = '4px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.position = 'relative';

    var hasBg = !!style.bgColor;
    el.style.backgroundColor = hasBg ? style.bgColor : 'transparent';
    el.style.border = hasBg ? 'none' : '1px solid #d0d0d0';

    el.innerHTML = '';

    // 只有字号差异不渲染 Aa（字号不算文本样式），仅以右上角 +/− 角标表达；
    // 其余无文本样式的情况：只显示背景色（或透明边框占位）
    if (styleHasText(style)) {
      var textEl = document.createElement('span');
      textEl.textContent = 'Aa';
      // 文字固定基准大小，字号变化交给右上角角标表达
      textEl.style.fontSize = Math.max(9, Math.round(h * 0.46)) + 'px';
      textEl.style.fontWeight = style.bold ? '700' : '400';
      textEl.style.fontStyle = style.italic ? 'italic' : 'normal';
      textEl.style.textDecoration = decorationOf(style) || 'none';

      // 预览块没有「页面原色」可继承，回退为对背景的反色或中性深色
      var tc = style.textColor;
      if (tc !== 'inherit' && (!tc || tc.charAt(0) !== '#')) tc = null;
      if (!tc) tc = hasBg ? contrastColor(style.bgColor) : '#333333';
      textEl.style.color = tc;
      el.appendChild(textEl);
    }

    appendFsBadge(el, style);
  }

  function makePreview(style, w, h) {
    var el = document.createElement('span');
    renderPreview(el, style, w, h);
    return el;
  }

  /**
   * 预设圆点：圆形造型，与「当前样式方形预览」区分。
   * 有文本样式（文字色/字形）的预设显示 Aa，只有背景色的显示纯色圆点；
   * 只有字号差异的同样不渲染 Aa，仅以右上角 +/- 角标表达（与方形预览一致）。
   */
  function renderPresetDot(el, style, size) {
    if (!el) return;
    el.style.boxSizing = 'border-box';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.borderRadius = '50%';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.flexShrink = '0';
    el.style.lineHeight = '1';
    // 文字不再随字号缩放，放开裁剪以露出右上角字号角标
    el.style.overflow = 'visible';
    el.style.position = 'relative';

    var hasBg = !!style.bgColor;
    el.style.background = hasBg ? style.bgColor : 'transparent';
    el.style.border = hasBg ? 'none' : '1px solid #d0d0d0';

    el.innerHTML = '';

    if (styleHasText(style)) {
      var textEl = document.createElement('span');
      textEl.textContent = 'Aa';
      // 文字固定基准大小，字号变化交给右上角角标表达
      textEl.style.fontSize = Math.max(8, Math.round(size * 0.42)) + 'px';
      textEl.style.fontWeight = style.bold ? '700' : '400';
      textEl.style.fontStyle = style.italic ? 'italic' : 'normal';
      textEl.style.textDecoration = decorationOf(style) || 'none';
      var tc = (typeof style.textColor === 'string' && style.textColor.charAt(0) === '#')
        ? style.textColor
        : (hasBg ? contrastColor(style.bgColor) : '#333333');
      textEl.style.color = tc;
      el.appendChild(textEl);
    }

    appendFsBadge(el, style);
  }

  function styleEquals(a, b) {
    if (!a || !b) return false;
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      var va = a[k];
      var vb = b[k];
      if (k === 'fontSize') {
        if (clampFontSize(va) !== clampFontSize(vb)) return false;
      } else if (k === 'bold' || k === 'italic' || k === 'underline' || k === 'strike') {
        if (!!va !== !!vb) return false;
      } else if (k === 'textColor') {
        // 区分 null（自动反色）与 undefined/'inherit'（保持原色）
        var na = va === undefined ? '' : (va === null ? '@auto' : (va || ''));
        var nb = vb === undefined ? '' : (vb === null ? '@auto' : (vb || ''));
        if (na !== nb) return false;
      } else {
        if ((va || '') !== (vb || '')) return false;
      }
    }
    return true;
  }

  // 关键词是否处于「跟随全局默认」态（所有字段都没有显式值）
  function isInheriting(kw) {
    if (!kw) return true;
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var f = KEYWORD_FIELDS[STYLE_KEYS[i]];
      var v = kw[f];
      if (v === undefined || v === null) {
        // textColor=null 是显式「自动反色」，不算继承；其余 null 视为未设置
        if (STYLE_KEYS[i] === 'textColor' && v === null) return false;
        continue;
      }
      // 背景色空串 = 显式「无背景」，是有效设置
      if (v === '' && f !== 'color') continue;
      return false;
    }
    return true;
  }

  // 取出对象上显式写过的样式（未显式设置的字段留 undefined）。
  // 兼容两种字段名：关键词对象用 color，样式/预设对象用 bgColor。
  // 背景色空串（透明）是有效值，保留；其余字段的空串/空值丢弃。
  // textColor=null（自动反色）是有效值，保留。
  function keywordOverrides(kw) {
    var o = {};
    if (!kw) return o;
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      var f = KEYWORD_FIELDS[k];
      var v = kw[f];
      if (v === undefined || v === null) v = kw[k];
      if (v === undefined) continue;
      if (v === '' && k !== 'bgColor') continue;
      if (v === null && k !== 'textColor') continue;
      o[k] = v;
    }
    return o;
  }

  // 把样式写回关键词字段。undefined 字段 = 「未设置」（跟随全局默认），不写入并清除旧值
  function applyStyleToKeyword(kw, style) {
    if (!kw || !style) return kw;
    if (style.bgColor === undefined) delete kw[KEYWORD_FIELDS.bgColor];
    else kw[KEYWORD_FIELDS.bgColor] = style.bgColor || '';
    if (style.textColor === undefined) delete kw.textColor;
    else kw.textColor = style.textColor;
    if (style.fontSize === undefined) delete kw.fontSize;
    else kw.fontSize = clampFontSize(style.fontSize);
    if (style.bold === undefined) delete kw.bold;
    else kw.bold = style.bold === true;
    if (style.italic === undefined) delete kw.italic;
    else kw.italic = style.italic === true;
    if (style.underline === undefined) delete kw.underline;
    else kw.underline = style.underline === true;
    if (style.strike === undefined) delete kw.strike;
    else kw.strike = style.strike === true;
    return kw;
  }

  // 清除关键词上的全部样式字段，恢复为「跟随全局默认」
  function clearKeywordStyle(kw) {
    if (!kw) return kw;
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      delete kw[KEYWORD_FIELDS[STYLE_KEYS[i]]];
    }
    return kw;
  }

  // 用于去重 / 比较的稳定序列化
  function serialize(style) {
    if (!style) return '';
    return [
      style.bgColor || '',
      style.textColor === undefined ? '' : (style.textColor === null ? '@auto' : style.textColor),
      clampFontSize(style.fontSize),
      style.bold ? '1' : '0',
      style.italic ? '1' : '0',
      style.underline ? '1' : '0',
      style.strike ? '1' : '0'
    ].join(',');
  }

  // 兼容别名：生成 / 克隆一个完整样式对象（补全全部字段，保留 id）
  function makeStyle(s) {
    return normalizePreset(s);
  }

  function cloneStyle(s) {
    return normalizePreset(s);
  }

  return {
    STYLE_KEYS: STYLE_KEYS,
    KEYWORD_FIELDS: KEYWORD_FIELDS,
    MIN_FONT_SIZE: MIN_FONT_SIZE,
    MAX_FONT_SIZE: MAX_FONT_SIZE,
    BUILTIN_DEFAULT: BUILTIN_DEFAULT,
    uid: uid,
    blankStyle: blankStyle,
    clampFontSize: clampFontSize,
    makeStyle: makeStyle,
    cloneStyle: cloneStyle,
    normalizePreset: normalizePreset,
    normalizePresets: normalizePresets,
    getDefaultStyle: getDefaultStyle,
    getDefaultPresets: getDefaultPresets,
    resolveFrom: resolveFrom,
    resolveStyle: resolveStyle,
    contrastColor: contrastColor,
    resolveTextColor: resolveTextColor,
    decorationOf: decorationOf,
    applyToElement: applyToElement,
    renderPreview: renderPreview,
    makePreview: makePreview,
    renderPresetDot: renderPresetDot,
    styleHasText: styleHasText,
    styleEquals: styleEquals,
    isInheriting: isInheriting,
    keywordOverrides: keywordOverrides,
    applyStyleToKeyword: applyStyleToKeyword,
    clearKeywordStyle: clearKeywordStyle,
    serialize: serialize
  };
})();
