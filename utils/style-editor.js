/**
 * StyleEditor — 带开关的样式编辑器（背景 / 文字 / 字号 / 字形）
 *
 * 依赖：StyleKit（utils/style.js，需先引入）
 * 供 options 与 popup 共用，渲染到调用方提供的容器内。
 *
 * 语义：
 *   背景开关  开 = 自定义背景色；关 = 无背景（透明）
 *   文字开关  开 = 启用文字样式；关 = 不染色（保持页面原色）
 *             开启后可二选一：勾「自动反色」（按背景亮度取黑/白，随背景变化）
 *             或填自定义颜色；两者互斥，且自动反色复选框受文字开关控制
 *   字号开关  开 = 自定义字号；关 = 默认字号
 *   字形 chips 独立开关（加粗 / 斜体 / 下划线 / 删除线）
 *
 * read() 返回 overrides 对象：
 *   bgColor  ''（透明）或 '#rrggbb'；关 = ''
 *   textColor null（自动反色）/ '#rrggbb'；关 = 不写入（undefined = 保持原色）
 *   fontSize  数值；关 = 不写入
 *
 * 第二个参数 initialStyle 是「解析后的有效样式」（决定控件显示的数值），
 * 第三个参数 overrides 是「显式设置过的字段」（决定各开关的勾选态）。
 * 不传 overrides 时退化为用 initialStyle 自身判定。
 * 第四个参数 defaults 提供默认颜色（通常传预设第一个的 bgColor）：
 *   勾选背景开关但未填色时，用该颜色填充，避免「开了背景却是透明的」。
 */
