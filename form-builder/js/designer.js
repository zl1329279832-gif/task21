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
      this._changeLog = [];
      $('#template-name').value = this.template.name;
      this._render();
    },

    /* ---- Load existing template ---- */
    loadTemplate: function (tpl) {
      this.template = FB.util.deepClone(tpl);
      // Sanitize dangling condition references from historical data
      var sanitizeResult = FB.util.sanitizeTemplateRefs(this.template);
      if (sanitizeResult.changes.length > 0) {
        FB.App.toast('已自动清理 ' + sanitizeResult.changes.length + ' 条悬空联动条件', 'info');
      }
      $('#template-name').value = this.template.name;
      this.selectedFieldId = null;
      this._changeLog = [];
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

      var latestTpl = FB.storage.getTemplateLatest(this.template.id);

      // First publish or no previous version → skip impact assessment
      if (!latestTpl || latestTpl.version === 0) {
        this._doPublish(null);
        return;
      }

      // Run diff and impact assessment
      var diff = FB.migration.diffTemplates(latestTpl, this.template);
      if (diff.summary.totalChanges === 0) {
        this._doPublish(null);
        return;
      }

      var impact = FB.impact.assess(diff, this.template.id);
      var suggestions = FB.migration.detectFieldCorrespondence(latestTpl, this.template);
      this._showImpactModal(diff, impact, suggestions, latestTpl);
    },

    _doPublish: function (migrationConfig) {
      this.template.updatedAt = FB.util.now();
      // Attach change log for traceability
      if (this._changeLog && this._changeLog.length > 0) {
        this.template._changeLog = FB.util.deepClone(this._changeLog);
      }
      var published = FB.storage.publishTemplate(this.template);

      if (migrationConfig) {
        migrationConfig.templateId = this.template.id;
        migrationConfig.fromVersion = published.version - 1;
        migrationConfig.toVersion = published.version;
        FB.storage.saveMigrationConfig(this.template.id, published.version, migrationConfig);
      }

      this.undoManager.markBoundary('publish v' + published.version);
      // Reset change log after publish
      this._changeLog = [];
      FB.App.toast('模板已发布 (v' + published.version + ')', 'success');
      FB.App.refreshTemplateSelects();
    },

    _showImpactModal: function (diff, impact, suggestions, oldTpl) {
      var self = this;
      var body = document.createElement('div');
      body.style.maxHeight = '70vh';
      body.style.overflowY = 'auto';

      // Summary + report
      var reportHtml = FB.impact.generateReport(impact, diff);
      var reportDiv = document.createElement('div');
      reportDiv.innerHTML = reportHtml;
      body.appendChild(reportDiv);

      // Mapping rules section (only if breaking changes)
      var ruleSection = null;
      if (impact.hasBreakingChanges) {
        ruleSection = this._buildMappingRuleUI(suggestions, diff, impact);
        body.appendChild(ruleSection);
      }

      FB.App.showModal('发布影响评估报告', body, [
        {
          label: '取消发布',
          cls: 'btn-secondary',
          action: function () { FB.App.hideModal(); }
        },
        {
          label: '无规则直接发布',
          cls: 'btn-secondary',
          action: function () {
            if (impact.hasBreakingChanges) {
              if (!confirm('存在高风险变更，不配置映射规则可能导致历史数据显示异常。确定要继续吗？')) return;
            }
            FB.App.hideModal();
            self._doPublish(null);
          }
        },
        {
          label: impact.hasBreakingChanges ? '配置规则并发布' : '确认发布',
          cls: 'btn-primary',
          action: function () {
            var config = null;
            if (ruleSection) {
              config = self._collectMappingConfig(ruleSection);
            }
            FB.App.hideModal();
            self._doPublish(config);
          }
        }
      ]);
    },

    _buildMappingRuleUI: function (suggestions, diff, impact) {
      var section = document.createElement('div');
      section.className = 'mapping-rule-section';
      section.id = 'mapping-rule-container';

      var header = document.createElement('div');
      header.className = 'rule-section-header';
      header.innerHTML = '<span>字段映射规则配置</span><span style="font-size:11px;color:#999;">' + suggestions.length + ' 个建议</span>';
      section.appendChild(header);

      if (suggestions.length === 0) {
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;text-align:center;color:#999;font-size:13px;';
        empty.textContent = '未检测到可自动映射的字段变更';
        section.appendChild(empty);
        return section;
      }

      // Collect available target fields for merge
      var newFields = FB.migration.flattenFields(this.template.fields, false);
      var targetOptions = '';
      for (var fid in newFields) {
        if (newFields[fid].type !== 'group') {
          targetOptions += '<option value="' + fid + '">' + FB.util.escapeHtml(newFields[fid].label) + '</option>';
        }
      }

      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        var card = document.createElement('div');
        card.className = 'mapping-rule-card';
        card.setAttribute('data-rule-type', s.type);
        card.setAttribute('data-rule-index', i);

        var toggleHtml = '<div class="rule-toggle"><input type="checkbox" class="rule-enabled" checked> <strong>';

        if (s.type === 'field_merge') {
          toggleHtml += '字段合并</strong></div>';
          var sourceLabels = (s.sourceLabels || []).map(function (l) { return FB.util.escapeHtml(l); }).join(' + ');
          card.innerHTML = toggleHtml +
            '<div class="rule-fields">' +
            '<span class="rule-source-labels">' + sourceLabels + '</span>' +
            '<span class="rule-arrow">→</span>' +
            '<select class="rule-target">' + targetOptions + '</select>' +
            '<select class="rule-strategy">' +
            '<option value="concatenate">拼接</option>' +
            '<option value="take_first">取第一个</option>' +
            '<option value="take_last">取最后一个</option>' +
            '</select>' +
            '<input type="text" class="rule-separator" value=" " placeholder="分隔符" style="width:50px;">' +
            '</div>';
          card.setAttribute('data-source-ids', JSON.stringify(s.sourceFieldIds));
          card.setAttribute('data-target-id', s.targetFieldId || '');

        } else if (s.type === 'enum_rename') {
          toggleHtml += '枚举值重命名</strong>: ' + FB.util.escapeHtml(s.fieldLabel) + '</div>';
          var tableHtml = '<table class="enum-mapping-table"><tr><th>旧值</th><th></th><th>新值</th></tr>';
          for (var mi = 0; mi < s.mappings.length; mi++) {
            tableHtml += '<tr>' +
              '<td><input type="text" class="enum-old-value" value="' + FB.util.escapeHtml(s.mappings[mi].oldValue) + '" readonly></td>' +
              '<td>→</td>' +
              '<td><input type="text" class="enum-new-value" value="' + FB.util.escapeHtml(s.mappings[mi].newValue) + '"></td>' +
              '</tr>';
          }
          tableHtml += '</table>';
          card.innerHTML = toggleHtml + tableHtml;
          card.setAttribute('data-field-id', s.fieldId);

        } else if (s.type === 'attachment_preserve') {
          toggleHtml += '附件保留</strong>: ' + FB.util.escapeHtml(s.fieldLabel) + '</div>';
          // Collect attachment fields in new template for migrate_to option
          var attachOpts = '<option value="">保留为归档</option>';
          for (var afid in newFields) {
            if (newFields[afid].type === 'attachment' && afid !== s.fieldId) {
              attachOpts += '<option value="' + afid + '">迁移到: ' + FB.util.escapeHtml(newFields[afid].label) + '</option>';
            }
          }
          card.innerHTML = toggleHtml +
            '<div class="rule-fields">' +
            '<select class="rule-preserve-mode">' + attachOpts + '</select>' +
            '</div>';
          card.setAttribute('data-field-id', s.fieldId);
        }

        // Toggle enable/disable styling
        var checkbox = card.querySelector('.rule-enabled');
        if (checkbox) {
          checkbox.addEventListener('change', function () {
            this.closest('.mapping-rule-card').classList.toggle('disabled', !this.checked);
          });
        }

        section.appendChild(card);
      }

      return section;
    },

    _collectMappingConfig: function (ruleContainer) {
      var cards = ruleContainer.querySelectorAll('.mapping-rule-card');
      var rules = [];
      var ruleId = 0;

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var enabled = card.querySelector('.rule-enabled');
        if (enabled && !enabled.checked) continue;

        var type = card.getAttribute('data-rule-type');
        ruleId++;

        if (type === 'field_merge') {
          var sourceIds = JSON.parse(card.getAttribute('data-source-ids') || '[]');
          var targetSel = card.querySelector('.rule-target');
          var strategySel = card.querySelector('.rule-strategy');
          var sepInput = card.querySelector('.rule-separator');
          rules.push({
            ruleId: 'rule_' + ruleId,
            type: 'field_merge',
            enabled: true,
            sourceFieldIds: sourceIds,
            targetFieldId: targetSel ? targetSel.value : card.getAttribute('data-target-id'),
            mergeStrategy: strategySel ? strategySel.value : 'concatenate',
            mergeOptions: { separator: sepInput ? sepInput.value : ' ' }
          });

        } else if (type === 'enum_rename') {
          var fieldId = card.getAttribute('data-field-id');
          var oldInputs = card.querySelectorAll('.enum-old-value');
          var newInputs = card.querySelectorAll('.enum-new-value');
          var mappings = [];
          for (var mi = 0; mi < oldInputs.length; mi++) {
            if (oldInputs[mi].value && newInputs[mi].value) {
              mappings.push({ oldValue: oldInputs[mi].value, newValue: newInputs[mi].value });
            }
          }
          if (mappings.length > 0) {
            rules.push({
              ruleId: 'rule_' + ruleId,
              type: 'enum_rename',
              enabled: true,
              fieldId: fieldId,
              mappings: mappings
            });
          }

        } else if (type === 'attachment_preserve') {
          var aFieldId = card.getAttribute('data-field-id');
          var modeSel = card.querySelector('.rule-preserve-mode');
          var modeVal = modeSel ? modeSel.value : '';
          rules.push({
            ruleId: 'rule_' + ruleId,
            type: 'attachment_preserve',
            enabled: true,
            fieldId: aFieldId,
            preserveAs: modeVal ? 'migrate_to' : 'archive',
            migrateToFieldId: modeVal || null
          });
        }
      }

      if (rules.length === 0) return null;
      return { templateId: '', fromVersion: 0, toVersion: 0, rules: rules, createdAt: FB.util.now() };
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
          if (!self._changeLog) self._changeLog = [];
          self._changeLog.push({ ts: Date.now(), action: 'add', fieldId: newField.id, detail: '添加字段: ' + newField.label });
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
            if (!self._changeLog) self._changeLog = [];
            self._changeLog.push({ ts: Date.now(), action: 'reorder', fieldId: moved.id, detail: '拖拽重排: ' + moved.label + ' (索引 ' + fromIndex + ' → ' + adjustedIndex + ')' });
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
      if (!this._changeLog) this._changeLog = [];
      this._changeLog.push({
        ts: Date.now(),
        action: 'reorder',
        fieldId: fieldId,
        detail: '移动字段 ' + this.template.fields[newIdx].label + ' (索引 ' + idx + ' → ' + newIdx + ')'
      });
      this._render();
    },

    _deleteField: function (fieldId) {
      // Find the field label for the change log
      var deletedLabel = fieldId;
      for (var fi = 0; fi < this.template.fields.length; fi++) {
        if (this.template.fields[fi].id === fieldId) {
          deletedLabel = this.template.fields[fi].label;
          break;
        }
      }

      // Check for dependent fields before deleting
      var dependents = FB.logic.getDependents(fieldId, this.template.fields);
      if (dependents.length > 0) {
        var depLabels = [];
        for (var di = 0; di < dependents.length; di++) {
          for (var fi2 = 0; fi2 < this.template.fields.length; fi2++) {
            if (this.template.fields[fi2].id === dependents[di]) {
              depLabels.push(this.template.fields[fi2].label);
              break;
            }
          }
        }
        if (!confirm('以下字段依赖此字段的联动条件：\n' + depLabels.join('、') +
            '\n\n删除后这些条件将自动清除。是否继续？')) {
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

      // Auto-clean up conditions that referenced the deleted field
      var sanitizeResult = FB.util.sanitizeTemplateRefs(this.template);
      if (sanitizeResult.changes.length > 0) {
        FB.App.toast('已自动清除 ' + sanitizeResult.changes.length + ' 条引用此字段的联动条件', 'info');
      }

      // Log the change
      if (!this._changeLog) this._changeLog = [];
      this._changeLog.push({
        ts: Date.now(),
        action: 'delete',
        fieldId: fieldId,
        detail: '删除字段: ' + deletedLabel +
          (sanitizeResult.changes.length > 0 ? '，清理 ' + sanitizeResult.changes.length + ' 条悬空条件' : '')
      });

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
