document.addEventListener('DOMContentLoaded', async () => {
  const ruleList = document.getElementById('ruleList');
  const btnAddRule = document.getElementById('btnAddRule');
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const importFile = document.getElementById('importFile');
  const btnClearAll = document.getElementById('btnClearAll');

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
    await Storage.saveSettings({
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
      colorPresets: colorPresets
    });
    updateStorageInfo();
  }

  const settings = await Storage.getSettings();
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

  let colorPresets = Array.isArray(settings.colorPresets) ? settings.colorPresets.slice() : Storage.defaultSettings.colorPresets.slice();

  const colorPresetsContainer = document.getElementById('colorPresetsContainer');
  const btnAddPreset = document.getElementById('btnAddPreset');
  const btnResetPresets = document.getElementById('btnResetPresets');

  renderColorPresets();

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

  function openColorEditor(oldColor, callback) {
    var input = document.createElement('input');
    input.type = 'color';
    input.style.position = 'absolute';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.value = oldColor;
    input.click();
    input.addEventListener('change', function() {
      callback(input.value);
      input.remove();
    });
    input.addEventListener('blur', function() { setTimeout(function() { if (input.parentNode) input.remove(); }, 200); });
  }

  function renderColorPresets() {
    colorPresetsContainer.innerHTML = '';
    for (let i = 0; i < colorPresets.length; i++) {
      const c = colorPresets[i];
      const block = document.createElement('span');
      block.className = 'preset-color-block';
      block.style.backgroundColor = c;
      block.title = c + ' — 点击修改颜色';
      const del = document.createElement('span');
      del.className = 'preset-del';
      del.textContent = '×';
      del.title = '删除';
      block.appendChild(del);
      block.addEventListener('click', function(e) {
        e.stopPropagation();
        if (e.target === del) {
          var rect = del.getBoundingClientRect();
          showConfirmPopup(rect.left - 60, rect.bottom + 4, function() {
            colorPresets.splice(i, 1);
            renderColorPresets();
            saveCurrentSettings();
          });
          return;
        }
        openColorEditor(c, function(newColor) {
          colorPresets[i] = newColor;
          renderColorPresets();
          saveCurrentSettings();
        });
      });
      colorPresetsContainer.appendChild(block);
    }
  }

  btnAddPreset.addEventListener('click', function() {
    if (colorPresets.length >= 20) { showToast('最多支持 20 个颜色预设'); return; }
    openColorEditor('#ffeb3b', function(newColor) {
      if (colorPresets.indexOf(newColor) < 0) {
        colorPresets.push(newColor);
        renderColorPresets();
        saveCurrentSettings();
      }
    });
  });

  btnResetPresets.addEventListener('click', function() {
    if (confirm('确定恢复默认颜色预设？当前预设将被替换。')) {
      colorPresets = Storage.defaultSettings.colorPresets.slice();
      renderColorPresets();
      saveCurrentSettings();
      showToast('颜色预设已恢复默认');
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getMatchTypeLabel(type) {
    const labels = { contains: '包含', exact: '精确', regex: '正则', wildcard: '通配' };
    return labels[type] || '包含';
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
          <span class="rule-url" title="${escapeHtml(rule.urlPattern)}">${escapeHtml(rule.name || rule.urlPattern)}</span>
          ${rule.name ? '<span style="font-size:10px;color:#bbb;">(' + escapeHtml(rule.urlPattern) + ')</span>' : ''}
          <span class="rule-match-type">${getMatchTypeLabel(rule.urlMatchType)}</span>
          <span style="font-size:11px;color:#999;">${kwCount} 个关键词</span>
          <div class="rule-actions">
            <button class="btn btn-sm" data-action="manage-keywords" data-rule-id="${rule.id}">管理关键词</button>
            <button class="btn btn-sm" data-action="edit-rule" data-rule-id="${rule.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-action="delete-rule" data-rule-id="${rule.id}">删除</button>
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
          <input type="text" id="modalRuleName" value="${escapeHtml(data.name)}" placeholder="例如: GitHub">
        </div>
        <div class="form-group">
          <label>URL 匹配规则</label>
          <input type="text" id="modalUrlPattern" value="${escapeHtml(data.urlPattern)}" placeholder="例如: github.com">
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
        <h3>管理关键词 — ${escapeHtml(displayName)}</h3>
        <div class="form-group">
          <label>新增关键词</label>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="kwName" placeholder="名称（可选）" style="width:90px;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
            <input type="text" id="kwText" placeholder="输入关键词" style="flex:1;min-width:120px;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
            <select id="kwMatchType" style="padding:5px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;">
              <option value="contains">包含</option>
              <option value="exact">精确</option>
              <option value="regex">正则</option>
              <option value="wildcard">通配</option>
            </select>
            <input type="color" id="kwColor" value="#ffeb3b" style="width:36px;height:30px;padding:1px;cursor:pointer;border:1px solid #d9d9d9;border-radius:4px;">
            <div id="kwPresetsRow" style="display:flex;gap:4px;align-items:center;"></div>
            <button class="toggle-opt-btn" id="kwCaseSensitive" title="区分大小写" type="button">Aa</button>
            <button class="toggle-opt-btn across" id="kwAcrossElements" title="跨元素匹配" type="button">↔</button>
            <label style="font-size:11px;display:flex;align-items:center;gap:2px;white-space:nowrap;"><input type="checkbox" id="kwShowRail" checked> 右边栏</label>
            <label style="font-size:11px;display:flex;align-items:center;gap:2px;white-space:nowrap;"><input type="checkbox" id="kwExclusive"> ⭐独占高亮</label>
            <button class="btn btn-primary btn-sm" id="kwAddBtn">添加</button>
          </div>
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
    var kwMgrSel = overlay.querySelector('#kwMatchType');
    if (kwMgrSel) kwMgrSel.value = defMatchType;
    var kwMgrCase = overlay.querySelector('#kwCaseSensitive');
    if (kwMgrCase) kwMgrCase.classList.toggle('active', defCaseSensitive);
    var kwMgrAcross = overlay.querySelector('#kwAcrossElements');
    if (kwMgrAcross) kwMgrAcross.classList.toggle('active', defAcrossElements);

    overlay.querySelector('#kwCaseSensitive').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('active');
    });
    overlay.querySelector('#kwAcrossElements').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('active');
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
            <span style="width:10px;height:10px;border-radius:50%;background:${kw.color || '#ffeb3b'};flex-shrink:0;"></span>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(kw.text)}">${escapeHtml(kw.name || kw.text)}</span>
            <span style="font-size:10px;color:#999;background:#f5f5f5;padding:1px 5px;border-radius:3px;">${getMatchTypeLabel(kw.matchType)}</span>
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

        setupKwDragDrop(overlay, ruleId);
      });
    }

    renderKeywordList();

    function renderKwPresets() {
      var row = overlay.querySelector('#kwPresetsRow');
      if (!row) return;
      row.innerHTML = '';
      var presets = colorPresets;
      for (var pi = 0; pi < presets.length; pi++) {
        (function(pc) {
          var dot = document.createElement('span');
          dot.className = 'kw-preset-dot';
          dot.style.backgroundColor = pc;
          dot.title = pc;
          dot.addEventListener('click', function() {
            var colorInput = overlay.querySelector('#kwColor');
            if (colorInput) colorInput.value = pc;
          });
          row.appendChild(dot);
        })(presets[pi]);
      }
    }
    renderKwPresets();

    const kwTextEl = overlay.querySelector('#kwText');
    const kwAddBtn = overlay.querySelector('#kwAddBtn');

    async function doAddKeyword() {
      const text = kwTextEl.value.trim();
      if (!text) return;
      const nameVal = overlay.querySelector('#kwName').value.trim();
      await Storage.addKeyword(ruleId, {
        text: text,
        name: nameVal || '',
        matchType: overlay.querySelector('#kwMatchType').value,
        color: overlay.querySelector('#kwColor').value,
        caseSensitive: overlay.querySelector('#kwCaseSensitive').classList.contains('active'),
        acrossElements: overlay.querySelector('#kwAcrossElements').classList.contains('active'),
        showRail: overlay.querySelector('#kwShowRail').checked,
        exclusive: overlay.querySelector('#kwExclusive').checked
      });
      kwTextEl.value = '';
      overlay.querySelector('#kwName').value = '';
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
          <input type="text" id="editKwName" value="${escapeHtml(kw.name || '')}" placeholder="留空则显示关键词原文" style="width:100%;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
        </div>
        <div class="form-group">
          <label>关键词</label>
          <input type="text" id="editKwText" value="${escapeHtml(kw.text)}" placeholder="输入关键词" style="width:100%;padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;">
        </div>
        <div class="form-group">
          <label>匹配方式</label>
          <select id="editKwMatchType">
            <option value="contains" ${kw.matchType === 'contains' ? 'selected' : ''}>包含</option>
            <option value="exact" ${kw.matchType === 'exact' ? 'selected' : ''}>精确匹配</option>
            <option value="regex" ${kw.matchType === 'regex' ? 'selected' : ''}>正则表达式</option>
            <option value="wildcard" ${kw.matchType === 'wildcard' ? 'selected' : ''}>通配符</option>
          </select>
        </div>
        <div class="form-group">
          <label>高亮颜色</label>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input type="color" class="color-input" id="editKwColor" value="${kw.color || '#ffeb3b'}">
            <div id="editKwColorPresets" style="display:flex;gap:4px;flex-wrap:wrap;"></div>
          </div>
        </div>
        <div class="form-group">
          <div class="checkbox-row">
            <button class="toggle-opt-btn" id="editKwCaseSensitive" type="button">Aa</button>
            <label for="editKwCaseSensitive" style="font-size:12px;">区分大小写</label>
          </div>
        </div>
        <div class="form-group">
          <div class="checkbox-row">
            <button class="toggle-opt-btn across" id="editKwAcrossElements" type="button">↔</button>
            <label for="editKwAcrossElements" style="font-size:12px;">跨元素匹配</label>
          </div>
        </div>
        <div class="form-group">
          <div class="checkbox-row">
            <input type="checkbox" id="editKwShowRail" ${kw.showRail !== false ? 'checked' : ''}>
            <label for="editKwShowRail">显示右边栏标记</label>
          </div>
        </div>
        <div class="form-group">
          <div class="checkbox-row">
            <input type="checkbox" id="editKwExclusive" ${kw.exclusive ? 'checked' : ''}>
            <label for="editKwExclusive">⭐ 匹配后独占高亮（出现后隐藏其他关键词的高亮）</label>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="editKwCancel">取消</button>
          <button class="btn btn-primary" id="editKwSave">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#editKwCaseSensitive').classList.toggle('active', kw.caseSensitive === true);
    overlay.querySelector('#editKwAcrossElements').classList.toggle('active', kw.acrossElements === true);

    var editPresetsContainer = overlay.querySelector('#editKwColorPresets');
    if (editPresetsContainer) {
      for (var epi = 0; epi < colorPresets.length; epi++) {
        (function(pc) {
          var dot = document.createElement('span');
          dot.className = 'kw-preset-dot';
          dot.style.backgroundColor = pc;
          dot.title = pc;
          dot.addEventListener('click', function() {
            var colorInput = overlay.querySelector('#editKwColor');
            if (colorInput) colorInput.value = pc;
          });
          editPresetsContainer.appendChild(dot);
        })(colorPresets[epi]);
      }
    }

    overlay.querySelector('#editKwCaseSensitive').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('active');
    });
    overlay.querySelector('#editKwAcrossElements').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('active');
    });

    overlay.querySelector('#editKwCancel').addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('#editKwSave').addEventListener('click', async () => {
      await Storage.updateKeyword(ruleId, kw.id, {
        name: overlay.querySelector('#editKwName').value.trim(),
        text: overlay.querySelector('#editKwText').value.trim(),
        matchType: overlay.querySelector('#editKwMatchType').value,
        color: overlay.querySelector('#editKwColor').value,
        caseSensitive: overlay.querySelector('#editKwCaseSensitive').classList.contains('active'),
        acrossElements: overlay.querySelector('#editKwAcrossElements').classList.contains('active'),
        showRail: overlay.querySelector('#editKwShowRail').checked,
        exclusive: overlay.querySelector('#editKwExclusive').checked
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
            <span style="width:10px;height:10px;border-radius:50%;background:${kw.color || '#ffeb3b'};flex-shrink:0;"></span>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(kw.text)}">${escapeHtml(kw.name || kw.text)}</span>
            <span style="font-size:10px;color:#999;background:#f5f5f5;padding:1px 5px;border-radius:3px;">${getMatchTypeLabel(kw.matchType)}</span>
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
