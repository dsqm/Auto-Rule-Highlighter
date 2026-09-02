// 弹窗 / 设置页 / 内容脚本共用的轻量工具：匹配类型常量、HTML 转义、唯一 id
// 依赖：无。需在 style.js / style-editor.js / storage.js 之前引入（它们内部引用 CommonKit）
var CommonKit = (function () {
  'use strict';

  // 匹配类型：数组保持展示顺序，map 用于取中文标签（与 mountStyleBar 的按钮、各处徽章共用）
  var MATCH_TYPES = [
    ['contains', '包含'],
    ['exact', '精确'],
    ['regex', '正则'],
    ['wildcard', '通配']
  ];
  var TYPE_LABELS = {};
  for (var i = 0; i < MATCH_TYPES.length; i++) TYPE_LABELS[MATCH_TYPES[i][0]] = MATCH_TYPES[i][1];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getMatchTypeLabel(type) {
    return TYPE_LABELS[type] || '包含';
  }

  // 唯一 id：prefix（可选，如 'tmp_' / 's_'）+ 时间戳 36 进制 + 随机段（randomLen 默认 9）
  function uid(prefix, randomLen) {
    var n = randomLen == null ? 9 : randomLen;
    var id = Date.now().toString(36) + Math.random().toString(36).substr(2, n);
    return prefix ? prefix + id : id;
  }

  return {
    MATCH_TYPES: MATCH_TYPES,
    escapeHtml: escapeHtml,
    getMatchTypeLabel: getMatchTypeLabel,
    uid: uid
  };
})();