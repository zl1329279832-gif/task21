/**
 * 政务表单低代码配置系统 - 渲染器 (Renderer)
 * Dynamic form rendering, draft/save/submit, history version viewing
 */
(function () {
  'use strict';
  var FB = window.FormBuilder;

  function $(sel, parent) { return (parent || document).querySelector(sel); }
  function $$(sel, parent) { return Array.prototype.slice.call((parent || document).querySelectorAll(sel)); }

  FB.Renderer = function (container) {
    this.container = container;
    this.template = null;
    this.values = {};
    this.errors = {};
    this.recordId = null;
    this.isPreview = false;
  };

  FB.Renderer.prototype = {
    render: function (template, initialData, opts) {
      opts = opts || {};
      this.template = template;
      this.isPreview = !!opts.isPreview;
      this.recordId = opts.recordId || FB.util.uid();

      this.values = {};
      this._initDefaults(template.fields);
      if (initialData) {
        this.values = FB.compatibility.mergeDataWithTemplate(template, initialData);
      }
      this.values._templateVersion = template.version;
      this.values._recordId = this.recordId;
      this.errors = {};
      this._buildDOM();
    },

    _initDefaults: function (fields) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f._deleted) continue;
        switch (f.type) {
          case 'checkbox':
            this.values[f.id] = f.defaultValue ? (Array.isArray(f.defaultValue) ? f.defaultValue.slice() : []) : [];
            break;
          case 'table':
            this.values[f.id] = [];
            break;
          case 'address':
            this.values[f.id] = [];
            break;
          case 'group':
            if (f.children) this._initDefaults(f.children);
            break;
          default:
            this.values[f.id] = f.defaultValue || '';
        }
      }
    },

    _buildDOM: function () {
      this.container.innerHTML = '';
      var form = document.createElement('div');
      form.className = 'rendered-form';

      var title = document.createElement('h2');
      title.style.cssText = 'font-size:18px;margin-bottom:4px;';
      title.textContent = this.template.name;
      form.appendChild(title);

      var meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;color:#999;margin-bottom:20px;';
      meta.textContent = '模板版本: v' + this.template.version + ' | 记录ID: ' + this.recordId.slice(0, 12);
      form.appendChild(meta);

      // Show archived/deleted field data in collapsible panel
      var deletedWithData = FB.compatibility.getDeletedFieldsWithData(this.template, this.values);
      if (deletedWithData.length > 0) {
        var notice = document.createElement('div');
        notice.className = 'archived-fields-panel';
        notice.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;border-radius:6px;margin-bottom:16px;font-size:12px;overflow:hidden;';
        var header = document.createElement('div');
        header.style.cssText = 'padding:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;';
        header.innerHTML = '<span>📦 已归档字段数据 (' + deletedWithData.length + ' 项)</span><span class="archive-toggle">▶</span>';
        var body = document.createElement('div');
        body.style.cssText = 'display:none;padding:0 10px 10px;border-top:1px solid #ffc107;';
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
        table.innerHTML = '<thead><tr style="text-align:left;"><th style="padding:4px;">字段</th><th style="padding:4px;">值</th><th style="padding:4px;">状态</th></tr></thead>';
        var tbody = document.createElement('tbody');
        for (var di = 0; di < deletedWithData.length; di++) {
          var d = deletedWithData[di];
          var val = Array.isArray(d.value) ? JSON.stringify(d.value) : String(d.value);
          if (val.length > 80) val = val.slice(0, 80) + '...';
          var tr = document.createElement('tr');
          tr.style.cssText = 'border-top:1px solid #f0e0a0;';
          tr.innerHTML =
            '<td style="padding:4px;">' + FB.util.escapeHtml(d.label) + '</td>' +
            '<td style="padding:4px;word-break:break-all;">' + FB.util.escapeHtml(val) + '</td>' +
            '<td style="padding:4px;color:#999;">' + (d.archived ? '已归档' : '孤儿数据') +
            (d.deletedAt ? '<br>' + new Date(d.deletedAt).toLocaleDateString() : '') + '</td>';
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        body.appendChild(table);
        header.addEventListener('click', function () {
          var visible = body.style.display !== 'none';
          body.style.display = visible ? 'none' : 'block';
          header.querySelector('.archive-toggle').textContent = visible ? '▶' : '▼';
        });
        notice.appendChild(header);
        notice.appendChild(body);
        form.appendChild(notice);
      }

      this._renderFields(this.template.fields, form);
      this.container.appendChild(form);
      this._bindFormEvents(form);
      this._updateConditions();
    },

    _renderFields: function (fields, parent) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f._deleted) continue;
        var el = this._createFieldElement(f);
        if (el) parent.appendChild(el);
      }
    },

    _createFieldElement: function (field) {
      var wrapper = document.createElement('div');
      wrapper.className = 'form-field';
      wrapper.dataset.fieldId = field.id;
      wrapper.dataset.fieldType = field.type;

      switch (field.type) {
        case 'text':
          wrapper.innerHTML = this._renderTextField(field);
          break;
        case 'number':
          wrapper.innerHTML = this._renderNumberField(field);
          break;
        case 'date':
          wrapper.innerHTML = this._renderDateField(field);
          break;
        case 'radio':
          wrapper.innerHTML = this._renderRadioField(field);
          break;
        case 'checkbox':
          wrapper.innerHTML = this._renderCheckboxField(field);
          break;
        case 'attachment':
          wrapper.innerHTML = this._renderAttachmentField(field);
          break;
        case 'address':
          wrapper.innerHTML = this._renderAddressField(field);
          break;
        case 'table':
          wrapper.innerHTML = this._renderTableField(field);
          break;
        case 'group':
          wrapper.innerHTML = this._renderGroupField(field);
          break;
        default:
          wrapper.innerHTML = '<div class="form-field-label">未知字段类型: ' + field.type + '</div>';
      }

      var errDiv = document.createElement('div');
      errDiv.className = 'form-field-error';
      errDiv.dataset.errorFor = field.id;
      wrapper.appendChild(errDiv);

      return wrapper;
    },

    _fieldLabel: function (field) {
      return '<label class="form-field-label">' + FB.util.escapeHtml(field.label) +
        (field.required ? '<span class="required-star">*</span>' : '') + '</label>';
    },

    _renderTextField: function (f) {
      return this._fieldLabel(f) +
        '<div class="form-field-control">' +
          '<input type="text" data-field="' + f.id + '" value="' + FB.util.escapeHtml(this.values[f.id] || '') + '"' +
          ' placeholder="' + FB.util.escapeHtml(f.placeholder || '') + '"' +
          (this.isPreview ? ' readonly' : '') + '>' +
        '</div>';
    },

    _renderNumberField: function (f) {
      var attrs = '';
      if (f.validation.min !== '' && f.validation.min !== undefined) attrs += ' min="' + f.validation.min + '"';
      if (f.validation.max !== '' && f.validation.max !== undefined) attrs += ' max="' + f.validation.max + '"';
      return this._fieldLabel(f) +
        '<div class="form-field-control">' +
          '<input type="number" data-field="' + f.id + '" value="' + FB.util.escapeHtml(this.values[f.id] || '') + '"' +
          ' placeholder="' + FB.util.escapeHtml(f.placeholder || '') + '"' + attrs +
          (this.isPreview ? ' readonly' : '') + '>' +
        '</div>';
    },

    _renderDateField: function (f) {
      var attrs = '';
      if (f.validation.minDate) attrs += ' min="' + f.validation.minDate + '"';
      if (f.validation.maxDate) attrs += ' max="' + f.validation.maxDate + '"';
      return this._fieldLabel(f) +
        '<div class="form-field-control">' +
          '<input type="date" data-field="' + f.id + '" value="' + FB.util.escapeHtml(this.values[f.id] || '') + '"' +
          attrs + (this.isPreview ? ' readonly' : '') + '>' +
        '</div>';
    },

    _renderRadioField: function (f) {
      var opts = '';
      var options = f.options || [];
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        opts += '<label><input type="radio" name="' + f.id + '" data-field="' + f.id + '" value="' +
          FB.util.escapeHtml(o.value) + '"' + (this.values[f.id] === o.value ? ' checked' : '') +
          (this.isPreview ? ' disabled' : '') + '> ' + FB.util.escapeHtml(o.label) + '</label>';
      }
      return this._fieldLabel(f) +
        '<div class="form-field-control"><div class="radio-group">' + opts + '</div></div>';
    },

    _renderCheckboxField: function (f) {
      var currentVals = this.values[f.id] || [];
      var opts = '';
      var options = f.options || [];
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        var checked = false;
        for (var j = 0; j < currentVals.length; j++) {
          if (currentVals[j] === o.value) { checked = true; break; }
        }
        opts += '<label><input type="checkbox" data-field="' + f.id + '" value="' +
          FB.util.escapeHtml(o.value) + '"' + (checked ? ' checked' : '') +
          (this.isPreview ? ' disabled' : '') + '> ' + FB.util.escapeHtml(o.label) + '</label>';
      }
      return this._fieldLabel(f) +
        '<div class="form-field-control"><div class="checkbox-group">' + opts + '</div></div>';
    },

    _renderAttachmentField: function (f) {
      var hasFile = !!this.values[f.id];
      var zoneContent = hasFile
        ? '📄 ' + FB.util.escapeHtml(this.values[f.id])
        : '📎 点击或拖拽上传附件';
      var hints = '';
      if (f.validation.accept) hints += '<div style="font-size:11px;margin-top:4px;">允许类型: ' + FB.util.escapeHtml(f.validation.accept) + '</div>';
      if (f.validation.maxSize) hints += '<div style="font-size:11px;">最大: ' + f.validation.maxSize + 'MB</div>';

      return this._fieldLabel(f) +
        '<div class="form-field-control">' +
          '<div class="attachment-zone' + (hasFile ? ' has-file' : '') + '" data-field="' + f.id + '">' +
            zoneContent + hints +
          '</div>' +
          '<input type="file" data-field="' + f.id + '" data-type="file" style="display:none"' +
          (f.validation.accept ? ' accept="' + FB.util.escapeHtml(f.validation.accept) + '"' : '') + '>' +
        '</div>';
    },

    _renderAddressField: function (f) {
      var val = this.values[f.id] || [];
      var provinces = Object.keys(FB.ADDRESS_DATA);
      var cities = val[0] ? Object.keys(FB.ADDRESS_DATA[val[0]] || {}) : [];
      var districts = (val[0] && val[1]) ? (FB.ADDRESS_DATA[val[0]] && FB.ADDRESS_DATA[val[0]][val[1]] || []) : [];
      var disabled = this.isPreview ? ' disabled' : '';

      var provOpts = '<option value="">-- 省/市 --</option>';
      for (var i = 0; i < provinces.length; i++) {
        provOpts += '<option value="' + provinces[i] + '"' + (val[0] === provinces[i] ? ' selected' : '') + '>' + provinces[i] + '</option>';
      }
      var cityOpts = '<option value="">-- 市 --</option>';
      for (var j = 0; j < cities.length; j++) {
        cityOpts += '<option value="' + cities[j] + '"' + (val[1] === cities[j] ? ' selected' : '') + '>' + cities[j] + '</option>';
      }
      var distOpts = '<option value="">-- 区/县 --</option>';
      for (var k = 0; k < districts.length; k++) {
        distOpts += '<option value="' + districts[k] + '"' + (val[2] === districts[k] ? ' selected' : '') + '>' + districts[k] + '</option>';
      }

      return this._fieldLabel(f) +
        '<div class="form-field-control">' +
          '<div class="address-cascade">' +
            '<select data-field="' + f.id + '" data-addr-level="0"' + disabled + '>' + provOpts + '</select>' +
            '<select data-field="' + f.id + '" data-addr-level="1"' + disabled + '>' + cityOpts + '</select>' +
            '<select data-field="' + f.id + '" data-addr-level="2"' + disabled + '>' + distOpts + '</select>' +
          '</div>' +
        '</div>';
    },

    _renderTableField: function (f) {
      var rows = this.values[f.id] || [];
      var subs = f.subFields || [];
      var activeSubs = subs.filter(function (s) { return !s._deleted; });

      var headerHtml = '';
      for (var i = 0; i < activeSubs.length; i++) {
        headerHtml += '<th>' + FB.util.escapeHtml(activeSubs[i].label) +
          (activeSubs[i].required ? '<span class="required-star">*</span>' : '') + '</th>';
      }
      if (!this.isPreview) headerHtml += '<th class="row-actions">操作</th>';

      var bodyHtml = '';
      for (var ri = 0; ri < rows.length; ri++) {
        bodyHtml += this._renderTableRow(f, rows[ri], ri, activeSubs);
      }

      var hints = '';
      if (f.minRows) hints += '<div class="form-field-hint">最少 ' + f.minRows + ' 行</div>';
      if (f.maxRows) hints += '<div class="form-field-hint">最多 ' + f.maxRows + ' 行</div>';

      // Detect archived column data in rows
      var archivedCols = this._getArchivedTableColumns(f, rows);
      var archiveHtml = '';
      if (archivedCols.length > 0) {
        archiveHtml = '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:6px 8px;margin-top:6px;font-size:11px;">' +
          '<strong>📦 旧列数据归档:</strong> ';
        for (var ai = 0; ai < archivedCols.length; ai++) {
          archiveHtml += '<span style="margin-right:8px;">' + FB.util.escapeHtml(archivedCols[ai].label) + ' (' + archivedCols[ai].count + ' 条)</span>';
        }
        archiveHtml += '</div>';
      }

      return this._fieldLabel(f) +
        '<div class="detail-table-wrapper">' +
          '<table class="detail-table" data-field="' + f.id + '">' +
            '<thead><tr>' + headerHtml + '</tr></thead>' +
            '<tbody data-table-body="' + f.id + '">' + bodyHtml + '</tbody>' +
          '</table>' +
          (!this.isPreview ? '<button class="btn-add-row" data-add-row="' + f.id + '">+ 添加行</button>' : '') +
          archiveHtml +
        '</div>' + hints;
    },

    _getArchivedTableColumns: function (field, rows) {
      var activeSfIds = {};
      var subs = field.subFields || [];
      for (var i = 0; i < subs.length; i++) {
        if (!subs[i]._deleted) activeSfIds[subs[i].id] = true;
      }
      var archived = {};
      for (var ri = 0; ri < rows.length; ri++) {
        for (var key in rows[ri]) {
          if (!activeSfIds[key] && rows[ri][key] !== '' && rows[ri][key] !== undefined && rows[ri][key] !== null) {
            if (!archived[key]) {
              var sfLabel = key;
              for (var si = 0; si < subs.length; si++) {
                if (subs[si].id === key) { sfLabel = subs[si].label; break; }
              }
              archived[key] = { label: sfLabel, count: 0 };
            }
            archived[key].count++;
          }
        }
      }
      var result = [];
      for (var ak in archived) result.push(archived[ak]);
      return result;
    },

    _renderTableRow: function (field, rowData, rowIndex, subs) {
      var cells = '';
      for (var si = 0; si < subs.length; si++) {
        var sf = subs[si];
        var val = rowData[sf.id] || '';
        var inputHtml;
        switch (sf.type) {
          case 'number':
            inputHtml = '<input type="number" data-table-field="' + sf.id + '" data-row="' + rowIndex + '" value="' + FB.util.escapeHtml(val) + '"' + (this.isPreview ? ' readonly' : '') + '>';
            break;
          case 'date':
            inputHtml = '<input type="date" data-table-field="' + sf.id + '" data-row="' + rowIndex + '" value="' + FB.util.escapeHtml(val) + '"' + (this.isPreview ? ' readonly' : '') + '>';
            break;
          case 'radio':
            var selOpts = '<option value="">--</option>';
            var sfOptions = sf.options || [];
            for (var oi = 0; oi < sfOptions.length; oi++) {
              selOpts += '<option value="' + sfOptions[oi].value + '"' + (val === sfOptions[oi].value ? ' selected' : '') + '>' + FB.util.escapeHtml(sfOptions[oi].label) + '</option>';
            }
            inputHtml = '<select data-table-field="' + sf.id + '" data-row="' + rowIndex + '"' + (this.isPreview ? ' disabled' : '') + '>' + selOpts + '</select>';
            break;
          case 'checkbox':
            var checkedVals = Array.isArray(val) ? val : [];
            var cbOpts = sf.options || [];
            inputHtml = '';
            for (var ci = 0; ci < cbOpts.length; ci++) {
              var cbChecked = false;
              for (var cvi = 0; cvi < checkedVals.length; cvi++) {
                if (checkedVals[cvi] === cbOpts[ci].value) { cbChecked = true; break; }
              }
              inputHtml += '<label style="font-size:11px;"><input type="checkbox" data-table-field="' + sf.id + '" data-row="' + rowIndex + '" value="' + cbOpts[ci].value + '"' + (cbChecked ? ' checked' : '') + (this.isPreview ? ' disabled' : '') + '> ' + FB.util.escapeHtml(cbOpts[ci].label) + '</label> ';
            }
            break;
          default:
            inputHtml = '<input type="text" data-table-field="' + sf.id + '" data-row="' + rowIndex + '" value="' + FB.util.escapeHtml(val) + '"' + (this.isPreview ? ' readonly' : '') + '>';
        }
        cells += '<td>' + inputHtml + '</td>';
      }
      var actions = this.isPreview ? '' :
        '<td class="row-actions"><button class="btn-remove-option" data-remove-row="' + field.id + '" data-row="' + rowIndex + '">✕</button></td>';
      return '<tr data-row-index="' + rowIndex + '">' + cells + actions + '</tr>';
    },

    _renderGroupField: function (f) {
      var html = '<div class="form-group-section">' +
        '<div class="group-title">' + FB.util.escapeHtml(f.label) + '</div>' +
        (f.description ? '<div class="group-description">' + FB.util.escapeHtml(f.description) + '</div>' : '');
      // Children rendered as placeholder div
      html += '<div data-group-children="' + f.id + '"></div>';
      html += '</div>';
      return html;
    },

    /* ---- Bind events ---- */
    _bindFormEvents: function (form) {
      var self = this;

      // Text/number/date inputs + table cell inputs
      form.addEventListener('input', function (e) {
        var el = e.target;
        if (el.dataset.field) {
          self.values[el.dataset.field] = el.value;
          self._clearFieldError(el.dataset.field);
        }
        if (el.dataset.tableField !== undefined && el.dataset.row !== undefined) {
          self._updateTableCell(el, el.dataset.tableField, Number(el.dataset.row));
        }
      });

      // Change events (for select, radio, checkbox, file)
      form.addEventListener('change', function (e) {
        var el = e.target;
        var fieldId = el.dataset.field;

        // Radio
        if (el.type === 'radio' && fieldId) {
          self.values[fieldId] = el.value;
          self._clearFieldError(fieldId);
        }

        // Checkbox (non-table)
        if (el.type === 'checkbox' && fieldId && el.dataset.tableField === undefined) {
          if (!self.values[fieldId]) self.values[fieldId] = [];
          if (el.checked) {
            self.values[fieldId].push(el.value);
          } else {
            self.values[fieldId] = self.values[fieldId].filter(function (v) { return v !== el.value; });
          }
          self._clearFieldError(fieldId);
        }

        // Address cascade
        if (el.dataset.addrLevel !== undefined && fieldId) {
          var level = Number(el.dataset.addrLevel);
          if (!Array.isArray(self.values[fieldId])) self.values[fieldId] = [];
          self.values[fieldId][level] = el.value;
          for (var i = level + 1; i < 3; i++) self.values[fieldId][i] = '';
          self._refreshAddressCascades(fieldId);
          self._clearFieldError(fieldId);
        }

        // Table cell select/checkbox
        if (el.dataset.tableField !== undefined && el.dataset.row !== undefined) {
          self._updateTableCell(el, el.dataset.tableField, Number(el.dataset.row));
        }

        // File input
        if (el.type === 'file' && fieldId) {
          var file = el.files[0];
          if (file) {
            self.values[fieldId] = file.name;
            var zone = form.querySelector('.attachment-zone[data-field="' + fieldId + '"]');
            if (zone) {
              zone.classList.add('has-file');
              zone.innerHTML = '📄 ' + FB.util.escapeHtml(file.name);
            }
          }
        }
      });

      // Click events
      form.addEventListener('click', function (e) {
        // Attachment zone click
        var zone = e.target.closest('.attachment-zone');
        if (zone && !self.isPreview) {
          var afId = zone.dataset.field;
          var fileInput = form.querySelector('input[type="file"][data-field="' + afId + '"]');
          if (fileInput) fileInput.click();
        }

        // Add row
        var addBtn = e.target.closest('[data-add-row]');
        if (addBtn) {
          self._addTableRow(addBtn.dataset.addRow);
        }

        // Remove row
        var removeBtn = e.target.closest('[data-remove-row]');
        if (removeBtn) {
          self._removeTableRow(removeBtn.dataset.removeRow, Number(removeBtn.dataset.row));
        }
      });

      // Drag-and-drop for attachments
      form.addEventListener('dragover', function (e) {
        var zone = e.target.closest('.attachment-zone');
        if (zone) { e.preventDefault(); zone.style.borderColor = 'var(--primary)'; }
      });
      form.addEventListener('dragleave', function (e) {
        var zone = e.target.closest('.attachment-zone');
        if (zone) zone.style.borderColor = '';
      });
      form.addEventListener('drop', function (e) {
        var zone = e.target.closest('.attachment-zone');
        if (zone && !self.isPreview) {
          e.preventDefault();
          zone.style.borderColor = '';
          var afId = zone.dataset.field;
          var file = e.dataTransfer.files[0];
          if (file) {
            self.values[afId] = file.name;
            zone.classList.add('has-file');
            zone.innerHTML = '📄 ' + FB.util.escapeHtml(file.name);
          }
        }
      });

      // Render group children after DOM is built
      this._renderGroupChildren(form);
    },

    _renderGroupChildren: function (form) {
      var self = this;
      var walk = function (fields) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f._deleted) continue;
          if (f.type === 'group' && f.children && f.children.length > 0) {
            var childContainer = form.querySelector('[data-group-children="' + f.id + '"]');
            if (childContainer) {
              for (var j = 0; j < f.children.length; j++) {
                var child = f.children[j];
                if (child._deleted) continue;
                var el = self._createFieldElement(child);
                if (el) childContainer.appendChild(el);
              }
            }
          }
          if (f.type === 'group' && f.children) walk(f.children);
        }
      };
      walk(this.template.fields);
    },

    _updateTableCell: function (el, tableFieldId, rowIndex) {
      for (var i = 0; i < this.template.fields.length; i++) {
        var f = this.template.fields[i];
        if (f.type === 'table' && f.subFields) {
          for (var j = 0; j < f.subFields.length; j++) {
            var sf = f.subFields[j];
            if (sf.id === tableFieldId) {
              var tableData = this.values[f.id] || [];
              if (tableData[rowIndex]) {
                if (el.type === 'checkbox') {
                  if (!Array.isArray(tableData[rowIndex][tableFieldId]))
                    tableData[rowIndex][tableFieldId] = [];
                  if (el.checked) {
                    tableData[rowIndex][tableFieldId].push(el.value);
                  } else {
                    tableData[rowIndex][tableFieldId] = tableData[rowIndex][tableFieldId].filter(function (v) { return v !== el.value; });
                  }
                } else {
                  tableData[rowIndex][tableFieldId] = el.value;
                }
              }
              this._clearFieldError(f.id);
              return;
            }
          }
        }
      }
    },

    _addTableRow: function (fieldId) {
      var field = null;
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === fieldId) { field = this.template.fields[i]; break; }
      }
      if (!field) return;
      var rows = this.values[fieldId] || [];
      if (field.maxRows && rows.length >= Number(field.maxRows)) {
        FB.App.toast('最多允许 ' + field.maxRows + ' 行', 'error');
        return;
      }
      var newRow = {};
      var subs = field.subFields || [];
      for (var j = 0; j < subs.length; j++) {
        if (subs[j]._deleted) continue;
        newRow[subs[j].id] = subs[j].type === 'checkbox' ? [] : '';
      }
      rows.push(newRow);
      this.values[fieldId] = rows;
      this._refreshTable(fieldId);
    },

    _removeTableRow: function (fieldId, rowIndex) {
      var field = null;
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === fieldId) { field = this.template.fields[i]; break; }
      }
      if (!field) return;
      var rows = this.values[fieldId] || [];
      if (field.minRows && rows.length <= Number(field.minRows)) {
        FB.App.toast('至少需要 ' + field.minRows + ' 行', 'error');
        return;
      }
      rows.splice(rowIndex, 1);
      this._refreshTable(fieldId);
    },

    _refreshTable: function (fieldId) {
      var field = null;
      for (var i = 0; i < this.template.fields.length; i++) {
        if (this.template.fields[i].id === fieldId) { field = this.template.fields[i]; break; }
      }
      if (!field) return;
      var tbody = this.container.querySelector('[data-table-body="' + fieldId + '"]');
      if (!tbody) return;
      tbody.innerHTML = '';
      var rows = this.values[fieldId] || [];
      var subs = (field.subFields || []).filter(function (s) { return !s._deleted; });
      for (var ri = 0; ri < rows.length; ri++) {
        var tr = document.createElement('tr');
        tr.dataset.rowIndex = ri;
        tr.innerHTML = this._renderTableRow(field, rows[ri], ri, subs);
        tbody.appendChild(tr);
      }
    },

    _refreshAddressCascades: function (fieldId) {
      var val = this.values[fieldId] || [];
      var form = this.container.querySelector('.rendered-form');
      if (!form) return;

      var citySelect = form.querySelector('select[data-field="' + fieldId + '"][data-addr-level="1"]');
      if (citySelect) {
        var cities = val[0] ? Object.keys(FB.ADDRESS_DATA[val[0]] || {}) : [];
        var cityHtml = '<option value="">-- 市 --</option>';
        for (var i = 0; i < cities.length; i++) {
          cityHtml += '<option value="' + cities[i] + '"' + (val[1] === cities[i] ? ' selected' : '') + '>' + cities[i] + '</option>';
        }
        citySelect.innerHTML = cityHtml;
      }

      var distSelect = form.querySelector('select[data-field="' + fieldId + '"][data-addr-level="2"]');
      if (distSelect) {
        var districts = (val[0] && val[1] && FB.ADDRESS_DATA[val[0]]) ? (FB.ADDRESS_DATA[val[0]][val[1]] || []) : [];
        var distHtml = '<option value="">-- 区/县 --</option>';
        for (var j = 0; j < districts.length; j++) {
          distHtml += '<option value="' + districts[j] + '"' + (val[2] === districts[j] ? ' selected' : '') + '>' + districts[j] + '</option>';
        }
        distSelect.innerHTML = distHtml;
      }
    },

    /* ---- Conditional display ---- */
    _updateConditions: function () {
      var self = this;
      var fields = this.template.fields;
      var form = this.container.querySelector('.rendered-form');
      if (!form) return;

      var toggleField = function (field) {
        if (field._deleted) return;
        var el = form.querySelector('[data-field-id="' + field.id + '"]');
        if (el) {
          var hidden = FB.logic.isFieldHidden(field, self.values, fields);
          el.classList.toggle('hidden-by-logic', hidden);
        }
        if (field.type === 'group' && field.children) {
          for (var i = 0; i < field.children.length; i++) {
            toggleField(field.children[i]);
          }
        }
      };

      for (var i = 0; i < fields.length; i++) {
        toggleField(fields[i]);
      }
    },

    /* ---- Validation display ---- */
    _showErrors: function (errors) {
      this.errors = errors;
      var form = this.container.querySelector('.rendered-form');
      if (!form) return;

      $$('.form-field', form).forEach(function (el) { el.classList.remove('has-error'); });
      $$('.form-field-error', form).forEach(function (el) { el.textContent = ''; });
      $$('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); });

      for (var fieldId in errors) {
        var msgs = errors[fieldId];
        var fieldEl = form.querySelector('[data-field-id="' + fieldId + '"]');
        if (fieldEl) {
          fieldEl.classList.add('has-error');
          var errEl = fieldEl.querySelector('.form-field-error');
          if (errEl) errEl.textContent = msgs.join('; ');
          var input = fieldEl.querySelector('input, select, textarea');
          if (input) input.classList.add('invalid');
        }
      }
    },

    _clearFieldError: function (fieldId) {
      delete this.errors[fieldId];
      var form = this.container.querySelector('.rendered-form');
      if (!form) return;
      var fieldEl = form.querySelector('[data-field-id="' + fieldId + '"]');
      if (fieldEl) {
        fieldEl.classList.remove('has-error');
        var errEl = fieldEl.querySelector('.form-field-error');
        if (errEl) errEl.textContent = '';
      }
    },

    /* ---- Public API ---- */
    validate: function () {
      this._updateConditions();
      var result = FB.validate.validateForm(this.template, this.values);
      this._showErrors(result.errors);
      return result;
    },

    getValues: function () {
      return FB.util.deepClone(this.values);
    },

    saveDraft: function () {
      this.values._draft = true;
      this.values._savedAt = FB.util.now();
      FB.storage.saveFormData(this.template.id, this.recordId, this.getValues());
      return this.recordId;
    },

    submit: function () {
      var result = this.validate();
      if (!result.valid) {
        FB.App.toast('请修正表单中的错误', 'error');
        var firstErr = this.container.querySelector('.has-error');
        if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return null;
      }
      this.values._draft = false;
      this.values._submittedAt = FB.util.now();
      FB.storage.saveFormData(this.template.id, this.recordId, this.getValues());
      return this.recordId;
    }
  };
})();
