/**
 * StyleEditor — 带开关的样式编辑器（背景 / 文字 / 字号 / 字形）
 *
 * 依赖：StyleKit（utils/style.js，需先引入）
 * 供 options 与 popup 共用，渲染到调用方提供的容器内。
 *
 * 语义：
 *   背景开关  开 = 自定义背景色；关 = 无背景（透明）
 *   文字开关  开 = 自定义文字色；关 = 不染色（保持页面原色）
 *             勾选开启时若未填色，自动填充基于背景的反色
 *   字号开关  开 = 自定义字号；关 = 默认字号
 *   字形 chips 独立开关
 *
 * read() 返回 overrides 对象：
 *   bgColor  ''（透明）或 '#rrggbb'；关 = ''
 *   textColor '#rrggbb'；关 = 不写入（undefined = 保持原色）
 *   fontSize  数值；关 = 不写入
 */
var StyleEditor = (function () {
  'use strict';

  var FIELDS = ['bgColor', 'textColor', 'fontSize', 'bold', 'italic', 'underline'];

  function mountStyleEditor(container, initialStyle) {
    if (!container) return { read: function () { return {}; }, set: function () {} };

    var st = initialStyle || {};

    container.innerHTML =
      '<div class="se-row"><span class="se-label">背景</span>' +
        '<input type="checkbox" class="se-toggle se-bg-toggle">' +
        '<input type="color" class="se-bg-color" value="#ffeb3b">' +
        '<input type="text" class="se-bg-hex" value="" maxlength="7" placeholder="无背景">' +
      '</div>' +
      '<div class="se-row"><span class="se-label">文字</span>' +
        '<input type="checkbox" class="se-toggle se-text-toggle">' +
        '<input type="color" class="se-text-color" value="#000000">' +
        '<input type="text" class="se-text-hex" value="" maxlength="7" placeholder="不设=原色">' +
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
      '</div>';

    var bgToggle = container.querySelector('.se-bg-toggle');
    var bgColor = container.querySelector('.se-bg-color');
    var bgHex = container.querySelector('.se-bg-hex');
    var textToggle = container.querySelector('.se-text-toggle');
    var textColor = container.querySelector('.se-text-color');
    var textHex = container.querySelector('.se-text-hex');
    var fsToggle = container.querySelector('.se-fs-toggle');
    var fsRange = container.querySelector('.se-font-size');
    var fsVal = container.querySelector('.se-fs-val');
    var chipB = container.querySelector('.se-chip.b');
    var chipI = container.querySelector('.se-chip.i');
    var chipU = container.querySelector('.se-chip.u');

    function sync() {
      bgColor.disabled = !bgToggle.checked;
      bgHex.disabled = !bgToggle.checked;
      textColor.disabled = !textToggle.checked;
      textHex.disabled = !textToggle.checked;
      fsRange.disabled = !fsToggle.checked;
    }

    /** 基于当前背景色取反色，用于勾选文字开关时的自动填充 */
    function contrastFor(hex) {
      var v = hex && hex.charAt(0) === '#' ? hex : bgHex.value;
      return StyleKit.contrastColor(v);
    }

    function set(newStyle) {
      st = newStyle || {};
      // 背景：有非空色值 = 开；空字符串（透明）或无 = 关
      var bg = st.bgColor || '';
      bgToggle.checked = !!bg;
      bgColor.value = bg || '#ffeb3b';
      bgHex.value = bg;
      // 文字：自定义色 = 开
      var tc = (typeof st.textColor === 'string' && st.textColor.charAt(0) === '#') ? st.textColor : '';
      textToggle.checked = !!tc;
      textColor.value = tc || '#000000';
      textHex.value = tc;
      // 字号：有显式值 = 开
      var fs = st.fontSize;
      fsToggle.checked = fs !== undefined && fs !== null;
      fsRange.value = String(fs || 1);
      fsVal.textContent = (fs || 1).toFixed(1) + '×';
      // 字形
      chipB.classList.toggle('on', st.bold === true);
      chipI.classList.toggle('on', st.italic === true);
      chipU.classList.toggle('on', st.underline === true);
      sync();
    }

    function read() {
      var out = {};
      // 背景：关 = 透明（写入空串，显式无背景）
      out.bgColor = bgToggle.checked ? (bgHex.value.trim() || '') : '';
      // 文字：关 = 不写入（保持页面原色）
      if (textToggle.checked && textHex.value.trim()) out.textColor = textHex.value.trim();
      // 字号：关 = 不写入（跟随默认）
      if (fsToggle.checked) out.fontSize = parseFloat(fsRange.value);
      if (chipB.classList.contains('on')) out.bold = true;
      if (chipI.classList.contains('on')) out.italic = true;
      if (chipU.classList.contains('on')) out.underline = true;
      return out;
    }

    bgToggle.addEventListener('change', function () {
      if (!bgToggle.checked) {
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

    textToggle.addEventListener('change', function () {
      if (textToggle.checked && !textHex.value.trim()) {
        // 勾选文字色但没填色：自动填充基于背景的反色
        var c = contrastFor(bgHex.value.trim());
        textHex.value = c;
        textColor.value = c;
      }
      sync();
    });
    textColor.addEventListener('input', function () { textHex.value = textColor.value; });
    textHex.addEventListener('input', function () {
      var v = textHex.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) textColor.value = v;
    });

    fsToggle.addEventListener('change', sync);
    fsRange.addEventListener('input', function () {
      var n = parseFloat(fsRange.value);
      fsVal.textContent = (Math.round(n * 100) / 100).toFixed(1) + '×';
    });

    chipB.addEventListener('click', function () { chipB.classList.toggle('on'); });
    chipI.addEventListener('click', function () { chipI.classList.toggle('on'); });
    chipU.addEventListener('click', function () { chipU.classList.toggle('on'); });

    set(st);
    return { read: read, set: set };
  }

  return {
    mountStyleEditor: mountStyleEditor
  };
})();