var StyleEditor = (function () {
  'use strict';

  var FIELDS = ['bgColor', 'textColor', 'fontSize', 'bold', 'italic', 'underline', 'strike'];

  // 共享悬停提示：原生 title 不支持换行，这里用固定定位的 tooltip（支持多行、防溢出裁剪）
  var tipEl = null;
  function ensureTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.style.cssText =
        'position:fixed;z-index:1000000;background:#333;color:#fff;' +
        'font-size:11px;line-height:1.55;padding:6px 8px;border-radius:4px;' +
        'max-width:280px;white-space:pre-line;pointer-events:none;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.25);display:none;';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function bindTip(el) {
    if (!el || !el.getAttribute('data-tip')) return;
    var tip = ensureTip();
    el.addEventListener('mouseenter', function () {
      tip.textContent = el.getAttribute('data-tip') || '';
      tip.style.display = 'block';
    });
    el.addEventListener('mousemove', function (e) {
      var pad = 12;
      tip.style.left = (e.clientX + pad) + 'px';
      tip.style.top = (e.clientY + pad) + 'px';
      // 防溢出：超出视口右/下边缘时翻转到另一侧
      var r = tip.getBoundingClientRect();
      if (r.right > window.innerWidth) tip.style.left = (e.clientX - r.width - pad) + 'px';
      if (r.bottom > window.innerHeight) tip.style.top = (e.clientY - r.height - pad) + 'px';
    });
    el.addEventListener('mouseleave', function () {
      tip.style.display = 'none';
    });
  }

  function mountStyleEditor(container, initialStyle, overrides, defaults) {
    if (!container) return { read: function () { return {}; }, set: function () {} };

    var st = initialStyle || {};
    var ov = overrides || st;
    // 勾选背景开关但无颜色时，用默认色填充（预设第一个的颜色；未传时兜底内置默认色）
    var defaultBg = (defaults && typeof defaults.bgColor === 'string' && defaults.bgColor.charAt(0) === '#')
      ? defaults.bgColor
      : StyleKit.BUILTIN_DEFAULT.bgColor;

    container.innerHTML =
      '<div class="se-row"><span class="se-label">背景</span>' +
        '<input type="checkbox" class="se-toggle se-bg-toggle">' +
        '<input type="color" class="se-bg-color" value="#ffeb3b">' +
        '<input type="text" class="se-bg-hex" value="" maxlength="7" placeholder="无背景">' +
      '</div>' +
      '<div class="se-row"><span class="se-label">文字</span>' +
        '<input type="checkbox" class="se-toggle se-text-toggle">' +
        '<input type="color" class="se-text-color" value="#000000">' +
        '<input type="text" class="se-text-hex" value="" maxlength="7" placeholder="">' +
        '<label class="se-auto-invert"><input type="checkbox" class="se-auto-invert-cb">自动反色</label>' +
      '</div>' +
      '<div class="se-row"><span class="se-label">字号</span>' +
        '<input type="checkbox" class="se-toggle se-fs-toggle">' +
        '<input type="range" class="se-font-size" min="0.5" max="3" step="0.05" value="1">' +
        '<span class="se-fs-val">1.0×</span>' +
      '</div>' +
      '<div class="se-row"><span class="se-label">字形</span>' +
        '<button type="button" class="se-chip b" title="加粗">B</button>' +
        '<button type="button" class="se-chip i" title="斜体">I</button>' +
        '<button type="button" class="se-chip u" title="下划线">U</button>' +
        '<button type="button" class="se-chip s" title="删除线">S</button>' +
      '</div>';

    var bgToggle = container.querySelector('.se-bg-toggle');
    var bgColor = container.querySelector('.se-bg-color');
    var bgHex = container.querySelector('.se-bg-hex');
    var textToggle = container.querySelector('.se-text-toggle');
    var textColor = container.querySelector('.se-text-color');
    var textHex = container.querySelector('.se-text-hex');
    var autoInvertCb = container.querySelector('.se-auto-invert-cb');
    var fsToggle = container.querySelector('.se-fs-toggle');
    var fsRange = container.querySelector('.se-font-size');
    var fsVal = container.querySelector('.se-fs-val');
    var chipB = container.querySelector('.se-chip.b');
    var chipI = container.querySelector('.se-chip.i');
    var chipU = container.querySelector('.se-chip.u');
    var chipS = container.querySelector('.se-chip.s');

    // 自动反色悬停提示（data-tip 用 JS 赋值，避免 innerHTML 把换行折叠成空格）
    var invertLabel = container.querySelector('.se-auto-invert');
    if (invertLabel) {
      invertLabel.setAttribute('data-tip',
        '自动反色：按背景亮度取黑/白文字。\n' +
        '亮度 = (0.299×R + 0.587×G + 0.114×B) ÷ 255\n' +
        '大于 50% 用黑字，否则用白字\n' +
        '背景变化时文字色随之更新');
      bindTip(invertLabel);
    }

    function sync() {
      bgColor.disabled = !bgToggle.checked;
      bgHex.disabled = !bgToggle.checked;
      var textOn = textToggle.checked;
      // 自动反色与颜色控件互斥：勾选自动反色后颜色不可选；文字开关关时自动反色不可用
      var autoOn = textOn && autoInvertCb.checked;
      textColor.disabled = !textOn || autoOn;
      textHex.disabled = !textOn || autoOn;
      autoInvertCb.disabled = !textOn;
      fsRange.disabled = !fsToggle.checked;
    }

    function set(newStyle, newOverrides) {
      st = newStyle || {};
      ov = newOverrides || st;
      // 背景：优先按显式设置判定，未显式设置时按解析结果（默认黄底 → 开）
      var bgVal = (ov.bgColor !== undefined) ? ov.bgColor : st.bgColor;
      var bg = bgVal || '';
      bgToggle.checked = !!bg;
      bgColor.value = bg || '#ffeb3b';
      bgHex.value = bg;
      // 文字：三态 —— '#xxx' 自定义色 / null 自动反色 / 其余（undefined/'inherit'）保持原色
      var tcRaw = (ov.textColor !== undefined) ? ov.textColor : st.textColor;
      var tc = (typeof tcRaw === 'string' && tcRaw.charAt(0) === '#') ? tcRaw : '';
      var autoInvert = tcRaw === null;
      textToggle.checked = !!tc || autoInvert;
      textColor.value = tc || '#000000';
      textHex.value = tc;
      autoInvertCb.checked = autoInvert;
      // 字号：仅「显式设置过且 ≠ 1×」才勾选开关（1× 与继承等价，滑块数值始终显示解析结果）
      var fs = st.fontSize;
      var fsO = ov.fontSize;
      fsToggle.checked = fsO !== undefined && fsO !== null && StyleKit.clampFontSize(fsO) !== 1;
      fsRange.value = String(fs || 1);
      fsVal.textContent = (fs || 1).toFixed(1) + '×';
      // 字形（按实际效果显示）
      chipB.classList.toggle('on', st.bold === true);
      chipI.classList.toggle('on', st.italic === true);
      chipU.classList.toggle('on', st.underline === true);
      chipS.classList.toggle('on', st.strike === true);
      sync();
    }

    function read() {
      var out = {};
      // 背景：关 = 透明（写入空串，显式无背景）
      out.bgColor = bgToggle.checked ? (bgHex.value.trim() || '') : '';
      // 文字：勾选自动反色 → null（动态反色）；填色 → '#xxx'；关 = 不写入（保持页面原色）
      if (textToggle.checked) {
        if (autoInvertCb.checked) out.textColor = null;
        else if (textHex.value.trim()) out.textColor = textHex.value.trim();
      }
      // 字号：关 = 不写入（跟随默认）
      if (fsToggle.checked) out.fontSize = parseFloat(fsRange.value);
      if (chipB.classList.contains('on')) out.bold = true;
      if (chipI.classList.contains('on')) out.italic = true;
      if (chipU.classList.contains('on')) out.underline = true;
      if (chipS.classList.contains('on')) out.strike = true;
      return out;
    }

    bgToggle.addEventListener('change', function () {
      if (bgToggle.checked) {
        // 勾选背景但没填色：填充默认颜色，避免「开了背景却是透明的」
        if (!bgHex.value.trim()) {
          bgHex.value = defaultBg;
          bgColor.value = defaultBg;
        }
      } else {
        // 关掉背景时，若文字开着且是反色填充而来，清空让用户重选
        bgHex.value = '';
      }
      sync();
    });

    bgColor.addEventListener('input', function () { bgHex.value = bgColor.value; });
    bgHex.addEventListener('input', function () {
      var v = bgHex.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) bgColor.value = v;
    });

    textToggle.addEventListener('change', sync);
    autoInvertCb.addEventListener('change', function () {
      if (autoInvertCb.checked) {
        // 与自定义颜色互斥：勾选自动反色时清空颜色（颜色控件由 sync 置灰）
        textHex.value = '';
      }
      sync();
    });
    textColor.addEventListener('input', function () {
      textHex.value = textColor.value;
      // 手动选色时取消自动反色（互斥反向）
      if (autoInvertCb.checked) { autoInvertCb.checked = false; sync(); }
    });
    textHex.addEventListener('input', function () {
      var v = textHex.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) textColor.value = v;
      // 手动输入颜色时取消自动反色（互斥反向）
      if (v && autoInvertCb.checked) { autoInvertCb.checked = false; sync(); }
    });

    fsToggle.addEventListener('change', sync);
    fsRange.addEventListener('input', function () {
      var n = parseFloat(fsRange.value);
      fsVal.textContent = (Math.round(n * 100) / 100).toFixed(1) + '×';
    });

    chipB.addEventListener('click', function () { chipB.classList.toggle('on'); });
    chipI.addEventListener('click', function () { chipI.classList.toggle('on'); });
    chipU.addEventListener('click', function () { chipU.classList.toggle('on'); });
    chipS.addEventListener('click', function () { chipS.classList.toggle('on'); });

    set(st, overrides);
    return { read: read, set: set };
  }

  return {
    mountStyleEditor: mountStyleEditor
  };
})();
