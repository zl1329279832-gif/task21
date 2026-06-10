/**
 * 政务表单低代码配置系统 - 设计器 (Designer)
 * Drag-and-drop canvas, field palette, property panel
 */
(function () {
  'use strict';
  var FB = window.FormBuilder;

  function $(sel, parent) { return (parent || document).querySelector(sel); }
  function $$(sel, parent) { return Array.prototype.slice.call((parent || document).querySelectorAll(sel)); }

  FB.Designer = function () {
    this.template = null;
    this.selectedFieldId = null;
    this.undoManager = new FB.UndoManager();
    this._dragData = null;
    this._init();
  };

  FB.Designer.prototype = {
    _init: function () {
      var self = this;
      this.canvas = $('#designer-canvas');
      this.canvasFields = $('#canvas-fields');
      this.emptyHint = $('#canvas-empty-hint');
      this.propPanel = $('#property-panel');
      this.propEmpty = $('#prop-empty');
      this.propContent = $('#prop-content');
      this.palette = $('#field-palette');
      this.btnUndo = $('#btn-undo');
      this.btnRedo = $('#btn-redo');

      this._bindPaletteDrag();
      this._bindCanvasDrop();
      this._bindToolbar();
      this._bindKeyboard();

      this.undoManager._onChange = function (canUndo, canRedo) {
        self.btnUndo.disabled = !canUndo;
        self.btnRedo.disabled = !canRedo;
      };

      this.template = {
        id: FB.util.uid(),
        name: '新表单模板',
        version: 0,
        fields: [],
        createdAt: FB.util.now(),
        updatedAt: FB.util.now()
      };
      $('#template-name').value = this.template.name;
      this._render();
    },

    /* ---- Load existing template ---- */
    loadTemplate: function (tpl) {
      this.template = FB.util.deepClone(tpl);
      $('#template-name').value = this.template.name;
      this.selectedFieldId = null;
      this.undoManager.clear();
      this._render();
      this._renderPropertyPanel();
    },

    /* ---- Toolbar ---- */
    _bindToolbar: function () {
      var self = this;
      $('#template-name').addEventListener('input', function (e) {
        self.template.name = e.target.value;
      });

      $('#btn-save-draft').addEventListener('click', function () {
        self.template.updatedAt = FB.util.now();
        FB.storage.saveTemplateDraft(self.template);
        FB.App.toast('草稿已保存', 'success');
      });

      $('#btn-publish').addEventListener('click', function () { self._publish(); });
      this.btnUndo.addEventListener('click', function () { self._undo(); });
      this.btnRedo.addEventListener('click', function () { self._redo(); });
    },

    _publish: function () {
      if (!this.template.name.trim()) {
        FB.App.toast('请输入模板名称', 'error');
        return;
      }
      if (this.template.fields.length === 0) {
        FB.App.toast('请至少添加一个字段', 'error');
        return;
      }
      var cycles = FB.logic.detectCycles(this.template.fields);
      if (cycles.length > 0) {
        FB.App.toast('发现联动条件循环依赖，请检查', 'error');
        return;
      }

      // Check for previous versions — two-phase publish
      var versions = FB.storage.getTemplateVersions(this.template.id);
      if (versions.length === 0) {
        // First publish — no migration needed
        this._doPublish();
        return;
      }

      var lastVersion = versions[versions.length - 1];
      var diffReport = FB.migration.diff(lastVersion, this.template);

      if (!FB.migration.hasChanges(diffReport)) {
        this._doPublish();
        return;
      }

      // Has changes — show migration preview
      this._showMigrationPreview(diffReport, lastVersion);
    },

    _doPublish: function (migrationRuleSet) {
      this.template.updatedAt = FB.util.now();
      var published = FB.storage.publishTemplate(this.template, migrationRuleSet);
      this.undoManager.markBoundary('publish v' + published.version);
      FB.App.toast('模板已发布 (v' + published.version + ')', 'success');
      FB.App.refreshTemplateSelects();
    },

    _showMigrationPreview: function (diffReport, oldTemplate) {
      var self = this;
      var body = document.createElement('div');
      body.className = 'migration-preview';

      // Generate default rules
      var defaultRules = FB.migration.generateDefaultRules(diffReport, oldTemplate, this.template);
      var currentRules = FB.util.deepClone(defaultRules);

      // Local undo for rule editing
      var ruleUndoStack = [];
      var ruleRedoStack = [];
      var pushRuleUndo = function () {
        ruleUndoStack.push(FB.util.deepClone(currentRules.rules));
        ruleRedoStack = [];
      };

      // === Section 1: Change Summary ===
      var summarySection = document.createElement('div');
      summarySection.className = 'migration-section';
      summarySection.innerHTML = '<h4>变更摘要</h4>';
      var cards = document.createElement('div');
      cards.className = 'migration-summary-cards';
      var categories = [
        { key: 'added', label: '新增', count: diffReport.added.length },
        { key: 'deleted', label: '删除', count: diffReport.deleted.length },
        { key: 'renamed', label: '重命名', count: diffReport.renamed.length },
        { key: 'typeChanged', label: '类型变更', cls: 'type-changed', count: diffReport.typeChanged.length },
        { key: 'optionsChanged', label: '选项变更', cls: 'options-changed', count: diffReport.optionsChanged.length },
        { key: 'conditionsChanged', label: '条件变更', cls: 'conditions-changed', count: diffReport.conditionsChanged.length }
      ];
      for (var ci = 0; ci < categories.length; ci++) {
        if (categories[ci].count > 0) {
          var card = document.createElement('div');
          card.className = 'summary-card ' + (categories[ci].cls || categories[ci].key);
          card.textContent = categories[ci].label + ' ' + categories[ci].count + ' 个字段';
          cards.appendChild(card);
        }
      }
      summarySection.appendChild(cards);
      body.appendChild(summarySection);

      // === Section 2: Detailed Changes ===
      var detailSection = document.createElement('div');
      detailSection.className = 'migration-section';
      detailSection.innerHTML = '<h4>详细变更</h4>';
      detailSection.appendChild(this._renderDiffDetails(diffReport));
      body.appendChild(detailSection);

      // === Section 3: Data Impact ===
      var impactSection = document.createElement('div');
      impactSection.className = 'migration-section';
      impactSection.innerHTML = '<h4>数据影响预估</h4>';
      var allData = FB.storage.getFormDataAll(this.template.id);
      var affectedCount = 0;
      for (var di = 0; di < allData.length; di++) {
        if ((allData[di].data._templateVersion || 0) < (oldTemplate.version || 0) + 1) affectedCount++;
      }
      var impactInfo = document.createElement('div');
      impactInfo.innerHTML = '<span class="impact-badge">受影响的历史记录: ' + affectedCount + ' 条</span>';
      impactSection.appendChild(impactInfo);
      body.appendChild(impactSection);

      // === Section 4: Migration Rules Editor ===
      var rulesSection = document.createElement('div');
      rulesSection.className = 'migration-section';
      rulesSection.innerHTML = '<h4>迁移映射规则</h4>';
      var rulesContainer = document.createElement('div');
      rulesContainer.className = 'migration-rules-editor';
      rulesSection.appendChild(rulesContainer);
      body.appendChild(rulesSection);

      var renderRules = function () {
        self._renderRulesEditor(rulesContainer, currentRules, oldTemplate, function () {
          pushRuleUndo();
          renderRules();
        });
      };
      renderRules();

      // Modal keyboard handler for rule undo/redo
      var keyHandler = function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          if (ruleUndoStack.length > 0) {
            e.preventDefault();
            ruleRedoStack.push(FB.util.deepClone(currentRules.rules));
            currentRules.rules = ruleUndoStack.pop();
            renderRules();
          }
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          if (ruleRedoStack.length > 0) {
            e.preventDefault();
            ruleUndoStack.push(FB.util.deepClone(currentRules.rules));
            currentRules.rules = ruleRedoStack.pop();
            renderRules();
          }
        }
      };
      document.addEventListener('keydown', keyHandler);

      FB.App.showModal('发布影响评估 (v' + oldTemplate.version + ' → v' + (oldTemplate.version + 1) + ')', body, [
        {
          label: '发布并应用迁移规则',
          cls: 'btn-primary',
          action: function () {
            document.removeEventListener('keydown', keyHandler);
            self._executePublishWithMigration(currentRules, oldTemplate);
          }
        },
        {
          label: '发布不迁移',
          cls: 'btn-secondary',
          action: function () {
            document.removeEventListener('keydown', keyHandler);
            FB.App.hideModal();
            self._doPublish();
          }
        },
        {
          label: '取消',
          cls: 'btn-secondary',
          action: function () {
            document.removeEventListener('keydown', keyHandler);
            FB.App.hideModal();
          }
        }
      ]);
    },

    _renderDiffDetails: function (diffReport) {
      var container = document.createElement('div');
      var sections = [
        { key: 'added', title: '新增字段', items: diffReport.added, render: function (item) { return item.field.label + ' (' + item.field.type + ')'; } },
        { key: 'deleted', title: '删除字段', items: diffReport.deleted, render: function (item) { return item.field.label + ' (' + item.field.type + ')'; } },
        { key: 'renamed', title: '重命名', items: diffReport.renamed, render: function (item) { return item.oldLabel + ' → ' + item.newLabel; } },
        { key: 'typeChanged', title: '类型变更', items: diffReport.typeChanged, render: function (item) { return item.label + ': ' + item.oldType + ' → ' + item.newType; } },
        { key: 'optionsChanged', title: '选项变更', items: diffReport.optionsChanged, render: function (item) {
          var parts = [];
          if (item.addedOpts.length) parts.push('+' + item.addedOpts.length + '项');
          if (item.removedOpts.length) parts.push('-' + item.removedOpts.length + '项');
          if (item.renamedOpts.length) parts.push('改名' + item.renamedOpts.length + '项');
          return item.label + ': ' + parts.join(', ');
        }},
        { key: 'conditionsChanged', title: '条件变更', items: diffReport.conditionsChanged, render: function (item) {
          return item.label + ': ' + item.oldConditions.length + '条 → ' + item.newConditions.length + '条';
        }}
      ];

      for (var si = 0; si < sections.length; si++) {
        var sec = sections[si];
        if (sec.items.length === 0) continue;

        var group = document.createElement('div');
        group.className = 'change-detail-group';

        var header = document.createElement('div');
        header.className = 'change-detail-header';
        header.innerHTML = '<span>▶</span> ' + sec.title + ' (' + sec.items.length + ')';
        group.appendChild(header);

        var body = document.createElement('div');
        body.className = 'change-detail-body';
        body.style.display = 'none';
        for (var ii = 0; ii < sec.items.length; ii++) {
          var item = document.createElement('div');
          item.className = 'change-detail-item';
          item.textContent = sec.render(sec.items[ii]);
          body.appendChild(item);
        }
        group.appendChild(body);

        (function (h, b) {
          h.addEventListener('click', function () {
            var open = b.style.display !== 'none';
            b.style.display = open ? 'none' : 'block';
            h.querySelector('span').textContent = open ? '▶' : '▼';
          });
        })(header, body);

        container.appendChild(group);
      }
      return container;
    },

    _renderRulesEditor: function (container, ruleSet, oldTemplate, onChanged) {
      var self = this;
      container.innerHTML = '';
      var rules = ruleSet.rules || [];

      if (rules.length === 0) {
        container.innerHTML = '<div style="color:#999;font-size:12px;padding:8px;">无迁移规则</div>';
      }

      for (var i = 0; i < rules.length; i++) {
        (function (idx) {
          var rule = rules[idx];
          var row = document.createElement('div');
          row.className = 'migration-rule-row';

          var badge = document.createElement('span');
          badge.className = 'rule-type-badge ' + self._getRuleTypeBadgeCls(rule.type);
          badge.textContent = self._getRuleTypeLabel(rule.type);
          row.appendChild(badge);

          var desc = document.createElement('span');
          desc.className = 'rule-desc';
          desc.textContent = self._getRuleDescription(rule, oldTemplate);
          row.appendChild(desc);

          var removeBtn = document.createElement('button');
          removeBtn.className = 'btn-remove-option btn-remove-rule';
          removeBtn.textContent = '✕';
          removeBtn.addEventListener('click', function () {
            rules.splice(idx, 1);
            onChanged();
          });
          row.appendChild(removeBtn);

          container.appendChild(row);
        })(i);
      }

      // Add rule button
      var addBtn = document.createElement('button');
      addBtn.className = 'btn-add-rule';
      addBtn.textContent = '+ 添加规则';
      addBtn.addEventListener('click', function () {
        self._showAddRuleForm(container, ruleSet, oldTemplate, onChanged);
      });
      container.appendChild(addBtn);
    },

    _showAddRuleForm: function (container, ruleSet, oldTemplate, onChanged) {
      var existing = container.querySelector('.add-rule-form');
      if (existing) { existing.remove(); return; }

      var self = this;
      var form = document.createElement('div');
      form.className = 'add-rule-form';

      // Build field options from old and new template
      var oldFields = [];
      var newFields = [];
      var collectFields = function (fields, arr) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (!f._deleted && f.type !== 'group') arr.push(f);
          if (f.type === 'group' && f.children) collectFields(f.children, arr);
        }
      };
      collectFields(oldTemplate.fields, oldFields);
      collectFields(this.template.fields, newFields);

      var typeSelect = document.createElement('select');
      var types = [
        ['fieldMap', '字段映射'], ['merge', '字段合并'], ['enumRename', '枚举重命名'],
        ['preserveAttachment', '附件保留'], ['softDelete', '软删除']
      ];
      for (var ti = 0; ti < types.length; ti++) {
        var opt = document.createElement('option');
        opt.value = types[ti][0];
        opt.textContent = types[ti][1];
        typeSelect.appendChild(opt);
      }
      form.appendChild(typeSelect);

      var paramsDiv = document.createElement('div');
      paramsDiv.style.cssText = 'margin-top:6px;';
      form.appendChild(paramsDiv);

      var renderParams = function () {
        paramsDiv.innerHTML = '';
        var type = typeSelect.value;

        if (type === 'fieldMap') {
          paramsDiv.innerHTML =
            '<label style="font-size:11px;">源字段:</label> ' +
            '<select data-param="source">' + oldFields.map(function (f) { return '<option value="' + f.id + '">' + FB.util.escapeHtml(f.label) + '</option>'; }).join('') + '</select> ' +
            '<label style="font-size:11px;">目标字段:</label> ' +
            '<select data-param="target">' + newFields.map(function (f) { return '<option value="' + f.id + '">' + FB.util.escapeHtml(f.label) + '</option>'; }).join('') + '</select> ' +
            '<label style="font-size:11px;">转换:</label> ' +
            '<select data-param="transform"><option value="">无</option><option value="toString">转文本</option><option value="toNumber">转数字</option></select>';
        } else if (type === 'merge') {
          paramsDiv.innerHTML =
            '<label style="font-size:11px;">源字段(多选):</label><br>' +
            oldFields.map(function (f) {
              return '<label style="font-size:11px;margin-right:8px;"><input type="checkbox" data-merge-source value="' + f.id + '"> ' + FB.util.escapeHtml(f.label) + '</label>';
            }).join('') +
            '<br><label style="font-size:11px;">目标字段:</label> ' +
            '<select data-param="target">' + newFields.map(function (f) { return '<option value="' + f.id + '">' + FB.util.escapeHtml(f.label) + '</option>'; }).join('') + '</select> ' +
            '<label style="font-size:11px;">分隔符:</label> <input data-param="separator" value="; " style="width:40px;">';
        } else if (type === 'enumRename') {
          var enumFields = oldFields.filter(function (f) { return f.type === 'radio' || f.type === 'checkbox'; });
          paramsDiv.innerHTML =
            '<label style="font-size:11px;">字段:</label> ' +
            '<select data-param="fieldId">' + enumFields.map(function (f) { return '<option value="' + f.id + '">' + FB.util.escapeHtml(f.label) + '</option>'; }).join('') + '</select>' +
            '<div data-mapping-area style="margin-top:4px;"></div>';
        } else if (type === 'preserveAttachment' || type === 'softDelete') {
          paramsDiv.innerHTML =
            '<label style="font-size:11px;">字段:</label> ' +
            '<select data-param="fieldId">' + oldFields.map(function (f) { return '<option value="' + f.id + '">' + FB.util.escapeHtml(f.label) + '</option>'; }).join('') + '</select>';
        }
      };
      typeSelect.addEventListener('change', renderParams);
      renderParams();

      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn btn-primary';
      confirmBtn.style.cssText = 'margin-top:6px;font-size:12px;';
      confirmBtn.textContent = '添加';
      confirmBtn.addEventListener('click', function () {
        var type = typeSelect.value;
        var newRule = { type: type };

        if (type === 'fieldMap') {
          newRule.sourceField = paramsDiv.querySelector('[data-param="source"]').value;
          newRule.targetField = paramsDiv.querySelector('[data-param="target"]').value;
          newRule.transform = paramsDiv.querySelector('[data-param="transform"]').value || null;
        } else if (type === 'merge') {
          var checked = paramsDiv.querySelectorAll('[data-merge-source]:checked');
          newRule.sourceFields = [];
          for (var ci = 0; ci < checked.length; ci++) newRule.sourceFields.push(checked[ci].value);
          newRule.targetField = paramsDiv.querySelector('[data-param="target"]').value;
          newRule.separator = paramsDiv.querySelector('[data-param="separator"]').value || '; ';
        } else if (type === 'enumRename') {
          newRule.fieldId = paramsDiv.querySelector('[data-param="fieldId"]').value;
          newRule.mappings = [];
        } else if (type === 'preserveAttachment' || type === 'softDelete') {
          newRule.fieldId = paramsDiv.querySelector('[data-param="fieldId"]').value;
          if (type === 'softDelete') newRule.reason = '手动添加';
        }

        ruleSet.rules.push(newRule);
        onChanged();
      });
      form.appendChild(confirmBtn);

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.style.cssText = 'margin-top:6px;margin-left:4px;font-size:12px;';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', function () { form.remove(); });
      form.appendChild(cancelBtn);

      // Insert before the add button
      var addBtnEl = container.querySelector('.btn-add-rule');
      container.insertBefore(form, addBtnEl);
    },

    _getRuleTypeBadgeCls: function (type) {
      var map = { fieldMap: 'map', merge: 'merge', enumRename: 'enum', preserveAttachment: 'attach', softDelete: 'softdel' };
      return map[type] || '';
    },

    _getRuleTypeLabel: function (type) {
      var map = { fieldMap: '映射', merge: '合并', enumRename: '枚举', preserveAttachment: '附件', softDelete: '软删' };
      return map[type] || type;
    },

    _getRuleDescription: function (rule, oldTemplate) {
      var findLabel = function (fields, id) {
        for (var i = 0; i < fields.length; i++) {
          if (fields[i].id === id) return fields[i].label;
          if (fields[i].children) { var r = findLabel(fields[i].children, id); if (r) return r; }
          if (fields[i].subFields) { var s = findLabel(fields[i].subFields, id); if (s) return s; }
        }
        return id ? id.slice(0, 8) + '...' : '?';
      };
      var oldFields = oldTemplate.fields;
      var newFields = this.template.fields;

      switch (rule.type) {
        case 'fieldMap':
          return findLabel(oldFields, rule.sourceField) + ' → ' + findLabel(newFields, rule.targetField) +
            (rule.transform ? ' (' + rule.transform + ')' : '');
        case 'merge':
          return (rule.sourceFields || []).map(function (id) { return findLabel(oldFields, id); }).join(' + ') +
            ' → ' + findLabel(newFields, rule.targetField);
        case 'enumRename':
          return findLabel(oldFields, rule.fieldId) + ': ' + (rule.mappings || []).length + ' 项映射';
        case 'preserveAttachment':
          return '保留附件: ' + findLabel(oldFields, rule.fieldId);
        case 'softDelete':
          return '软删除: ' + findLabel(oldFields, rule.fieldId);
        default:
          return rule.type;
      }
    },

    _executePublishWithMigration: function (ruleSet, oldTemplate) {
      var validation = FB.migration.validateRules(ruleSet, oldTemplate, this.template);
      if (!validation.valid) {
        FB.App.toast('规则校验失败: ' + validation.errors[0], 'error');
        return;
      }
      FB.App.hideModal();
      this._doPublish(ruleSet);
    },

    _undo: function () {
      var prev = this.undoManager.undo(this.template.fields);
      if (!prev) return;
      if (prev._crossedBoundary) {
        if (!confirm('即将撤销到发布点之前的状态（' + prev._label + '），是否继续？')) return;
        prev = this.undoManager.popBoundary(this.template.fields);
        if (!prev) return;
      }
      this.template.fields = prev;
      this.selectedFieldId = null;
      this._render();
      this._renderPropertyPanel();
    },

    _redo: function () {
      var next = this.undoManager.redo(this.template.fields);
      if (next) {
        this.template.fields = next;
        this.selectedFieldId = null;
        this._render();
        this._renderPropertyPanel();
      }
    },

    /* ---- Keyboard shortcuts ---- */
    _bindKeyboard: function () {
      var self = this;
      document.addEventListener('keydown', function (e) {
        if (!$('#tab-designer').classList.contains('active')) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          self._undo();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          self._redo();
        }
        if (e.key === 'Delete' && self.selectedFieldId &&
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA') {
          self._deleteField(self.selectedFieldId);
        }
      });
    },

    /* ---- Palette drag ---- */
    _bindPaletteDrag: function () {
      var self = this;
      $$('.palette-item', this.palette).forEach(function (item) {
        item.addEventListener('dragstart', function (e) {
          self._dragData = { type: item.dataset.type, source: 'palette' };
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', item.dataset.type);
        });
        item.addEventListener('dragend', function () {
          item.classList.remove('dragging');
          self._dragData = null;
          self._clearDropIndicators();
        });
      });
    },

    /* ---- Canvas drop handling ---- */
    _bindCanvasDrop: function () {
      var self = this;

      this.canvas.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = self._dragData && self._dragData.source === 'palette' ? 'copy' : 'move';
        self.canvas.classList.add('drag-over');
        self._updateDropIndicator(e.clientY);
      });

      this.canvas.addEventListener('dragleave', function (e) {
        if (!self.canvas.contains(e.relatedTarget)) {
          self.canvas.classList.remove('drag-over');
          self._clearDropIndicators();
        }
      });

      this.canvas.addEventListener('drop', function (e) {
        e.preventDefault();
        self.canvas.classList.remove('drag-over');
        self._clearDropIndicators();

        if (!self._dragData) return;
        var insertIndex = self._getInsertIndex(e.clientY);

        if (self._dragData.source === 'palette') {
          self._saveUndoState();
          var newField = FB.createField(self._dragData.type);
          self.template.fields.splice(insertIndex, 0, newField);
          self.selectedFieldId = newField.id;
        } else if (self._dragData.source === 'canvas') {
          self._saveUndoState();
          var fromIndex = -1;
          for (var i = 0; i < self.template.fields.length; i++) {
            if (self.template.fields[i].id === self._dragData.fieldId) { fromIndex = i; break; }
          }
          if (fromIndex >= 0) {
            var moved = self.template.fields.splice(fromIndex, 1)[0];
            var adjustedIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
            self.template.fields.splice(adjustedIndex, 0, moved);
          }
        }
        self._dragData = null;
        self._render();
        self._renderPropertyPanel();
      });

      // Click to select
      this.canvasFields.addEventListener('click', function (e) {
        var fieldEl = e.target.closest('.canvas-field');
        if (fieldEl) {
          self.selectedFieldId = fieldEl.dataset.fieldId;
          self._updateSelection();
          self._renderPropertyPanel();
        } else {
          self.selectedFieldId = null;
          self._updateSelection();
          self._renderPropertyPanel();
        }
      });
    },

    _getInsertIndex: function (clientY) {
      var items = $$('.canvas-field', this.canvasFields);
      for (var i = 0; i < items.length; i++) {
        var rect = items[i].getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        if (clientY < mid) return i;
      }
      return items.length;
    },

    _updateDropIndicator: function (clientY) {
      this._clearDropIndicators();
      var items = $$('.canvas-field', this.canvasFields);
      var insertIdx = this._getInsertIndex(clientY);
      var ind = document.createElement('div');
      ind.className = 'drop-indicator';
      if (items.length === 0) {
        this.canvasFields.appendChild(ind);
      } else if (insertIdx === 0) {
        this.canvasFields.insertBefore(ind, items[0]);
      } else if (insertIdx >= items.length) {
        this.canvasFields.appendChild(ind);
      } else {
        this.canvasFields.insertBefore(ind, items[insertIdx]);
      }
    },

    _clearDropIndicators: function () {
      $$('.drop-indicator', this.canvas).forEach(function (el) { el.remove(); });
    },

    /* ---- Render canvas fields ---- */
    _render: function () {
      var self = this;
      this.canvasFields.innerHTML = '';
      var activeFields = this.template.fields.filter(function (f) { return !f._deleted; });
      this.emptyHint.style.display = activeFields.length === 0 ? 'block' : 'none';

      var total = activeFields.length;
      var VIRTUAL_THRESHOLD = 100;

      if (total > VIRTUAL_THRESHOLD) {
        this._renderVirtual(activeFields);
        return;
      }

      activeFields.forEach(function (field, index) {
        self.canvasFields.appendChild(self._createCanvasFieldEl(field, index));
      });
      this._updateSelection();
    },

    _renderVirtual: function (fields) {
      var self = this;
      var chunkSize = 50;
      var container = this.canvasFields;
      var rendered = 0;

      var renderChunk = function () {
        var fragment = document.createDocumentFragment();
        var end = Math.min(rendered + chunkSize, fields.length);
        for (var i = rendered; i < end; i++) {
          fragment.appendChild(self._createCanvasFieldEl(fields[i], i));
        }
        container.appendChild(fragment);
        rendered = end;
      };

      renderChunk();
      this.canvas.addEventListener('scroll', function () {
        var st = self.canvas.scrollTop;
        var sh = self.canvas.scrollHeight;
        var ch = self.canvas.clientHeight;
        if (st + ch > sh - 200 && rendered < fields.length) {
          renderChunk();
        }
      }, { passive: true });

      this._updateSelection();
    },

    _createCanvasFieldEl: function (field, index) {
      var self = this;
      var el = document.createElement('div');
      el.className = 'canvas-field';
      el.dataset.fieldId = field.id;
      el.draggable = true;

      var typeInfo = FB.FIELD_TYPES[field.type] || {};
      el.innerHTML =
        '<span class="field-label">' + FB.util.escapeHtml(field.label) + '</span>' +
        (field.required ? '<span class="field-required-mark">*</span>' : '') +
        '<span class="field-type-badge">' + (typeInfo.icon || '') + ' ' + (typeInfo.label || field.type) + '</span>' +
        '<div class="field-actions">' +
          '<button class="field-action-btn move-up" title="上移">↑</button>' +
          '<button class="field-action-btn move-down" title="下移">↓</button>' +
          '<button class="field-action-btn delete" title="删除">✕</button>' +
        '</div>';

      // Drag to reorder
      el.addEventListener('dragstart', function (e) {
        self._dragData = { source: 'canvas', fieldId: field.id };
        el.classList.add('drag-placeholder');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', field.id);
        e.stopPropagation();
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('drag-placeholder');
        self._dragData = null;
        self._clearDropIndicators();
      });

      // Action buttons
      el.querySelector('.move-up').addEventListener('click', function (e) {
        e.stopPropagation();
        self._moveField(field.id, -1);
      });
      el.querySelector('.move-down').addEventListener('click', function (e) {
        e.stopPropagation();
        self._moveField(field.id, 1);
      });
      el.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        self._deleteField(field.id);
      });

      if (field.id === this.selectedFieldId) el.classList.add('selected');
      return el;
    },

    _updateSelection: function () {
      var self = this;
      $$('.canvas-field', this.canvasFields).forEach(function (el) {
        el.classList.toggle('selected', el.dataset.fieldId === self.selectedFieldId);
      });
    },

    _moveField: function (fieldId, direction) {
      var idx = -1;
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === fieldId) { idx = i; break; }
      }
      var newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= this.template.fields.length) return;
      this._saveUndoState();
      var tmp = this.template.fields[idx];
      this.template.fields[idx] = this.template.fields[newIdx];
      this.template.fields[newIdx] = tmp;
      this._render();
    },

    _deleteField: function (fieldId) {
      // Check for dependent fields before deleting
      var dependents = FB.logic.getDependents(fieldId, this.template.fields);
      if (dependents.length > 0) {
        var depLabels = [];
        for (var di = 0; di < dependents.length; di++) {
          for (var fi = 0; fi < this.template.fields.length; fi++) {
            if (this.template.fields[fi].id === dependents[di]) {
              depLabels.push(this.template.fields[fi].label);
              break;
            }
          }
        }
        if (!confirm('以下字段依赖此字段的联动条件：\n' + depLabels.join('、') +
            '\n\n删除后这些条件将失效。是否继续？')) {
          return;
        }
      }

      this._saveUndoState();
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === fieldId) {
          this.template.fields[i]._deleted = true;
          this.template.fields[i]._deletedAt = FB.util.now();
          break;
        }
      }
      if (this.selectedFieldId === fieldId) {
        this.selectedFieldId = null;
        this._renderPropertyPanel();
      }
      this._render();
      FB.App.toast('字段已删除（旧数据仍保留该字段值）', 'info');
    },

    _saveUndoState: function () {
      this.undoManager.push(this.template.fields);
    },

    /* ---- Property Panel ---- */
    _renderPropertyPanel: function () {
      if (!this.selectedFieldId) {
        this.propEmpty.style.display = 'block';
        this.propContent.style.display = 'none';
        return;
      }
      var field = null;
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === this.selectedFieldId) {
          field = this.template.fields[i];
          break;
        }
      }
      if (!field) {
        this.propEmpty.style.display = 'block';
        this.propContent.style.display = 'none';
        return;
      }

      this.propEmpty.style.display = 'none';
      this.propContent.style.display = 'block';

      var typeInfo = FB.FIELD_TYPES[field.type] || {};
      var html =
        '<div class="prop-group">' +
          '<div class="prop-group-title">基本信息 (' + typeInfo.label + ')</div>' +
          '<div class="prop-row">' +
            '<label class="prop-label">字段标签</label>' +
            '<input class="prop-input" data-prop="label" value="' + FB.util.escapeHtml(field.label) + '">' +
          '</div>' +
          '<div class="prop-row">' +
            '<label class="prop-label">字段ID</label>' +
            '<input class="prop-input" value="' + field.id + '" disabled style="color:#999">' +
          '</div>' +
          '<div class="prop-row">' +
            '<label class="prop-label">占位提示</label>' +
            '<input class="prop-input" data-prop="placeholder" value="' + FB.util.escapeHtml(field.placeholder || '') + '">' +
          '</div>' +
          '<div class="prop-checkbox-row">' +
            '<input type="checkbox" data-prop="required" ' + (field.required ? 'checked' : '') + '>' +
            '<label>必填</label>' +
          '</div>' +
        '</div>';

      // Default value
      if (field.type !== 'group' && field.type !== 'table') {
        html +=
          '<div class="prop-group">' +
            '<div class="prop-group-title">默认值</div>' +
            '<div class="prop-row">' +
              '<input class="prop-input" data-prop="defaultValue" value="' + FB.util.escapeHtml(field.defaultValue || '') + '">' +
            '</div>' +
          '</div>';
      }

      html += this._renderValidationProps(field);

      if (typeInfo.hasOptions) {
        html += this._renderOptionsEditor(field);
      }

      if (field.type === 'table') {
        html += this._renderSubFieldsEditor(field);
      }

      if (field.type === 'group') {
        html +=
          '<div class="prop-group">' +
            '<div class="prop-group-title">分组描述</div>' +
            '<div class="prop-row">' +
              '<textarea class="prop-input" data-prop="description" rows="3">' + FB.util.escapeHtml(field.description || '') + '</textarea>' +
            '</div>' +
          '</div>';
      }

      html += this._renderConditionsEditor(field);

      html +=
        '<div class="prop-group">' +
          '<div class="prop-group-title">自定义错误提示</div>' +
          '<div class="prop-row">' +
            '<input class="prop-input" data-prop="errorMessage" value="' + FB.util.escapeHtml(field.errorMessage || '') + '" placeholder="留空使用默认提示">' +
          '</div>' +
        '</div>';

      this.propContent.innerHTML = html;
      this._bindPropertyEvents(field);
    },

    _renderValidationProps: function (field) {
      var html = '<div class="prop-group"><div class="prop-group-title">验证规则</div>';
      var v = field.validation || {};

      switch (field.type) {
        case 'text':
          html +=
            '<div class="prop-row"><label class="prop-label">最小长度</label>' +
            '<input class="prop-input" data-validation="minLength" type="number" value="' + (v.minLength || '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">最大长度</label>' +
            '<input class="prop-input" data-validation="maxLength" type="number" value="' + (v.maxLength || '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">正则表达式</label>' +
            '<input class="prop-input" data-validation="regex" value="' + FB.util.escapeHtml(v.regex || '') + '" placeholder="如: ^\\d{6}$"></div>';
          break;
        case 'number':
          html +=
            '<div class="prop-row"><label class="prop-label">最小值</label>' +
            '<input class="prop-input" data-validation="min" type="number" value="' + (v.min !== undefined && v.min !== '' ? v.min : '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">最大值</label>' +
            '<input class="prop-input" data-validation="max" type="number" value="' + (v.max !== undefined && v.max !== '' ? v.max : '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">正则表达式</label>' +
            '<input class="prop-input" data-validation="regex" value="' + FB.util.escapeHtml(v.regex || '') + '"></div>';
          break;
        case 'date':
          html +=
            '<div class="prop-row"><label class="prop-label">最早日期</label>' +
            '<input class="prop-input" data-validation="minDate" type="date" value="' + (v.minDate || '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">最晚日期</label>' +
            '<input class="prop-input" data-validation="maxDate" type="date" value="' + (v.maxDate || '') + '"></div>';
          break;
        case 'attachment':
          html +=
            '<div class="prop-row"><label class="prop-label">最大文件大小 (MB)</label>' +
            '<input class="prop-input" data-validation="maxSize" type="number" value="' + (v.maxSize || '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">允许类型</label>' +
            '<input class="prop-input" data-validation="accept" value="' + FB.util.escapeHtml(v.accept || '') + '" placeholder="如: .pdf,.jpg"></div>';
          break;
        case 'table':
          html +=
            '<div class="prop-row"><label class="prop-label">最少行数</label>' +
            '<input class="prop-input" data-prop="minRows" type="number" value="' + (field.minRows || '') + '"></div>' +
            '<div class="prop-row"><label class="prop-label">最多行数</label>' +
            '<input class="prop-input" data-prop="maxRows" type="number" value="' + (field.maxRows || '') + '"></div>';
          break;
        default:
          html += '<div style="color:#999;font-size:12px;">该字段类型无额外验证规则</div>';
      }
      html += '</div>';
      return html;
    },

    _renderOptionsEditor: function (field) {
      var opts = field.options || [];
      var html = '<div class="prop-group"><div class="prop-group-title">选项列表</div>';
      html += '<div class="option-list-editor">';
      for (var i = 0; i < opts.length; i++) {
        html +=
          '<div class="option-item" data-index="' + i + '">' +
            '<input data-opt="label" value="' + FB.util.escapeHtml(opts[i].label) + '" placeholder="显示文字">' +
            '<input data-opt="value" value="' + FB.util.escapeHtml(opts[i].value) + '" placeholder="值" style="max-width:80px">' +
            '<button class="btn-remove-option" data-index="' + i + '">✕</button>' +
          '</div>';
      }
      html += '</div>';
      html += '<button class="btn-add-option" id="btn-add-option">+ 添加选项</button>';
      html += '</div>';
      return html;
    },

    _renderSubFieldsEditor: function (field) {
      var subs = field.subFields || [];
      var subTypes = ['text','number','date','radio','checkbox'];
      var html = '<div class="prop-group"><div class="prop-group-title">表格列定义</div>';
      html += '<div class="subfield-list">';

      var hasDeleted = false;
      var deletedHtml = '';

      for (var i = 0; i < subs.length; i++) {
        var sf = subs[i];

        if (sf._deleted) {
          hasDeleted = true;
          deletedHtml +=
            '<div class="subfield-item" data-index="' + i + '" style="opacity:0.5;text-decoration:line-through;">' +
              '<span style="flex:1;font-size:12px;">' + FB.util.escapeHtml(sf.label) + ' (' + sf.type + ')</span>' +
              '<button class="btn-add-option" data-sf-restore="' + i + '" style="font-size:11px;padding:2px 6px;">恢复</button>' +
            '</div>';
          continue;
        }

        var typeOptions = '';
        for (var t = 0; t < subTypes.length; t++) {
          typeOptions += '<option value="' + subTypes[t] + '"' + (sf.type === subTypes[t] ? ' selected' : '') + '>' + FB.FIELD_TYPES[subTypes[t]].label + '</option>';
        }
        html +=
          '<div class="subfield-item" data-index="' + i + '">' +
            '<input data-sf="label" value="' + FB.util.escapeHtml(sf.label) + '" placeholder="列名">' +
            '<select data-sf="type">' + typeOptions + '</select>' +
            '<label style="font-size:11px;display:flex;align-items:center;gap:2px;">' +
              '<input type="checkbox" data-sf="required"' + (sf.required ? ' checked' : '') + '> 必填' +
            '</label>' +
            '<button class="btn-remove-option" data-sf-remove="' + i + '">✕</button>' +
          '</div>';
      }
      html += '</div>';

      if (hasDeleted) {
        html += '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ccc;">';
        html += '<div style="font-size:11px;color:#999;margin-bottom:4px;">已删除列（旧数据仍保留）</div>';
        html += '<div class="subfield-list">' + deletedHtml + '</div>';
        html += '</div>';
      }

      html += '<button class="btn-add-option" id="btn-add-subfield">+ 添加列</button>';
      html += '</div>';
      return html;
    },

    _renderConditionsEditor: function (field) {
      var conditions = field.conditions || [];
      var otherFields = this._getOtherFields(field.id);

      // Build a map of all non-deleted field IDs for orphan detection
      var activeFieldIds = {};
      for (var af = 0; af < otherFields.length; af++) {
        activeFieldIds[otherFields[af].id] = true;
      }

      var html = '<div class="prop-group"><div class="prop-group-title">联动显示条件</div>';
      html += '<div class="condition-editor">';

      if (conditions.length > 0) {
        for (var i = 0; i < conditions.length; i++) {
          var cond = conditions[i];
          var isOrphan = cond.field && !activeFieldIds[cond.field];

          var fieldOpts = '<option value="">选择字段</option>';
          for (var fi = 0; fi < otherFields.length; fi++) {
            fieldOpts += '<option value="' + otherFields[fi].id + '"' + (cond.field === otherFields[fi].id ? ' selected' : '') + '>' + FB.util.escapeHtml(otherFields[fi].label) + '</option>';
          }
          var opOpts = '';
          var ops = [['equals','等于'],['notEquals','不等于'],['contains','包含'],['notEmpty','非空'],['greaterThan','大于'],['lessThan','小于']];
          for (var oi = 0; oi < ops.length; oi++) {
            opOpts += '<option value="' + ops[oi][0] + '"' + (cond.operator === ops[oi][0] ? ' selected' : '') + '>' + ops[oi][1] + '</option>';
          }

          var orphanStyle = isOrphan ? 'border:1px solid var(--danger);background:#fff5f5;' : '';
          html +=
            '<div class="condition-row" data-cond-index="' + i + '" style="' + orphanStyle + '">' +
              '<select data-cond="field">' + fieldOpts + '</select>' +
              '<select data-cond="operator">' + opOpts + '</select>' +
              '<input data-cond="value" value="' + FB.util.escapeHtml(cond.value || '') + '" placeholder="值"' + (cond.operator === 'notEmpty' ? ' disabled' : '') + '>' +
              '<button class="btn-remove-option" data-cond-remove="' + i + '">✕</button>' +
              (isOrphan ? '<div style="color:var(--danger);font-size:11px;margin-top:2px;">⚠ 引用字段已删除</div>' : '') +
            '</div>';
        }
      } else {
        html += '<div style="color:#999;font-size:12px;margin-bottom:6px;">无条件（始终显示）</div>';
      }

      html += '<button class="btn-add-option" id="btn-add-condition">+ 添加条件</button>';
      html += '</div>';

      if (conditions.length > 0) {
        var cycles = FB.logic.detectCycles(this.template.fields);
        if (cycles.length > 0) {
          html += '<div style="color:var(--danger);font-size:11px;margin-top:6px;">⚠ 检测到循环依赖！请检查条件配置</div>';
        }
      }

      html += '</div>';
      return html;
    },

    _getOtherFields: function (excludeId) {
      var result = [];
      var collect = function (fields) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f._deleted || f.id === excludeId) continue;
          if (f.type !== 'group') result.push(f);
          if (f.type === 'group' && f.children) collect(f.children);
        }
      };
      collect(this.template.fields);
      return result;
    },

    _bindPropertyEvents: function (field) {
      var self = this;

      // Text inputs
      $$('.prop-input[data-prop]', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          field[input.dataset.prop] = input.value;
          self._render();
        });
      });

      // Checkbox props (required)
      $$('.prop-checkbox-row input[data-prop]', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          field[input.dataset.prop] = input.checked;
          self._render();
        });
      });

      // Validation inputs
      $$('.prop-input[data-validation]', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          if (!field.validation) field.validation = {};
          field.validation[input.dataset.validation] = input.value;
        });
      });

      // minRows / maxRows
      $$('.prop-input[data-prop="minRows"],.prop-input[data-prop="maxRows"]', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          field[input.dataset.prop] = input.value;
        });
      });

      // Options editor
      $$('.option-item input', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          var item = input.closest('.option-item');
          var idx = Number(item.dataset.index);
          field.options[idx][input.dataset.opt] = input.value;
        });
      });

      $$('.btn-remove-option[data-index]', this.propContent).forEach(function (btn) {
        btn.addEventListener('click', function () {
          self._saveUndoState();
          field.options.splice(Number(btn.dataset.index), 1);
          self._renderPropertyPanel();
        });
      });

      var addOptBtn = $('#btn-add-option', this.propContent);
      if (addOptBtn) {
        addOptBtn.addEventListener('click', function () {
          self._saveUndoState();
          var n = (field.options || []).length + 1;
          if (!field.options) field.options = [];
          field.options.push({ label: '选项' + n, value: 'opt' + n });
          self._renderPropertyPanel();
        });
      }

      // Sub-fields editor
      $$('.subfield-item input, .subfield-item select', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          var item = input.closest('.subfield-item');
          var idx = Number(item.dataset.index);
          if (input.dataset.sf === 'required') {
            field.subFields[idx].required = input.checked;
          } else if (input.dataset.sf) {
            field.subFields[idx][input.dataset.sf] = input.value;
          }
        });
      });

      $$('[data-sf-remove]', this.propContent).forEach(function (btn) {
        btn.addEventListener('click', function () {
          self._saveUndoState();
          var idx = Number(btn.dataset.sfRemove);
          field.subFields[idx]._deleted = true;
          field.subFields[idx]._deletedAt = FB.util.now();
          self._renderPropertyPanel();
        });
      });

      $$('[data-sf-restore]', this.propContent).forEach(function (btn) {
        btn.addEventListener('click', function () {
          self._saveUndoState();
          var idx = Number(btn.dataset.sfRestore);
          delete field.subFields[idx]._deleted;
          delete field.subFields[idx]._deletedAt;
          self._renderPropertyPanel();
        });
      });

      var addSubBtn = $('#btn-add-subfield', this.propContent);
      if (addSubBtn) {
        addSubBtn.addEventListener('click', function () {
          self._saveUndoState();
          field.subFields.push({
            id: FB.util.uid(),
            type: 'text',
            label: '新列',
            required: false,
            validation: {}
          });
          self._renderPropertyPanel();
        });
      }

      // Conditions editor
      $$('.condition-row select, .condition-row input', this.propContent).forEach(function (input) {
        input.addEventListener('change', function () {
          self._saveUndoState();
          var row = input.closest('.condition-row');
          var idx = Number(row.dataset.condIndex);
          field.conditions[idx][input.dataset.cond] = input.value;
          self._renderPropertyPanel();
        });
      });

      $$('[data-cond-remove]', this.propContent).forEach(function (btn) {
        btn.addEventListener('click', function () {
          self._saveUndoState();
          field.conditions.splice(Number(btn.dataset.condRemove), 1);
          self._renderPropertyPanel();
        });
      });

      var addCondBtn = $('#btn-add-condition', this.propContent);
      if (addCondBtn) {
        addCondBtn.addEventListener('click', function () {
          self._saveUndoState();
          if (!field.conditions) field.conditions = [];
          field.conditions.push({ field: '', operator: 'equals', value: '' });
          self._renderPropertyPanel();
        });
      }
    }
  };
})();
