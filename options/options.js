document.addEventListener('DOMContentLoaded', async () => {
  const ruleList = document.getElementById('ruleList');
  const btnAddRule = document.getElementById('btnAddRule');
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const importFile = document.getElementById('importFile');
  const btnClearAll = document.getElementById('btnClearAll');
  var currentSettings = {};

  function setupModalClose(overlay) {
    let mouseDownTarget = null;
    overlay.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });
    overlay.addEventListener('mouseup', (e) => {
      if (e.target === overlay && mouseDownTarget === overlay) {
        overlay.remove();
      }
      mouseDownTarget = null;
    });
  }

  async function saveCurrentSettings() {
    var activeMt = document.querySelector('#settDefaultMatchTypeRow .match-type-btn.active');
    // 合并读取再写入，避免整体覆盖把 popup 维护的 tempHistory 等字段冲掉
    var current = await Storage.getSettings();
    var next = Object.assign({}, current, {
      showRail: document.getElementById('settShowRail').checked,
      historyEnabled: document.getElementById('settHistoryEnabled').checked,
      contextMenuEnabled: document.getElementById('settContextMenuEnabled').checked,
      openPopupOnAdd: document.getElementById('settOpenPopupOnAdd').checked,
      openPopupOnAddShortcut: document.getElementById('settOpenPopupOnAddShortcut').checked,
      spotContextMenuEnabled: document.getElementById('settSpotContextMenuEnabled').checked,
      openPopupOnSpot: document.getElementById('settOpenPopupOnSpot').checked,
      openPopupOnSpotShortcut: document.getElementById('settOpenPopupOnSpotShortcut').checked,
      defaultMatchType: activeMt ? activeMt.dataset.matchType : 'contains',
      defaultCaseSensitive: document.getElementById('settDefaultCaseSensitive').classList.contains('active'),
      defaultAcrossElements: document.getElementById('settDefaultAcrossElements').classList.contains('active'),
      stylePresets: stylePresets
    });
    await Storage.saveSettings(next);
    updateStorageInfo();
    // 全局默认样式（stylePresets[0]）变化需要通知所有页面重建高亮
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' }).catch(() => {});
  }

  const settings = await Storage.getSettings();
  currentSettings = settings;
  document.getElementById('settShowRail').checked = settings.showRail !== false;
  document.getElementById('settHistoryEnabled').checked = settings.historyEnabled !== false;

  document.getElementById('settContextMenuEnabled').checked = settings.contextMenuEnabled !== false;
  document.getElementById('settOpenPopupOnAdd').checked = settings.openPopupOnAdd !== false;
  document.getElementById('settOpenPopupOnAddShortcut').checked = settings.openPopupOnAddShortcut !== false;

  document.getElementById('settSpotContextMenuEnabled').checked = settings.spotContextMenuEnabled !== false;
  document.getElementById('settOpenPopupOnSpot').checked = settings.openPopupOnSpot !== false;
  document.getElementById('settOpenPopupOnSpotShortcut').checked = settings.openPopupOnSpotShortcut !== false;

  var defMatchType = settings.defaultMatchType || 'contains';
  var defCaseSensitive = settings.defaultCaseSensitive === true;
  var defAcrossElements = settings.defaultAcrossElements === true;

  var mtBtns = document.querySelectorAll('#settDefaultMatchTypeRow .match-type-btn');
  for (var mti = 0; mti < mtBtns.length; mti++) {
    mtBtns[mti].classList.toggle('active', mtBtns[mti].dataset.matchType === defMatchType);
  }
  document.getElementById('settDefaultCaseSensitive').classList.toggle('active', defCaseSensitive);
  document.getElementById('settDefaultAcrossElements').classList.toggle('active', defAcrossElements);

  // 预设列表：Storage.getSettings 已做旧格式迁移，这里再 normalize 以兼容直接导入的旧数据
  let stylePresets = StyleKit.normalizePresets(settings.stylePresets || settings.colorPresets);

  const colorPresetsContainer = document.getElementById('colorPresetsContainer');
  const btnAddPreset = document.getElementById('btnAddPreset');
  const btnResetPresets = document.getElementById('btnResetPresets');

  renderStylePresets();

  async function updateStorageInfo() {
    try {
      var info = await Storage.getStorageInfo();
      var usedKB = (info.bytesUsed / 1024).toFixed(1);
      var maxKB = (info.maxBytes / 1024).toFixed(0);
      var pct = Math.min(100, (info.bytesUsed / info.maxBytes) * 100);
      var bar = document.getElementById('storageBar');
      var text = document.getElementById('storageText');
      if (bar) bar.style.width = pct.toFixed(1) + '%';
      bar.classList.remove('warn', 'danger');
      if (pct > 90) bar.classList.add('danger');
      else if (pct > 70) bar.classList.add('warn');
      var modeLabel = info.isLocal ? '（本地存储）' : '（可云同步存储）';
      if (text) text.innerHTML = '已使用 <span>' + usedKB + ' KB</span> / 上限 <span>' + maxKB + ' KB</span>' + modeLabel;
    } catch (e) {
      var text2 = document.getElementById('storageText');
      if (text2) text2.textContent = '无法获取存储信息';
    }
  }

  updateStorageInfo();

  function showConfirmPopup(x, y, onConfirm) {
    removeConfirmPopups();
    var popup = document.createElement('div');
    popup.className = 'confirm-popup';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.innerHTML = '<p>确定删除此颜色预设？</p><div class="confirm-actions"><button class="btn btn-sm" data-cf="cancel">取消</button><button class="btn btn-sm btn-danger" data-cf="confirm">删除</button></div>';
    document.body.appendChild(popup);
    popup.addEventListener('click', function(e) {
      if (e.target.dataset.cf === 'confirm') { popup.remove(); onConfirm(); }
      if (e.target.dataset.cf === 'cancel') { popup.remove(); }
    });
    document.addEventListener('click', function rm(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', rm); }
    });
  }

  function removeConfirmPopups() {
    document.querySelectorAll('.confirm-popup').forEach(function(p) { p.remove(); });
  }

  // ---- 统一样式编辑器（与临时高亮同一套，带开关），实现在 utils/style-editor.js ----
  var mountStyleEditor = StyleEditor.mountStyleEditor;

  // ---- 样式预设管理（设置页） ----

  function renderStylePresets() {
    colorPresetsContainer.innerHTML = '';
    var dragIndex = null;
    stylePresets.forEach(function (p, i) {
      const block = document.createElement('div');
      block.className = 'style-preset-block';
      block.draggable = true;
      const preview = document.createElement('span');
      StyleKit.renderPresetDot(preview, p, 28);
      block.appendChild(preview);
      const editBtn = document.createElement('span');
      editBtn.className = 'preset-edit';
      editBtn.textContent = '✎';
      editBtn.title = '编辑样式';
      const delBtn = document.createElement('span');
      delBtn.className = 'preset-del';
      delBtn.textContent = '×';
      delBtn.title = '删除';
      block.appendChild(editBtn);
      block.appendChild(delBtn);

      block.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.target === delBtn) {
          var rect = delBtn.getBoundingClientRect();
          showConfirmPopup(rect.left - 60, rect.bottom + 4, function () {
            if (stylePresets.length <= 1) { showToast('至少保留一个样式预设'); return; }
            stylePresets.splice(i, 1);
            renderStylePresets();
            saveCurrentSettings();
          });
          return;
        }
        if (e.target === editBtn) { openStylePresetEditor(i); return; }
        openStylePresetEditor(i);
      });

      block.addEventListener('dragstart', function () { dragIndex = i; block.classList.add('dragging'); });
      block.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (dragIndex === null || dragIndex === i) return;
        block.classList.add('drag-over');
      });
      block.addEventListener('dragleave', function () { block.classList.remove('drag-over'); });
      block.addEventListener('drop', function (e) {
        e.preventDefault();
        block.classList.remove('drag-over');
        if (dragIndex === null || dragIndex === i) return;
        var from = dragIndex, to = i;
        dragIndex = null;
        var item = stylePresets.splice(from, 1)[0];
        stylePresets.splice(to, 0, item);
        renderStylePresets();
        saveCurrentSettings();
      });
      block.addEventListener('dragend', function () {
        block.classList.remove('dragging');
        dragIndex = null;
      });

      colorPresetsContainer.appendChild(block);
    });
  }

  function openStylePresetEditor(index) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '400';
    overlay.innerHTML = `
      <div class="modal" style="width:420px;">
        <h3>编辑样式预设</h3>
        <div id="presetEditorBody"></div>
        <div class="modal-actions">
          <button class="btn" id="presetEditCancel">取消</button>
          <button class="btn btn-primary" id="presetEditSave">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    setupModalClose(overlay);
    var editor = mountStyleEditor(overlay.querySelector('#presetEditorBody'), stylePresets[index], undefined, { bgColor: (stylePresets[0] || {}).bgColor });
    overlay.querySelector('#presetEditCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#presetEditSave').addEventListener('click', function () {
      var saved = editor.read();
      saved.id = stylePresets[index].id || saved.id;
      stylePresets[index] = saved;
      renderStylePresets();
      saveCurrentSettings();
      overlay.remove();
      showToast('样式预设已保存');
    });
  }

  btnAddPreset.addEventListener('click', function () {
    if (stylePresets.length >= 26) { showToast('最多支持 26 个样式预设'); return; }
    // 新预设从全局默认复制一份，用户在此基础上改
    stylePresets.push(StyleKit.cloneStyle(stylePresets[0]));
    renderStylePresets();
    openStylePresetEditor(stylePresets.length - 1);
  });

  btnResetPresets.addEventListener('click', function () {
    if (confirm('确定恢复默认样式预设？当前预设将被替换。')) {
      stylePresets = StyleKit.getDefaultPresets();
      renderStylePresets();
      saveCurrentSettings();
      showToast('样式预设已恢复默认');
    }
  });

  loadRules();

  btnAddRule.addEventListener('click', () => showAddRuleModal());

  document.getElementById('settShowRail').addEventListener('change', async () => {
    await saveCurrentSettings();
    notifyRulesChanged();
  });

  document.getElementById('settHistoryEnabled').addEventListener('change', async () => {
    await saveCurrentSettings();
  });

  document.getElementById('settContextMenuEnabled').addEventListener('change', async function () {
    await saveCurrentSettings();
  });
  document.getElementById('settOpenPopupOnAdd').addEventListener('change', async function () {
    await saveCurrentSettings();
  });
  document.getElementById('settOpenPopupOnAddShortcut').addEventListener('change', async function () {
    await saveCurrentSettings();
  });

  document.getElementById('settSpotContextMenuEnabled').addEventListener('change', async function () {
    await saveCurrentSettings();
  });
  document.getElementById('settOpenPopupOnSpot').addEventListener('change', async function () {
    await saveCurrentSettings();
  });
  document.getElementById('settOpenPopupOnSpotShortcut').addEventListener('change', async function () {
    await saveCurrentSettings();
  });

  var settMtBtns = document.querySelectorAll('#settDefaultMatchTypeRow .match-type-btn');
  for (var smti = 0; smti < settMtBtns.length; smti++) {
    settMtBtns[smti].addEventListener('click', async function () {
      for (var j = 0; j < settMtBtns.length; j++) {
        settMtBtns[j].classList.remove('active');
      }
      this.classList.add('active');
      defMatchType = this.dataset.matchType;
      await saveCurrentSettings();
    });
  }
  document.getElementById('settDefaultCaseSensitive').addEventListener('click', async function () {
    this.classList.toggle('active');
    defCaseSensitive = this.classList.contains('active');
    await saveCurrentSettings();
  });
  document.getElementById('settDefaultAcrossElements').addEventListener('click', async function () {
    this.classList.toggle('active');
    defAcrossElements = this.classList.contains('active');
    await saveCurrentSettings();
  });

  btnExport.addEventListener('click', async () => {
    const rules = await Storage.getRules();
    const settings = await Storage.getSettings();
    const data = JSON.stringify({ rules, settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-rule-highlighter-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('数据已导出');
  });

  btnImport.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.rules) await Storage.saveRules(data.rules);
      if (data.settings) await Storage.saveSettings(data.settings);
      notifyRulesChanged();
      showToast('数据已导入');
      location.reload();
    } catch (err) {
      showToast('导入失败：文件格式错误');
    }
  });

  btnClearAll.addEventListener('click', async () => {
    if (!confirm('确定要清空所有规则和设置？此操作不可恢复。')) return;
    await Storage.saveRules([]);
    await Storage.saveSettings(Storage.defaultSettings);
    notifyRulesChanged();
    showToast('数据已清空');
    location.reload();
  });

  async function loadRules() {
    const rules = await Storage.getRules();
    renderRules(rules);
  }

  /** 关键词行的预览块在模板串里只是占位符（带 data-style），插入 DOM 后统一渲染 */
  function hydrateKwPreviews(container) {
    var els = container.querySelectorAll('.kw-preview[data-style]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var parsed;
      try { parsed = JSON.parse(el.dataset.style); } catch (e) { parsed = null; }
      if (parsed) StyleKit.renderPreview(el, StyleKit.makeStyle(parsed), 26, 18);
    }
  }

  function renderRules(rules) {
    if (rules.length === 0) {
      ruleList.innerHTML = '<div class="empty"><p>暂无网站规则</p><p>点击「添加规则」为网站创建高亮规则</p></div>';
      return;
    }

    ruleList.innerHTML = rules.map((rule, idx) => {
      const dimmed = !rule.enabled ? 'opacity:0.5;' : '';
      const kwCount = (rule.keywords || []).length;
      return `
      <div class="rule-card" data-rule-id="${rule.id}" data-rule-index="${idx}" draggable="true" style="${dimmed}">
        <div class="rule-header">
          <span class="drag-handle" data-drag="rule" title="拖动排序">☰</span>
          <label class="toggle" title="启用规则" style="margin-right:8px;">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-action="toggle-rule" data-rule-id="${rule.id}">
            <span class="slider"></span>
          </label>
          <span class="rule-url" title="${CommonKit.escapeHtml(rule.urlPattern)}">${CommonKit.escapeHtml(rule.name || rule.urlPattern)}</span>
          ${rule.name ? '<span style="font-size:10px;color:#bbb;">(' + CommonKit.escapeHtml(rule.urlPattern) + ')</span>' : ''}
          <span class="rule-match-type">${CommonKit.getMatchTypeLabel(rule.urlMatchType)}</span>
          <span style="font-size:11px;color:#999;">${kwCount} 个关键词</span>
          <div class="rule-actions">
            <button class="btn btn-sm" data-action="manage-keywords" data-rule-id="${rule.id}">管理关键词</button>
            <button class="btn btn-sm" data-action="edit-rule" data-rule-id="${rule.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-action="delete-rule" data-rule-id="${rule.id}" ${rule.enabled ? 'disabled' : ''} title="${rule.enabled ? '请先关闭规则再删除' : '删除规则'}">删除</button>
          </div>
        </div>
      </div>`;
    }).join('');

    setupRuleDragDrop();
  }

  ruleList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const ruleId = btn.dataset.ruleId;

    switch (action) {
      case 'manage-keywords':
        showKeywordManager(ruleId);
        break;
      case 'edit-rule':
        showEditRuleModal(ruleId);
        break;
      case 'delete-rule':
        if (confirm('确定删除此规则？')) {
          await Storage.deleteRule(ruleId);
          notifyRulesChanged();
          loadRules();
        }
        break;
    }
  });

  ruleList.addEventListener('change', async (e) => {
    if (e.target.dataset.action === 'toggle-rule') {
      await Storage.updateRule(e.target.dataset.ruleId, { enabled: e.target.checked });
      notifyRulesChanged();
      loadRules();
    }
  });

  function showAddRuleModal() {
    showRuleModal('添加网站规则', { name: '', urlPattern: '', urlMatchType: 'contains' }, async (data) => {
      if (!data.urlPattern.trim()) return;
      const rule = await Storage.addRule({
        name: data.name.trim(),
        urlPattern: data.urlPattern.trim(),
        urlMatchType: data.urlMatchType
      });
      notifyRulesChanged();
      loadRules();
      showKeywordManager(rule.id);
    });
  }

  async function showEditRuleModal(ruleId) {
    const rules = await Storage.getRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    showRuleModal('编辑网站规则', {
      name: rule.name || '',
      urlPattern: rule.urlPattern,
      urlMatchType: rule.urlMatchType
    }, async (data) => {
      if (!data.urlPattern.trim()) return;
      await Storage.updateRule(ruleId, {
        name: data.name.trim(),
        urlPattern: data.urlPattern.trim(),
        urlMatchType: data.urlMatchType
      });
      notifyRulesChanged();
      loadRules();
    });
  }

  function showRuleModal(title, data, onSave) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        <div class="form-group">
          <label>规则名称（可选）</label>
          <input type="text" id="modalRuleName" value="${CommonKit.escapeHtml(data.name)}" placeholder="例如: GitHub">
        </div>
        <div class="form-group">
          <label>URL 匹配规则</label>
          <input type="text" id="modalUrlPattern" value="${CommonKit.escapeHtml(data.urlPattern)}" placeholder="例如: github.com">
        </div>
        <div class="form-group">
          <label>匹配方式</label>
          <select id="modalUrlMatchType">
            <option value="contains" ${data.urlMatchType === 'contains' ? 'selected' : ''}>包含</option>
            <option value="exact" ${data.urlMatchType === 'exact' ? 'selected' : ''}>精确匹配</option>
            <option value="regex" ${data.urlMatchType === 'regex' ? 'selected' : ''}>正则表达式</option>
            <option value="wildcard" ${data.urlMatchType === 'wildcard' ? 'selected' : ''}>通配符</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn" id="modalCancel">取消</button>
          <button class="btn btn-primary" id="modalSave">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modalCancel').addEventListener('click', () => overlay.remove());
    setupModalClose(overlay);
    overlay.querySelector('#modalSave').addEventListener('click', () => {
      onSave({
        name: overlay.querySelector('#modalRuleName').value,
        urlPattern: overlay.querySelector('#modalUrlPattern').value,
        urlMatchType: overlay.querySelector('#modalUrlMatchType').value
      });
      overlay.remove();
    });
  }

  async function showKeywordManager(ruleId) {
    const rules = await Storage.getRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const displayName = rule.name || rule.urlPattern;

    overlay.innerHTML = `
      <div class="modal" style="width:640px;">
        <h3>管理关键词 — ${CommonKit.escapeHtml(displayName)}</h3>
        <div class="form-group">
          <label>新增关键词</label>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
            <input type="text" id="kwName" placeholder="名称（可选）" style="width:90px;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
            <input type="text" id="kwText" placeholder="输入关键词" style="flex:1;min-width:120px;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
            <button class="btn btn-primary btn-sm" id="kwAddBtn">添加</button>
          </div>
          <!-- 共享样式选项栏（mountStyleBar）：匹配类型 + Aa/↔ + 右边栏/独占 + 当前样式方块 + 预设圆 -->
          <div id="kwStyleBar"></div>
        </div>
        <div style="margin-bottom:8px;font-size:12px;color:#999;">已有 <span id="kwCountBadge">${(rule.keywords || []).length}</span> 个关键词</div>
        <div id="kwListContainer" style="max-height:360px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:4px;padding:4px 8px;"></div>
        <div class="modal-actions">
          <button class="btn" id="modalCancel">取消</button>
          <button class="btn btn-primary" id="modalConfirm">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 共享样式选项栏（与 popup 搜索区同组件）——匹配类型 / Aa / ↔ / 右边栏 / 独占 / 当前样式方块 / 预设圆
    var kwStyleBar = StyleEditor.mountStyleBar(overlay.querySelector('#kwStyleBar'), {
      presets: stylePresets,
      settings: currentSettings,
      matchType: defMatchType,
      caseSensitive: defCaseSensitive,
      acrossElements: defAcrossElements,
      showRail: true,
      showExtra: true,
      onEditStyle: openNewKwStyleModal
    });

    function renderKeywordList() {
      Storage.getRules().then(freshRules => {
        const freshRule = freshRules.find(r => r.id === ruleId);
        if (!freshRule) return;
        const keywords = freshRule.keywords || [];
        const badge = overlay.querySelector('#kwCountBadge');
        if (badge) badge.textContent = keywords.length;

        const container = overlay.querySelector('#kwListContainer');
        if (!container) return;

        if (keywords.length === 0) {
          container.innerHTML = '<div style="text-align:center;padding:16px;color:#bbb;font-size:12px;">暂无关键词</div>';
          return;
        }

        container.innerHTML = keywords.map((kw, idx) => `
          <div style="display:flex;align-items:center;padding:6px 0;gap:6px;border-bottom:1px solid #f5f5f5;${kw.enabled ? '' : 'opacity:0.5;'}" data-kw-id="${kw.id}" data-kw-index="${idx}">
            <span class="drag-handle" data-drag="kw" title="拖动排序" draggable="true">☰</span>
            <button class="kw-move-btn" data-kw-move-up="${idx}" ${idx === 0 ? 'disabled' : ''} title="上移">▲</button>
            <button class="kw-move-btn" data-kw-move-down="${idx}" ${idx === keywords.length - 1 ? 'disabled' : ''} title="下移">▼</button>
            <span class="kw-preview" data-style="${CommonKit.escapeHtml(JSON.stringify(StyleKit.resolveStyle(kw, currentSettings)))}"></span>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${CommonKit.escapeHtml(kw.text)}">${CommonKit.escapeHtml(kw.name || kw.text)}</span>
            <span style="font-size:10px;color:#999;background:#f5f5f5;padding:1px 5px;border-radius:3px;">${CommonKit.getMatchTypeLabel(kw.matchType)}</span>
            ${kw.caseSensitive ? '<span style="font-size:10px;color:#fa8c16;font-weight:600;">Aa</span>' : ''}
            ${kw.acrossElements ? '<span style="font-size:10px;color:#1890ff;font-weight:600;">↔</span>' : ''}
            ${kw.showRail !== false ? '<span style="font-size:10px;color:#52c41a;">📍</span>' : ''}
            ${kw.exclusive ? '<span style="font-size:10px;" title="匹配后独占高亮：出现后隐藏其他关键词">⭐</span>' : ''}
            <label style="font-size:10px;display:flex;align-items:center;gap:2px;cursor:pointer;">
              <input type="checkbox" ${kw.enabled ? 'checked' : ''} data-kw-toggle="${kw.id}" style="width:auto;">
              启用
            </label>
            <button class="btn btn-sm" data-kw-edit="${kw.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-kw-del="${kw.id}">删除</button>
          </div>
        `).join('');

        hydrateKwPreviews(container);
        setupKwDragDrop(overlay, ruleId);
      });
    }

    renderKeywordList();

    // 自定义样式：与临时高亮同款交互 —— 弹窗内编辑完整样式（组件 state.style 为当前样式）
    function openNewKwStyleModal() {
      const overlay2 = document.createElement('div');
      overlay2.className = 'modal-overlay';
      overlay2.style.zIndex = '300';
      overlay2.innerHTML = `
        <div class="modal" style="width:420px;">
          <h3>自定义关键词样式</h3>
          <div id="newKwStyleBody"></div>
          <div class="modal-actions">
            <button class="btn" id="newKwStyleCancel">取消</button>
            <button class="btn btn-primary" id="newKwStyleSave">确定</button>
          </div>
        </div>`;
      document.body.appendChild(overlay2);
      var curStyle = kwStyleBar.getState().style;
      // 样式编辑弹窗不支持点击外部关闭：调色/调字号时误点灰底会直接丢改动，必须显式取消/确定
      var ed = mountStyleEditor(overlay2.querySelector('#newKwStyleBody'), StyleKit.resolveStyle(curStyle, currentSettings), StyleKit.keywordOverrides(curStyle), { bgColor: (stylePresets[0] || {}).bgColor });
      overlay2.querySelector('#newKwStyleCancel').addEventListener('click', function () { overlay2.remove(); });
      overlay2.querySelector('#newKwStyleSave').addEventListener('click', function () {
        kwStyleBar.setState({ style: ed.read() });
        overlay2.remove();
      });
    }

    const kwTextEl = overlay.querySelector('#kwText');
    const kwAddBtn = overlay.querySelector('#kwAddBtn');

    async function doAddKeyword() {
      const text = kwTextEl.value.trim();
      if (!text) return;
      const nameVal = overlay.querySelector('#kwName').value.trim();
      const st = kwStyleBar.getState();
      await Storage.addKeyword(ruleId, {
        text: text,
        name: nameVal || '',
        matchType: st.matchType,
        color: st.style.bgColor,
        textColor: st.style.textColor,
        fontSize: st.style.fontSize,
        bold: st.style.bold,
        italic: st.style.italic,
        underline: st.style.underline,
        strike: st.style.strike,
        caseSensitive: st.caseSensitive,
        acrossElements: st.acrossElements,
        showRail: st.showRail,
        exclusive: st.exclusive
      });
      kwTextEl.value = '';
      overlay.querySelector('#kwName').value = '';
      // 添加后样式复位到全局默认，避免连续添加时沿用上一次的样式
      kwStyleBar.setState({ style: {} });
      notifyRulesChanged();
      renderKeywordList();
    }

    kwAddBtn.addEventListener('click', doAddKeyword);
    kwTextEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddKeyword(); });

    overlay.querySelector('#modalCancel').addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('#modalConfirm').addEventListener('click', () => { overlay.remove(); });

    overlay.addEventListener('click', async (e) => {
      const toggleEl = e.target.closest('[data-kw-toggle]');
      if (toggleEl) {
        const kwId = toggleEl.dataset.kwToggle;
        await Storage.updateKeyword(ruleId, kwId, { enabled: toggleEl.checked });
        notifyRulesChanged();
        renderKeywordList();
        return;
      }

      const delBtn = e.target.closest('[data-kw-del]');
      if (delBtn) {
        const kwId = delBtn.dataset.kwDel;
        await Storage.deleteKeyword(ruleId, kwId);
        notifyRulesChanged();
        renderKeywordList();
        return;
      }

      const editBtn = e.target.closest('[data-kw-edit]');
      if (editBtn) {
        const kwId = editBtn.dataset.kwEdit;
        const freshRules = await Storage.getRules();
        const freshRule = freshRules.find(r => r.id === ruleId);
        if (!freshRule) return;
        const kw = freshRule.keywords.find(k => k.id === kwId);
        if (!kw) return;
        showKeywordEditForm(ruleId, kw, () => {
          notifyRulesChanged();
          renderKeywordList();
        });
      }
    });
  }

  function showKeywordEditForm(ruleId, kw, onSaveDone) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '200';

    overlay.innerHTML = `
      <div class="modal" style="width:440px;">
        <h3>编辑关键词</h3>
        <div class="form-group">
          <label>名称（可选，显示在图标菜单中）</label>
          <input type="text" id="editKwName" value="${CommonKit.escapeHtml(kw.name || '')}" placeholder="留空则显示关键词原文" style="width:100%;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
        </div>
        <div class="form-group">
          <label>关键词</label>
          <input type="text" id="editKwText" value="${CommonKit.escapeHtml(kw.text)}" placeholder="输入关键词" style="width:100%;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
        </div>
        <div class="form-group">
          <label>匹配方式与样式</label>
          <!-- 共享样式选项栏（mountStyleBar）：匹配类型 + Aa/↔ + 右边栏/独占 + 当前样式方块 + 预设圆 -->
          <div id="editKwStyleBar"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="editKwCancel">取消</button>
          <button class="btn btn-primary" id="editKwSave">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 共享样式选项栏（与 popup 搜索区同组件）
    var editStyleBar = StyleEditor.mountStyleBar(overlay.querySelector('#editKwStyleBar'), {
      presets: stylePresets,
      settings: currentSettings,
      matchType: kw.matchType,
      caseSensitive: kw.caseSensitive === true,
      acrossElements: kw.acrossElements === true,
      showRail: kw.showRail !== false,
      exclusive: kw.exclusive === true,
      currentStyle: StyleKit.keywordOverrides(kw),
      showExtra: true,
      onEditStyle: openEditStyleModal
    });

    // 自定义样式：弹窗编辑完整样式（与新增/临时高亮同一套编辑器）
    function openEditStyleModal() {
      const overlay2 = document.createElement('div');
      overlay2.className = 'modal-overlay';
      overlay2.style.zIndex = '300';
      overlay2.innerHTML = `
        <div class="modal" style="width:420px;">
          <h3>自定义关键词样式</h3>
          <div id="editKwStyleBody"></div>
          <div class="modal-actions">
            <button class="btn" id="editStyleCancel">取消</button>
            <button class="btn btn-primary" id="editStyleSave">确定</button>
          </div>
        </div>`;
      document.body.appendChild(overlay2);
      var curStyle = editStyleBar.getState().style;
      // 样式编辑弹窗不支持点击外部关闭：调色/调字号时误点灰底会直接丢改动，必须显式取消/确定
      var ed = mountStyleEditor(overlay2.querySelector('#editKwStyleBody'), StyleKit.resolveStyle(curStyle, currentSettings), StyleKit.keywordOverrides(curStyle), { bgColor: (stylePresets[0] || {}).bgColor });
      overlay2.querySelector('#editStyleCancel').addEventListener('click', function () { overlay2.remove(); });
      overlay2.querySelector('#editStyleSave').addEventListener('click', function () {
        editStyleBar.setState({ style: ed.read() });
        overlay2.remove();
      });
    }

    overlay.querySelector('#editKwCancel').addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('#editKwSave').addEventListener('click', async () => {
      const st = editStyleBar.getState();
      await Storage.updateKeyword(ruleId, kw.id, {
        name: overlay.querySelector('#editKwName').value.trim(),
        text: overlay.querySelector('#editKwText').value.trim(),
        matchType: st.matchType,
        color: st.style.bgColor,
        textColor: st.style.textColor,
        fontSize: st.style.fontSize,
        bold: st.style.bold,
        italic: st.style.italic,
        underline: st.style.underline,
        strike: st.style.strike,
        caseSensitive: st.caseSensitive,
        acrossElements: st.acrossElements,
        showRail: st.showRail,
        exclusive: st.exclusive
      });
      overlay.remove();
      if (onSaveDone) onSaveDone();
    });
  }

  function notifyRulesChanged() {
    chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(() => {});
  }

  function setupKwDragDrop(overlay, ruleId) {
    const container = overlay.querySelector('#kwListContainer');
    if (!container || container._ahKwDragSetup) return;
    container._ahKwDragSetup = true;
    let draggedEl = null;
    let draggedIdx = -1;

    const onDragStart = (e) => {
      if (!e.target.closest('[data-drag="kw"]')) return;
      const row = e.target.closest('[data-kw-id]');
      if (!row) return;
      draggedEl = row;
      draggedIdx = parseInt(row.dataset.kwIndex);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };

    const onDragEnd = () => {
      if (draggedEl) draggedEl.classList.remove('dragging');
      container.querySelectorAll('[data-kw-id]').forEach(r => r.classList.remove('drag-over'));
      draggedEl = null;
      draggedIdx = -1;
    };

    const onDragOver = (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-kw-id]');
      if (!row || row === draggedEl) return;
      row.classList.add('drag-over');
    };

    const onDragLeave = (e) => {
      const row = e.target.closest('[data-kw-id]');
      if (row) row.classList.remove('drag-over');
    };

    const onDrop = async (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-kw-id]');
      if (!row || row === draggedEl) return;
      const targetIdx = parseInt(row.dataset.kwIndex);
      if (isNaN(targetIdx) || targetIdx === draggedIdx) return;

      await moveKeyword(ruleId, draggedIdx, targetIdx);
    };

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragend', onDragEnd);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);

    container.addEventListener('click', async (e) => {
      const upBtn = e.target.closest('[data-kw-move-up]');
      if (upBtn && !upBtn.disabled) {
        const idx = parseInt(upBtn.dataset.kwMoveUp);
        await moveKeyword(ruleId, idx, idx - 1);
        return;
      }
      const downBtn = e.target.closest('[data-kw-move-down]');
      if (downBtn && !downBtn.disabled) {
        const idx = parseInt(downBtn.dataset.kwMoveDown);
        await moveKeyword(ruleId, idx, idx + 1);
        return;
      }
    });
  }

  async function moveKeyword(ruleId, fromIdx, toIdx) {
    const rules = await Storage.getRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule || !rule.keywords) return;
    const keywords = rule.keywords;
    if (fromIdx < 0 || fromIdx >= keywords.length || toIdx < 0 || toIdx >= keywords.length) return;
    const [moved] = keywords.splice(fromIdx, 1);
    keywords.splice(toIdx, 0, moved);
    await Storage.saveRules(rules);
    notifyRulesChanged();
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
      const badge = overlay.querySelector('#kwCountBadge');
      if (badge) badge.textContent = keywords.length;
      const container = overlay.querySelector('#kwListContainer');
      if (container) {
        container.querySelectorAll('[data-kw-id]').forEach(r => r.classList.remove('drag-over'));
        const freshKeywords = keywords.map((kw, idx) => `
          <div style="display:flex;align-items:center;padding:6px 0;gap:6px;border-bottom:1px solid #f5f5f5;${kw.enabled ? '' : 'opacity:0.5;'}" data-kw-id="${kw.id}" data-kw-index="${idx}">
            <span class="drag-handle" data-drag="kw" title="拖动排序" draggable="true">☰</span>
            <button class="kw-move-btn" data-kw-move-up="${idx}" ${idx === 0 ? 'disabled' : ''} title="上移">▲</button>
            <button class="kw-move-btn" data-kw-move-down="${idx}" ${idx === keywords.length - 1 ? 'disabled' : ''} title="下移">▼</button>
            <span class="kw-preview" data-style="${CommonKit.escapeHtml(JSON.stringify(StyleKit.resolveStyle(kw, currentSettings)))}"></span>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${CommonKit.escapeHtml(kw.text)}">${CommonKit.escapeHtml(kw.name || kw.text)}</span>
            <span style="font-size:10px;color:#999;background:#f5f5f5;padding:1px 5px;border-radius:3px;">${CommonKit.getMatchTypeLabel(kw.matchType)}</span>
            ${kw.caseSensitive ? '<span style="font-size:10px;color:#fa8c16;font-weight:600;">Aa</span>' : ''}
            ${kw.acrossElements ? '<span style="font-size:10px;color:#1890ff;font-weight:600;">↔</span>' : ''}
            ${kw.showRail !== false ? '<span style="font-size:10px;color:#52c41a;">📍</span>' : ''}
            ${kw.exclusive ? '<span style="font-size:10px;" title="匹配后独占高亮：出现后隐藏其他关键词">⭐</span>' : ''}
            <label style="font-size:10px;display:flex;align-items:center;gap:2px;cursor:pointer;">
              <input type="checkbox" ${kw.enabled ? 'checked' : ''} data-kw-toggle="${kw.id}" style="width:auto;">
              启用
            </label>
            <button class="btn btn-sm" data-kw-edit="${kw.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-kw-del="${kw.id}">删除</button>
          </div>
        `).join('');
        container.innerHTML = freshKeywords;
        hydrateKwPreviews(container);
        setupKwDragDrop(overlay, ruleId);
      }
    }
  }

  function setupRuleDragDrop() {
    if (ruleList._ahRuleDragSetup) return;
    ruleList._ahRuleDragSetup = true;
    let draggedEl = null;
    let draggedIdx = -1;

    ruleList.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.rule-card');
      if (!card) return;
      draggedEl = card;
      draggedIdx = parseInt(card.dataset.ruleIndex);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    ruleList.addEventListener('dragend', (e) => {
      if (draggedEl) draggedEl.classList.remove('dragging');
      document.querySelectorAll('.rule-card').forEach(c => c.classList.remove('drag-over'));
      draggedEl = null;
      draggedIdx = -1;
    });

    ruleList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const card = e.target.closest('.rule-card');
      if (!card || card === draggedEl) return;
      card.classList.add('drag-over');
    });

    ruleList.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.rule-card');
      if (card) card.classList.remove('drag-over');
    });

    ruleList.addEventListener('drop', async (e) => {
      e.preventDefault();
      const card = e.target.closest('.rule-card');
      if (!card || card === draggedEl) return;
      const targetIdx = parseInt(card.dataset.ruleIndex);
      if (isNaN(targetIdx) || targetIdx === draggedIdx) return;

      const rules = await Storage.getRules();
      const [moved] = rules.splice(draggedIdx, 1);
      rules.splice(targetIdx, 0, moved);
      await Storage.saveRules(rules);
      notifyRulesChanged();
      renderRules(rules);
    });
  }
});

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
