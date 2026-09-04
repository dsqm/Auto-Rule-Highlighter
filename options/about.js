// 关于页：动态填充扩展信息（版本号等读取自 manifest.json）
(function () {
  'use strict';

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function init() {
    var manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest()
      : null;

    var version = (manifest && manifest.version) || '';
    setText('ext-version', version ? 'v' + version : '');

    var name = (manifest && manifest.name) || '';
    if (name) setText('ext-name', name);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
