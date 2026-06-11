/**
 * 政务表单低代码配置系统 - 核心引擎
 * Storage / Versioning / Validation / Logic / Undo-Redo / Import-Export
 */
(function () {
  'use strict';
  var FB = window.FormBuilder = {};

  /* =========================================================
     0. Utilities
     ========================================================= */
  FB.util = {
    uid: function () { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    deepClone: function (obj) { return JSON.parse(JSON.stringify(obj)); },
    escapeHtml: function (s) {
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
    },
    debounce: function (fn, ms) {
      var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
    },
    now: function () { return new Date().toISOString(); },

    /**
     * Collect all field IDs from the field tree (including _deleted fields,
     * group children, and table subFields).
     */
    collectAllFieldIds: function (fields) {
      var ids = [];
      var walk = function (arr) {
        for (var i = 0; i < arr.length; i++) {
          var f = arr[i];
          if (f.id) ids.push(f.id);
          if (f.type === 'group' && f.children) walk(f.children);
          if (f.type === 'table' && f.subFields) {
            for (var j = 0; j < f.subFields.length; j++) {
              if (f.subFields[j].id) ids.push(f.subFields[j].id);
            }
          }
        }
      };
      walk(fields);
      return ids;
    },

    /**
     * Check if a targetId exists anywhere in the field tree.
     * If includeDeleted is true, also checks _deleted fields.
     */
    hasFieldId: function (fields, targetId, includeDeleted) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.id === targetId && (includeDeleted || !f._deleted)) return true;
        if (f.type === 'group' && f.children) {
          if (this.hasFieldId(f.children, targetId, includeDeleted)) return true;
        }
        if (f.type === 'table' && f.subFields) {
          for (var j = 0; j < f.subFields.length; j++) {
            if (f.subFields[j].id === targetId && (includeDeleted || !f.subFields[j]._deleted)) return true;
          }
        }
      }
      return false;
    },

    /**
     * Scan all fields' conditions and remove any that reference non-existent
     * or _deleted field IDs. Returns { changes: [...] } describing what was cleaned.
     */
    sanitizeTemplateRefs: function (template) {
      var changes = [];
      var validIds = this.collectAllFieldIds(template.fields);
      var validMap = {};
      for (var k = 0; k < validIds.length; k++) validMap[validIds[k]] = true;

      var walk = function (fields, parentLabel) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f.conditions && f.conditions.length > 0) {
            var before = f.conditions.length;
            f.conditions = f.conditions.filter(function (cond) {
              if (!cond.field) return true; // empty condition, keep
              if (validMap[cond.field]) return true; // valid reference
              changes.push({
                fieldId: f.id,
                fieldLabel: f.label,
                parentLabel: parentLabel || null,
                removedCondition: FB.util.deepClone(cond),
                reason: '引用字段 ' + cond.field + ' 不存在'
              });
              return false;
            });
          }
          if (f.type === 'group' && f.children) walk(f.children, f.label);
        }
      };
      walk(template.fields, null);
      return { changes: changes };
    }
  };

  /* =========================================================
     1. Field Type Definitions
     ========================================================= */
  FB.FIELD_TYPES = {
    text:       { label: '文本输入', icon: '📝', hasOptions: false, hasSubfields: false, isValue: true },
    number:     { label: '数字输入', icon: '🔢', hasOptions: false, hasSubfields: false, isValue: true },
    date:       { label: '日期选择', icon: '📅', hasOptions: false, hasSubfields: false, isValue: true },
    radio:      { label: '单选',     icon: '🔘', hasOptions: true,  hasSubfields: false, isValue: true },
    checkbox:   { label: '多选',     icon: '☑️', hasOptions: true,  hasSubfields: false, isValue: true },
    attachment: { label: '附件占位', icon: '📎', hasOptions: false, hasSubfields: false, isValue: true },
    address:    { label: '地址级联', icon: '📍', hasOptions: false, hasSubfields: false, isValue: true },
    table:      { label: '明细表格', icon: '📊', hasOptions: false, hasSubfields: true,  isValue: true },
    group:      { label: '分组说明', icon: '📁', hasOptions: false, hasSubfields: false, isValue: false }
  };

  /** Create a new field config with defaults */
  FB.createField = function (type, overrides) {
    var f = {
      id: FB.util.uid(),
      type: type,
      label: FB.FIELD_TYPES[type].label,
      required: false,
      defaultValue: '',
      placeholder: '',
      conditions: [],
      validation: {},
      errorMessage: ''
    };
    if (type === 'number') {
      f.validation = { min: '', max: '', regex: '' };
    } else if (type === 'text') {
      f.validation = { minLength: '', maxLength: '', regex: '' };
    } else if (type === 'date') {
      f.validation = { minDate: '', maxDate: '' };
    } else if (type === 'radio' || type === 'checkbox') {
      f.options = [{ label: '选项1', value: 'opt1' }, { label: '选项2', value: 'opt2' }];
    } else if (type === 'table') {
      f.subFields = [
        { id: FB.util.uid(), type: 'text', label: '列1', required: false, validation: {} },
        { id: FB.util.uid(), type: 'text', label: '列2', required: false, validation: {} }
      ];
      f.minRows = 1;
      f.maxRows = '';
    } else if (type === 'group') {
      f.description = '分组说明文字';
      f.children = [];
    } else if (type === 'attachment') {
      f.validation = { maxSize: '', accept: '' };
    }
    if (overrides) {
      for (var k in overrides) {
        f[k] = overrides[k];
      }
    }
    return f;
  };

  /* =========================================================
     2. Storage - localStorage CRUD
     ========================================================= */
  var STORAGE_PREFIX = 'gov_form_';
  FB.storage = {
    _key: function (k) { return STORAGE_PREFIX + k; },
    get: function (k) {
      try { return JSON.parse(localStorage.getItem(this._key(k))); }
      catch (e) { return null; }
    },
    set: function (k, v) { localStorage.setItem(this._key(k), JSON.stringify(v)); },
    remove: function (k) { localStorage.removeItem(this._key(k)); },
    keys: function () {
      var result = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(STORAGE_PREFIX) === 0) result.push(k.slice(STORAGE_PREFIX.length));
      }
      return result;
    },
    // Template operations
    saveTemplateDraft: function (tpl) { this.set('draft_' + tpl.id, tpl); },
    getTemplateDraft: function (id) { return this.get('draft_' + id); },
    publishTemplate: function (tpl) {
      var versions = this.get('versions_' + tpl.id) || [];
      tpl.version = versions.length + 1;
      tpl.publishedAt = FB.util.now();
      versions.push(FB.util.deepClone(tpl));
      this.set('versions_' + tpl.id, versions);
      this.set('latest_' + tpl.id, tpl);
      // Update template index
      var index = this.get('template_index') || [];
      var idx = -1;
      for (var i = 0; i < index.length; i++) {
        if (index[i].id === tpl.id) { idx = i; break; }
      }
      var entry = { id: tpl.id, name: tpl.name, version: tpl.version, publishedAt: tpl.publishedAt };
      if (idx >= 0) index[idx] = entry; else index.push(entry);
      this.set('template_index', index);
      return tpl;
    },
    getTemplateLatest: function (id) { return this.get('latest_' + id); },
    getTemplateVersions: function (id) { return this.get('versions_' + id) || []; },
    getTemplateVersion: function (id, ver) {
      var versions = this.getTemplateVersions(id);
      for (var i = 0; i < versions.length; i++) {
        if (versions[i].version === ver) return versions[i];
      }
      return null;
    },
    getTemplateIndex: function () { return this.get('template_index') || []; },
    deleteTemplate: function (id) {
      this.remove('draft_' + id);
      this.remove('latest_' + id);
      this.remove('versions_' + id);
      this.remove('data_' + id);
      var index = this.getTemplateIndex();
      var filtered = [];
      for (var i = 0; i < index.length; i++) {
        if (index[i].id !== id) filtered.push(index[i]);
      }
      this.set('template_index', filtered);
    },
    // Form data operations
    saveFormData: function (templateId, recordId, data) {
      var all = this.getFormDataAll(templateId);
      var idx = -1;
      for (var i = 0; i < all.length; i++) {
        if (all[i].recordId === recordId) { idx = i; break; }
      }
      var entry = {
        recordId: recordId,
        data: data,
        savedAt: FB.util.now(),
        templateVersion: data._templateVersion || 0
      };
      if (idx >= 0) all[idx] = entry; else all.push(entry);
      this.set('data_' + templateId, all);
    },
    getFormDataAll: function (templateId) { return this.get('data_' + templateId) || []; },
    getFormData: function (templateId, recordId) {
      var all = this.getFormDataAll(templateId);
      for (var i = 0; i < all.length; i++) {
        if (all[i].recordId === recordId) return all[i];
      }
      return null;
    },
    deleteFormData: function (templateId, recordId) {
      var all = this.getFormDataAll(templateId);
      var filtered = [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].recordId !== recordId) filtered.push(all[i]);
      }
      this.set('data_' + templateId, filtered);
    },
    // Migration config CRUD
    saveMigrationConfig: function (templateId, version, config) {
      this.set('migration_' + templateId + '_' + version, config);
    },
    getMigrationConfig: function (templateId, version) {
      return this.get('migration_' + templateId + '_' + version);
    },
    getAllMigrationConfigs: function (templateId) {
      var configs = [];
      var versions = this.getTemplateVersions(templateId);
      for (var i = 1; i < versions.length; i++) {
        var cfg = this.getMigrationConfig(templateId, versions[i].version);
        if (cfg) configs.push(cfg);
      }
      return configs;
    },
    appendMigrationLog: function (templateId, logEntry) {
      var logs = this.getMigrationLogs(templateId);
      logs.push(logEntry);
      this.set('migration_log_' + templateId, logs);
    },
    getMigrationLogs: function (templateId) {
      return this.get('migration_log_' + templateId) || [];
    }
  };

  /* =========================================================
     3. Validation Engine
     ========================================================= */
  FB.validate = {
    /**
     * Validate a single field value against its config.
     * Returns array of error strings (empty = valid).
     */
    validateField: function (fieldConfig, value, allValues) {
      var errors = [];
      var fc = fieldConfig;
      var v = value;

      // Required check
      if (fc.required) {
        if (v === undefined || v === null || v === '' ||
            (Array.isArray(v) && v.length === 0)) {
          errors.push(fc.errorMessage || (fc.label + ' 不能为空'));
          return errors;
        }
      } else {
        if (v === undefined || v === null || v === '' ||
            (Array.isArray(v) && v.length === 0)) {
          return errors;
        }
      }

      // Type-specific validation
      switch (fc.type) {
        case 'text':
          if (fc.validation.minLength && String(v).length < Number(fc.validation.minLength))
            errors.push('最少 ' + fc.validation.minLength + ' 个字符');
          if (fc.validation.maxLength && String(v).length > Number(fc.validation.maxLength))
            errors.push('最多 ' + fc.validation.maxLength + ' 个字符');
          if (fc.validation.regex) {
            try {
              if (!new RegExp(fc.validation.regex).test(String(v)))
                errors.push(fc.errorMessage || '格式不正确');
            } catch (e) { errors.push('正则表达式无效'); }
          }
          break;
        case 'number': {
          var n = Number(v);
          if (isNaN(n)) { errors.push('请输入有效数字'); break; }
          if (fc.validation.min !== '' && fc.validation.min !== undefined &&
              n < Number(fc.validation.min))
            errors.push('不能小于 ' + fc.validation.min);
          if (fc.validation.max !== '' && fc.validation.max !== undefined &&
              n > Number(fc.validation.max))
            errors.push('不能大于 ' + fc.validation.max);
          if (fc.validation.regex) {
            try {
              if (!new RegExp(fc.validation.regex).test(String(v)))
                errors.push(fc.errorMessage || '数字格式不正确');
            } catch (e) { errors.push('正则表达式无效'); }
          }
          break;
        }
        case 'date':
          if (v && isNaN(Date.parse(v))) { errors.push('日期格式无效'); break; }
          if (fc.validation.minDate && v < fc.validation.minDate)
            errors.push('不能早于 ' + fc.validation.minDate);
          if (fc.validation.maxDate && v > fc.validation.maxDate)
            errors.push('不能晚于 ' + fc.validation.maxDate);
          break;
        case 'radio':
          if (fc.options) {
            var found = false;
            for (var i = 0; i < fc.options.length; i++) {
              if (fc.options[i].value === v) { found = true; break; }
            }
            if (!found) errors.push('请选择有效选项');
          }
          break;
        case 'checkbox':
          if (Array.isArray(v) && fc.options) {
            for (var j = 0; j < v.length; j++) {
              var ok = false;
              for (var k = 0; k < fc.options.length; k++) {
                if (fc.options[k].value === v[j]) { ok = true; break; }
              }
              if (!ok) errors.push('包含无效选项');
            }
          }
          break;
        case 'address':
          if (Array.isArray(v)) {
            if (v.length === 0 || !v[0]) errors.push('请选择省/市');
          }
          break;
        case 'attachment':
          break;
        case 'table':
          if (Array.isArray(v) && fc.subFields) {
            if (fc.minRows && v.length < Number(fc.minRows))
              errors.push('至少需要 ' + fc.minRows + ' 行数据');
            if (fc.maxRows && v.length > Number(fc.maxRows))
              errors.push('最多允许 ' + fc.maxRows + ' 行数据');
            // Validate each row
            for (var ri = 0; ri < v.length; ri++) {
              var row = v[ri];
              for (var si = 0; si < fc.subFields.length; si++) {
                var sf = fc.subFields[si];
                if (sf._deleted) continue;
                var rowVal = row[sf.id];
                if (sf.required && (rowVal === undefined || rowVal === null || rowVal === '')) {
                  errors.push('第 ' + (ri + 1) + ' 行 "' + sf.label + '" 不能为空');
                }
                if (sf.type === 'number' && rowVal !== '' && rowVal !== undefined) {
                  var sn = Number(rowVal);
                  if (isNaN(sn)) {
                    errors.push('第 ' + (ri + 1) + ' 行 "' + sf.label + '" 需要数字');
                  } else {
                    if (sf.validation && sf.validation.min !== '' && sf.validation.min !== undefined &&
                        sn < Number(sf.validation.min))
                      errors.push('第 ' + (ri + 1) + ' 行 "' + sf.label + '" 不能小于 ' + sf.validation.min);
                    if (sf.validation && sf.validation.max !== '' && sf.validation.max !== undefined &&
                        sn > Number(sf.validation.max))
                      errors.push('第 ' + (ri + 1) + ' 行 "' + sf.label + '" 不能大于 ' + sf.validation.max);
                  }
                }
                if (sf.validation && sf.validation.regex && rowVal) {
                  try {
                    if (!new RegExp(sf.validation.regex).test(String(rowVal)))
                      errors.push('第 ' + (ri + 1) + ' 行 "' + sf.label + '" 格式不正确');
                  } catch (e) { /* ignore */ }
                }
              }
            }
          }
          break;
        case 'group':
          break;
      }
      return errors;
    },

    /**
     * Validate entire form. Returns { errors: {}, valid: boolean }.
     */
    validateForm: function (template, values) {
      var errors = {};
      var fields = this._flattenFields(template.fields);
      var valid = true;

      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (FB.logic && FB.logic.isFieldHidden(f, values, template.fields)) continue;
        var fieldErrors = this.validateField(f, values[f.id], values);
        if (fieldErrors.length > 0) {
          errors[f.id] = fieldErrors;
          valid = false;
        }
      }
      return { errors: errors, valid: valid };
    },

    _flattenFields: function (fields) {
      var result = [];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f._deleted) continue;
        result.push(f);
        if (f.type === 'group' && f.children) {
          var children = this._flattenFields(f.children);
          for (var j = 0; j < children.length; j++) result.push(children[j]);
        }
      }
      return result;
    }
  };

  /* =========================================================
     4. Logic Engine - Conditional display + cycle detection
     ========================================================= */
  FB.logic = {
    /**
     * Check if a field should be hidden based on its conditions.
     * - If no conditions: field is always visible (return false).
     * - Orphaned conditions (referencing deleted/missing fields) are skipped.
     * - If ALL conditions are orphaned: field is visible (treat as no conditions).
     * - Otherwise: field is hidden if ANY valid condition is not met.
     */
    isFieldHidden: function (field, values, allFields) {
      if (!field.conditions || field.conditions.length === 0) return false;

      var validConditions = [];
      for (var i = 0; i < field.conditions.length; i++) {
        var cond = field.conditions[i];
        if (!cond.field) continue; // skip empty conditions
        // Check if the referenced field still exists in the field tree
        if (allFields && !FB.util.hasFieldId(allFields, cond.field, true)) {
          continue; // skip orphaned condition
        }
        validConditions.push(cond);
      }

      // If all conditions are orphaned, treat as no conditions → visible
      if (validConditions.length === 0) return false;

      for (var j = 0; j < validConditions.length; j++) {
        if (!this._evalCondition(validConditions[j], values)) return true;
      }
      return false;
    },

    _evalCondition: function (cond, values) {
      // Guard: if referenced field doesn't exist in values at all
      if (cond.field && !(cond.field in values)) {
        // For notEquals: absence of the field means it's not equal to anything → true
        if (cond.operator === 'notEquals') return true;
        // For notEmpty: absence means empty → false
        // For all others: treat as false (condition not met)
        return false;
      }
      var depVal = values[cond.field];
      switch (cond.operator) {
        case 'equals': return String(depVal) === String(cond.value);
        case 'notEquals': return String(depVal) !== String(cond.value);
        case 'contains':
          if (Array.isArray(depVal)) {
            for (var i = 0; i < depVal.length; i++) {
              if (depVal[i] === cond.value) return true;
            }
            return false;
          }
          return String(depVal).indexOf(String(cond.value)) >= 0;
        case 'notEmpty':
          return depVal !== undefined && depVal !== null && depVal !== '' &&
                 !(Array.isArray(depVal) && depVal.length === 0);
        case 'greaterThan': return Number(depVal) > Number(cond.value);
        case 'lessThan': return Number(depVal) < Number(cond.value);
        default: return true;
      }
    },

    /**
     * Detect circular dependencies in field conditions.
     * Returns array of cycles found.
     */
    detectCycles: function (fields) {
      var graph = {};
      var fieldMap = {};
      this._buildFieldMap(fields, fieldMap);

      for (var id in fieldMap) {
        var f = fieldMap[id];
        var deps = [];
        if (f.conditions) {
          for (var i = 0; i < f.conditions.length; i++) {
            if (f.conditions[i].field) deps.push(f.conditions[i].field);
          }
        }
        graph[id] = deps;
      }

      var cycles = [];
      var visited = {};
      var inStack = {};
      var path = [];

      var self = this;
      var dfs = function (node) {
        if (inStack[node]) {
          var cycleStart = path.indexOf(node);
          cycles.push(path.slice(cycleStart).concat(node));
          return;
        }
        if (visited[node]) return;
        visited[node] = true;
        inStack[node] = true;
        path.push(node);
        var deps = graph[node] || [];
        for (var i = 0; i < deps.length; i++) {
          if (graph[deps[i]]) dfs(deps[i]);
        }
        path.pop();
        delete inStack[node];
      };

      for (var node in graph) dfs(node);
      return cycles;
    },

    _buildFieldMap: function (fields, map) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f._deleted) continue;
        map[f.id] = f;
        if (f.type === 'group' && f.children) this._buildFieldMap(f.children, map);
      }
    },

    getDependents: function (fieldId, fields) {
      var fieldMap = {};
      this._buildFieldMap(fields, fieldMap);
      var dependents = {};
      var queue = [fieldId];
      while (queue.length) {
        var current = queue.shift();
        for (var id in fieldMap) {
          if (dependents[id]) continue;
          var f = fieldMap[id];
          if (f.conditions) {
            for (var i = 0; i < f.conditions.length; i++) {
              if (f.conditions[i].field === current) {
                dependents[id] = true;
                queue.push(id);
                break;
              }
            }
          }
        }
      }
      var result = [];
      for (var d in dependents) result.push(d);
      return result;
    }
  };

  /* =========================================================
     5. Undo / Redo Manager
     ========================================================= */
  FB.UndoManager = function (maxSize) {
    this._stack = [];
    this._redoStack = [];
    this._maxSize = maxSize || 50;
    this._onChange = null;
  };
  FB.UndoManager.prototype = {
    push: function (state) {
      this._stack.push(FB.util.deepClone(state));
      if (this._stack.length > this._maxSize) this._stack.shift();
      this._redoStack = [];
      this._notify();
    },
    /** Insert a named boundary marker into the undo stack */
    markBoundary: function (label) {
      this._stack.push({ _boundary: true, _label: label || 'boundary' });
      this._redoStack = [];
      this._notify();
    },
    /**
     * Undo: move back one step.
     * Pushes currentState to redo stack, pops the top of undo stack,
     * and returns the new top (the state to restore).
     */
    undo: function (currentState) {
      if (this._stack.length === 0) return null;
      var top = this._stack[this._stack.length - 1];
      // Detect boundary marker
      if (top && top._boundary) {
        return { _crossedBoundary: true, _label: top._label };
      }
      // Push current state to redo so we can redo back
      this._redoStack.push(FB.util.deepClone(currentState));
      // Pop the top (it's been "consumed")
      this._stack.pop();
      // Return the new top — the state to restore
      if (this._stack.length === 0) return null;
      var prev = this._stack[this._stack.length - 1];
      if (prev && prev._boundary) {
        return { _crossedBoundary: true, _label: prev._label };
      }
      return FB.util.deepClone(prev);
    },
    /** Force pop past a boundary marker (called after user confirms) */
    popBoundary: function (currentState) {
      if (this._stack.length === 0) return null;
      var top = this._stack[this._stack.length - 1];
      if (top && top._boundary) {
        this._stack.pop(); // remove boundary marker
      }
      // Now perform a normal undo
      return this.undo(currentState);
    },
    /**
     * Redo: move forward one step.
     * Pushes currentState to undo stack, pops from redo stack and returns it.
     */
    redo: function (currentState) {
      if (this._redoStack.length === 0) return null;
      this._stack.push(FB.util.deepClone(currentState));
      var next = this._redoStack.pop();
      this._notify();
      return next;
    },
    clear: function () {
      this._stack = [];
      this._redoStack = [];
      this._notify();
    },
    _notify: function () {
      if (this._onChange) this._onChange(this._stack.length > 0, this._redoStack.length > 0);
    }
  };
  Object.defineProperty(FB.UndoManager.prototype, 'canUndo', {
    get: function () { return this._stack.length > 0; }
  });
  Object.defineProperty(FB.UndoManager.prototype, 'canRedo', {
    get: function () { return this._redoStack.length > 0; }
  });

  /* =========================================================
     6. Import / Export
     ========================================================= */
  FB.io = {
    validateImport: function (data) {
      var errors = [];
      var warnings = [];
      if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['无效的 JSON 对象'], warnings: [], template: null };
      }
      if (!data.name || typeof data.name !== 'string')
        errors.push('缺少模板名称 (name)');
      if (!data.fields || !Array.isArray(data.fields))
        errors.push('缺少字段列表 (fields) 或格式不正确');
      else {
        // Collect all field IDs for cross-reference validation
        var allIds = {};
        for (var ii = 0; ii < data.fields.length; ii++) {
          var ff = data.fields[ii];
          if (ff.id) allIds[ff.id] = true;
          if (ff.type === 'table' && ff.subFields) {
            for (var sfi = 0; sfi < ff.subFields.length; sfi++) {
              if (ff.subFields[sfi].id) allIds[ff.subFields[sfi].id] = true;
            }
          }
          if (ff.type === 'group' && ff.children) {
            var collectChildIds = function (children) {
              for (var ci = 0; ci < children.length; ci++) {
                var cf = children[ci];
                if (cf.id) allIds[cf.id] = true;
                if (cf.type === 'group' && cf.children) collectChildIds(cf.children);
                if (cf.type === 'table' && cf.subFields) {
                  for (var csi = 0; csi < cf.subFields.length; csi++) {
                    if (cf.subFields[csi].id) allIds[cf.subFields[csi].id] = true;
                  }
                }
              }
            };
            collectChildIds(ff.children);
          }
        }

        for (var i = 0; i < data.fields.length; i++) {
          var f = data.fields[i];
          if (!f.id) errors.push('字段 [' + i + '] 缺少 id');
          if (!f.type) errors.push('字段 [' + i + '] 缺少 type');
          else if (!FB.FIELD_TYPES[f.type])
            errors.push('字段 [' + i + '] 类型 "' + f.type + '" 无效');
          if (!f.label) errors.push('字段 [' + i + '] 缺少 label');
          if ((f.type === 'radio' || f.type === 'checkbox') && f.options) {
            if (!Array.isArray(f.options))
              errors.push('字段 [' + i + '] options 必须是数组');
          }
          if (f.type === 'table' && f.subFields) {
            if (!Array.isArray(f.subFields))
              errors.push('字段 [' + i + '] subFields 必须是数组');
            else {
              for (var j = 0; j < f.subFields.length; j++) {
                var sf = f.subFields[j];
                if (!sf.id) errors.push('字段 [' + i + '] 子字段 [' + j + '] 缺少 id');
                if (!sf.type) errors.push('字段 [' + i + '] 子字段 [' + j + '] 缺少 type');
              }
            }
          }
          // Check condition references
          if (f.conditions && Array.isArray(f.conditions)) {
            for (var ci = 0; ci < f.conditions.length; ci++) {
              var cond = f.conditions[ci];
              if (cond.field && !allIds[cond.field]) {
                warnings.push('字段 "' + (f.label || f.id) + '" 的条件引用了不存在的字段 ' + cond.field + '（导入后将自动清理）');
              }
            }
          }
        }
      }
      return { valid: errors.length === 0, errors: errors, warnings: warnings, template: errors.length === 0 ? data : null };
    },

    exportTemplate: function (template) {
      var clone = FB.util.deepClone(template);
      clone._exportedAt = FB.util.now();
      clone._system = 'gov-form-builder';
      clone._exportVersion = 1;
      clone._fieldIdManifest = FB.util.collectAllFieldIds(template.fields);
      return JSON.stringify(clone, null, 2);
    },

    exportData: function (template, data) {
      return JSON.stringify({
        _system: 'gov-form-builder',
        _exportVersion: 1,
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        data: data,
        exportedAt: FB.util.now()
      }, null, 2);
    },

    exportDataCSV: function (template, data) {
      var fields = template.fields.filter(function (f) { return !f._deleted; });
      var headers = [];
      var values = [];

      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.type === 'table') {
          if (f.subFields) {
            for (var j = 0; j < f.subFields.length; j++) {
              if (f.subFields[j]._deleted) continue;
              headers.push(f.label + '.' + f.subFields[j].label);
            }
          }
        } else if (f.type === 'group') {
          // skip
        } else {
          headers.push(f.label);
          var v = data[f.id];
          if (Array.isArray(v)) values.push(v.join('; '));
          else values.push(v !== undefined ? String(v) : '');
        }
      }

      var tableFields = fields.filter(function (f) { return f.type === 'table'; });
      var lines = [headers.join(',')];
      if (tableFields.length > 0) {
        var maxRows = 1;
        for (var ti = 0; ti < tableFields.length; ti++) {
          var td = data[tableFields[ti].id] || [];
          if (td.length > maxRows) maxRows = td.length;
        }
        for (var ri = 0; ri < maxRows; ri++) {
          var row = values.slice();
          for (var tf = 0; tf < tableFields.length; tf++) {
            var tableData = data[tableFields[tf].id] || [];
            var rowData = tableData[ri] || {};
            if (tableFields[tf].subFields) {
              for (var sfi = 0; sfi < tableFields[tf].subFields.length; sfi++) {
                if (tableFields[tf].subFields[sfi]._deleted) continue;
                row.push(this._csvEscape(rowData[tableFields[tf].subFields[sfi].id] || ''));
              }
            }
          }
          lines.push(row.join(','));
        }
      } else {
        lines.push(values.join(','));
      }
      return lines.join('\n');
    },

    _csvEscape: function (v) {
      var s = String(v);
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    },

    downloadFile: function (content, filename, mimeType) {
      var blob = new Blob([content], { type: mimeType || 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    exportDataMigrated: function (latestTpl, originalData, templateId) {
      var migrated = FB.migration.applyMigrationView(originalData, templateId, latestTpl.version);
      if (migrated._migrationFailed) {
        return { success: false, error: migrated.error, data: null };
      }
      return {
        success: true,
        data: JSON.stringify({
          _system: 'gov-form-builder',
          _exportVersion: 1,
          _exportMode: 'migration',
          _migratedFrom: originalData._templateVersion,
          _migratedTo: latestTpl.version,
          templateId: latestTpl.id,
          templateName: latestTpl.name,
          templateVersion: latestTpl.version,
          data: migrated,
          exportedAt: FB.util.now()
        }, null, 2)
      };
    },

    exportDataCSVMigrated: function (latestTpl, originalData, templateId) {
      var migrated = FB.migration.applyMigrationView(originalData, templateId, latestTpl.version);
      if (migrated._migrationFailed) {
        return { success: false, error: migrated.error, csv: null };
      }
      return { success: true, csv: this.exportDataCSV(latestTpl, migrated) };
    },

    exportAllDataJSON: function (templateId, mode) {
      var allData = this.getFormDataAll(templateId);
      var tpl = this.getTemplateLatest(templateId);
      if (!tpl) return JSON.stringify({ error: 'template not found' });
      var records = [];
      for (var i = 0; i < allData.length; i++) {
        var rec = allData[i];
        if (mode === 'migration' && rec.data._templateVersion && rec.data._templateVersion < tpl.version) {
          var migrated = FB.migration.applyMigrationView(rec.data, templateId, tpl.version);
          records.push({
            recordId: rec.recordId,
            data: migrated._migrationFailed ? rec.data : migrated,
            _migrationStatus: migrated._migrationFailed ? 'failed' : 'migrated',
            savedAt: rec.savedAt
          });
        } else {
          records.push(rec);
        }
      }
      return JSON.stringify({
        _system: 'gov-form-builder',
        _exportVersion: 1,
        _exportMode: mode || 'original',
        templateId: tpl.id,
        templateName: tpl.name,
        templateVersion: tpl.version,
        recordCount: records.length,
        records: records,
        exportedAt: FB.util.now()
      }, null, 2);
    }
  };

  /* =========================================================
     7. Address Data (simplified province/city/district)
     ========================================================= */
  FB.ADDRESS_DATA = {
    '北京市': { '北京市': ['东城区','西城区','朝阳区','海淀区','丰台区','石景山区','通州区','顺义区','大兴区','昌平区'] },
    '上海市': { '上海市': ['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区','浦东新区','闵行区','宝山区'] },
    '广东省': {
      '广州市': ['天河区','越秀区','海珠区','荔湾区','白云区','番禺区','花都区','南沙区'],
      '深圳市': ['福田区','罗湖区','南山区','宝安区','龙岗区','盐田区','龙华区','坪山区'],
      '东莞市': ['莞城街道','南城街道','东城街道','万江街道'],
      '佛山市': ['禅城区','南海区','顺德区','三水区','高明区']
    },
    '浙江省': {
      '杭州市': ['上城区','下城区','江干区','拱墅区','西湖区','滨江区','余杭区','萧山区'],
      '宁波市': ['海曙区','江北区','北仑区','镇海区','鄞州区'],
      '温州市': ['鹿城区','龙湾区','瓯海区','洞头区']
    },
    '江苏省': {
      '南京市': ['玄武区','秦淮区','建邺区','鼓楼区','浦口区','栖霞区','雨花台区','江宁区'],
      '苏州市': ['姑苏区','虎丘区','吴中区','相城区','吴江区','昆山市'],
      '无锡市': ['梁溪区','锡山区','惠山区','滨湖区','新吴区']
    },
    '四川省': {
      '成都市': ['锦江区','青羊区','金牛区','武侯区','成华区','龙泉驿区','青白江区','新都区','温江区'],
      '绵阳市': ['涪城区','游仙区','安州区']
    },
    '湖北省': {
      '武汉市': ['江岸区','江汉区','硚口区','汉阳区','武昌区','青山区','洪山区','东西湖区'],
      '宜昌市': ['西陵区','伍家岗区','点军区','猇亭区']
    },
    '湖南省': {
      '长沙市': ['芙蓉区','天心区','岳麓区','开福区','雨花区','望城区'],
      '株洲市': ['天元区','荷塘区','芦淞区','石峰区']
    },
    '山东省': {
      '济南市': ['历下区','市中区','槐荫区','天桥区','历城区','长清区'],
      '青岛市': ['市南区','市北区','黄岛区','崂山区','李沧区','城阳区']
    }
  };

  /* =========================================================
     8. Version Compatibility
     ========================================================= */
  FB.compatibility = {
    mergeDataWithTemplate: function (template, data) {
      var merged = {};
      for (var key in data) {
        if (key.charAt(0) === '_') continue;
        merged[key] = data[key];
      }
      this._ensureDefaults(template.fields, merged);
      return merged;
    },

    _ensureDefaults: function (fields, data) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f._deleted) continue;
        if (data[f.id] === undefined) {
          if (f.type === 'checkbox') data[f.id] = [];
          else if (f.type === 'table') data[f.id] = [];
          else if (f.type === 'address') data[f.id] = [];
          else if (f.type === 'group') data[f.id] = undefined;
          else data[f.id] = f.defaultValue || '';
        }
        if (f.type === 'group' && f.children) {
          this._ensureDefaults(f.children, data);
        }
      }
    },

    getDeletedFieldsWithData: function (template, data) {
      var currentIds = {};
      this._collectFieldIds(template.fields, currentIds);
      var deleted = [];
      for (var key in data) {
        if (key.charAt(0) === '_') continue;
        if (!currentIds[key] && data[key] !== undefined && data[key] !== '' && data[key] !== null) {
          deleted.push({ id: key, value: data[key] });
        }
      }
      return deleted;
    },

    _collectFieldIds: function (fields, map) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f._deleted) map[f.id] = true;
        if (f.type === 'group' && f.children) this._collectFieldIds(f.children, map);
        if (f.type === 'table' && f.subFields) {
          for (var j = 0; j < f.subFields.length; j++) {
            if (!f.subFields[j]._deleted) map[f.subFields[j].id] = true;
          }
        }
      }
    },

    /**
     * Collect all deleted fields (top-level and table sub-fields) that still have data.
     * Returns array of { id, label, type, parentLabel, value, deletedAt }.
     */
    collectArchivedFields: function (template, data) {
      var result = [];
      var walk = function (fields, parentLabel) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          // Deleted top-level field with data
          if (f._deleted && data[f.id] !== undefined && data[f.id] !== '' && data[f.id] !== null) {
            result.push({
              id: f.id,
              label: f.label,
              type: f.type,
              parentLabel: parentLabel || null,
              value: data[f.id],
              deletedAt: f._deletedAt || null
            });
          }
          // Deleted table sub-fields
          if (f.type === 'table' && f.subFields) {
            var rows = data[f.id] || [];
            for (var j = 0; j < f.subFields.length; j++) {
              var sf = f.subFields[j];
              if (sf._deleted && rows.length > 0) {
                var archivedRows = [];
                for (var ri = 0; ri < rows.length; ri++) {
                  if (rows[ri] && rows[ri][sf.id] !== undefined && rows[ri][sf.id] !== '') {
                    archivedRows.push({ row: ri + 1, value: rows[ri][sf.id] });
                  }
                }
                if (archivedRows.length > 0) {
                  result.push({
                    id: sf.id,
                    label: sf.label,
                    type: sf.type,
                    parentLabel: f.label + (f._deleted ? ' (已删除)' : ''),
                    value: archivedRows,
                    deletedAt: sf._deletedAt || null
                  });
                }
              }
            }
          }
          // Recurse into group children
          if (f.type === 'group' && f.children) walk(f.children, f.label);
        }
      };
      walk(template.fields, null);

      // Also check for orphan data keys (field IDs in data that don't exist in template at all)
      var currentIds = {};
      this._collectAllFieldIdsIncludingDeleted(template.fields, currentIds);
      for (var key in data) {
        if (key.charAt(0) === '_') continue;
        if (!currentIds[key] && data[key] !== undefined && data[key] !== '' && data[key] !== null) {
          result.push({
            id: key,
            label: '(未知字段)',
            type: 'unknown',
            parentLabel: null,
            value: data[key],
            deletedAt: null
          });
        }
      }

      return result;
    },

    _collectAllFieldIdsIncludingDeleted: function (fields, map) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        map[f.id] = true;
        if (f.type === 'group' && f.children) this._collectAllFieldIdsIncludingDeleted(f.children, map);
        if (f.type === 'table' && f.subFields) {
          for (var j = 0; j < f.subFields.length; j++) {
            map[f.subFields[j].id] = true;
          }
        }
      }
    }
  };

  /* =========================================================
     9. Migration Engine
     ========================================================= */
  FB.migration = {
    /**
     * Flatten all fields (including group children and table subFields)
     * into a flat map keyed by field ID.
     */
    flattenFields: function (fields, includeDeleted) {
      var map = {};
      var walk = function (arr) {
        for (var i = 0; i < arr.length; i++) {
          var f = arr[i];
          if (!includeDeleted && f._deleted) continue;
          map[f.id] = f;
          if (f.type === 'group' && f.children) walk(f.children);
          if (f.type === 'table' && f.subFields) {
            for (var j = 0; j < f.subFields.length; j++) {
              if (!includeDeleted && f.subFields[j]._deleted) continue;
              map[f.subFields[j].id] = f.subFields[j];
            }
          }
        }
      };
      walk(fields);
      return map;
    },

    /**
     * Compute a detailed diff between two template snapshots.
     */
    diffTemplates: function (oldTpl, newTpl) {
      var oldFields = this.flattenFields(oldTpl.fields, false);
      var newFields = this.flattenFields(newTpl.fields, false);
      var newAll = this.flattenFields(newTpl.fields, true);

      var result = {
        added: [], deleted: [], renamed: [], typeChanged: [],
        optionsChanged: [], conditionsChanged: [], reordered: [],
        subFieldChanges: [],
        summary: { totalChanges: 0, breakingChanges: 0, nonBreakingChanges: 0 }
      };

      // Added: in new but not in old (and not _deleted)
      for (var nid in newFields) {
        if (!oldFields[nid] && !newFields[nid]._deleted) {
          result.added.push({ id: nid, label: newFields[nid].label, type: newFields[nid].type, field: newFields[nid] });
        }
      }

      // Deleted: in old but not in new, or present in newAll with _deleted that was active in old
      for (var oid in oldFields) {
        if (!newFields[oid]) {
          if (newAll[oid] && newAll[oid]._deleted) {
            result.deleted.push({ id: oid, label: oldFields[oid].label, type: oldFields[oid].type, field: oldFields[oid] });
          } else if (!newAll[oid]) {
            result.deleted.push({ id: oid, label: oldFields[oid].label, type: oldFields[oid].type, field: oldFields[oid] });
          }
        }
      }

      // Also detect newly-deleted fields (present in both but _deleted in new, not in old)
      for (var did in newAll) {
        if (newAll[did]._deleted && oldFields[did] && !oldFields[did]._deleted && !newFields[did]) {
          // Already captured above in the deleted loop
        }
      }

      // Changes for fields present in both
      for (var bid in oldFields) {
        if (!newFields[bid]) continue;
        var of = oldFields[bid];
        var nf = newFields[bid];

        // Renamed
        if (of.label.trim() !== nf.label.trim()) {
          result.renamed.push({ id: bid, oldLabel: of.label, newLabel: nf.label, field: nf });
        }

        // Type changed
        if (of.type !== nf.type) {
          result.typeChanged.push({ id: bid, oldType: of.type, newType: nf.type, field: nf });
        }

        // Options changed (radio/checkbox)
        if ((of.type === 'radio' || of.type === 'checkbox') && of.options && nf.options) {
          var oldOpts = {};
          for (var oi = 0; oi < of.options.length; oi++) oldOpts[of.options[oi].value] = of.options[oi];
          var newOpts = {};
          for (var ni = 0; ni < nf.options.length; ni++) newOpts[nf.options[ni].value] = nf.options[ni];

          var addedOpts = [], removedOpts = [], renamedOpts = [];
          for (var nv in newOpts) {
            if (!oldOpts[nv]) {
              addedOpts.push({ label: newOpts[nv].label, value: nv });
            }
          }
          for (var ov in oldOpts) {
            if (!newOpts[ov]) {
              removedOpts.push({ label: oldOpts[ov].label, value: ov });
            }
          }
          // Check for label renames (same value, different label)
          for (var cv in oldOpts) {
            if (newOpts[cv] && oldOpts[cv].label !== newOpts[cv].label) {
              renamedOpts.push({ oldLabel: oldOpts[cv].label, oldValue: cv, newLabel: newOpts[cv].label, newValue: cv });
            }
          }
          if (addedOpts.length || removedOpts.length || renamedOpts.length) {
            result.optionsChanged.push({
              id: bid, label: nf.label, type: nf.type,
              addedOptions: addedOpts, removedOptions: removedOpts, renamedOptions: renamedOpts
            });
          }
        }

        // Conditions changed
        var oldCondStr = JSON.stringify(of.conditions || []);
        var newCondStr = JSON.stringify(nf.conditions || []);
        if (oldCondStr !== newCondStr) {
          result.conditionsChanged.push({
            id: bid, label: nf.label,
            oldConditions: of.conditions || [],
            newConditions: nf.conditions || []
          });
        }
      }

      // Reordered: compare position of shared fields
      var oldOrder = this._getFieldOrder(oldTpl.fields);
      var newOrder = this._getFieldOrder(newTpl.fields);
      var oldPosMap = {};
      for (var pi = 0; pi < oldOrder.length; pi++) oldPosMap[oldOrder[pi]] = pi;
      for (var qi = 0; qi < newOrder.length; qi++) {
        var fid = newOrder[qi];
        if (oldPosMap[fid] !== undefined && oldPosMap[fid] !== qi) {
          var lbl = newFields[fid] ? newFields[fid].label : (oldFields[fid] ? oldFields[fid].label : fid);
          result.reordered.push({ id: fid, label: lbl, oldIndex: oldPosMap[fid], newIndex: qi });
        }
      }

      // SubField changes for table fields in both
      for (var tid in oldFields) {
        if (!newFields[tid]) continue;
        if (oldFields[tid].type !== 'table' || !oldFields[tid].subFields || !newFields[tid].subFields) continue;
        var oldSF = {};
        for (var si = 0; si < oldFields[tid].subFields.length; si++) {
          if (!oldFields[tid].subFields[si]._deleted) oldSF[oldFields[tid].subFields[si].id] = oldFields[tid].subFields[si];
        }
        var newSF = {};
        for (var sj = 0; sj < newFields[tid].subFields.length; sj++) {
          if (!newFields[tid].subFields[sj]._deleted) newSF[newFields[tid].subFields[sj].id] = newFields[tid].subFields[sj];
        }
        var sfAdded = [], sfDeleted = [], sfRenamed = [];
        for (var sn in newSF) {
          if (!oldSF[sn]) sfAdded.push({ id: sn, label: newSF[sn].label, type: newSF[sn].type });
        }
        for (var so in oldSF) {
          if (!newSF[so]) sfDeleted.push({ id: so, label: oldSF[so].label, type: oldSF[so].type });
          else if (oldSF[so].label !== newSF[so].label) {
            sfRenamed.push({ id: so, oldLabel: oldSF[so].label, newLabel: newSF[so].label });
          }
        }
        if (sfAdded.length || sfDeleted.length || sfRenamed.length) {
          result.subFieldChanges.push({
            parentId: tid, parentLabel: newFields[tid].label,
            added: sfAdded, deleted: sfDeleted, renamed: sfRenamed
          });
        }
      }

      // Compute summary
      var breaking = result.deleted.length + result.typeChanged.length;
      for (var ri = 0; ri < result.optionsChanged.length; ri++) {
        breaking += result.optionsChanged[ri].removedOptions.length;
      }
      for (var ri2 = 0; ri2 < result.subFieldChanges.length; ri2++) {
        breaking += result.subFieldChanges[ri2].deleted.length;
      }
      var total = result.added.length + result.deleted.length + result.renamed.length +
        result.typeChanged.length + result.optionsChanged.length +
        result.conditionsChanged.length + result.reordered.length;
      for (var ri3 = 0; ri3 < result.subFieldChanges.length; ri3++) {
        total += result.subFieldChanges[ri3].added.length +
          result.subFieldChanges[ri3].deleted.length + result.subFieldChanges[ri3].renamed.length;
      }
      result.summary = {
        totalChanges: total,
        breakingChanges: breaking,
        nonBreakingChanges: total - breaking
      };

      return result;
    },

    /** Extract ordered list of non-deleted field IDs from a fields array */
    _getFieldOrder: function (fields) {
      var order = [];
      var walk = function (arr) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i]._deleted) continue;
          order.push(arr[i].id);
          if (arr[i].type === 'group' && arr[i].children) walk(arr[i].children);
        }
      };
      walk(fields);
      return order;
    },

    /**
     * Heuristic: auto-suggest mapping rules based on deleted + added fields.
     */
    detectFieldCorrespondence: function (oldTpl, newTpl) {
      var suggestions = [];
      var diff = this.diffTemplates(oldTpl, newTpl);
      var deletedFields = diff.deleted;
      var addedFields = diff.added;

      // Try to match deleted → added by type + label similarity
      var usedAdded = {};
      for (var di = 0; di < deletedFields.length; di++) {
        var df = deletedFields[di];
        var bestMatch = null;
        var bestScore = 0;
        for (var ai = 0; ai < addedFields.length; ai++) {
          if (usedAdded[ai]) continue;
          var af = addedFields[ai];
          if (df.type !== af.type) continue;
          var score = this._labelSimilarity(df.label, af.label);
          if (score > 0.6 && score > bestScore) {
            bestScore = score;
            bestMatch = ai;
          }
        }
        if (bestMatch !== null) {
          usedAdded[bestMatch] = true;
          suggestions.push({
            type: 'field_merge',
            sourceFieldIds: [df.id],
            sourceLabels: [df.label],
            targetFieldId: addedFields[bestMatch].id,
            targetLabel: addedFields[bestMatch].label,
            mergeStrategy: 'concatenate',
            mergeOptions: { separator: ' ' }
          });
        }
      }

      // Enum rename suggestions from optionsChanged
      for (var oi = 0; oi < diff.optionsChanged.length; oi++) {
        var oc = diff.optionsChanged[oi];
        if (oc.removedOptions.length > 0 && oc.addedOptions.length > 0) {
          var mappings = [];
          var maxPairs = Math.min(oc.removedOptions.length, oc.addedOptions.length);
          for (var pi = 0; pi < maxPairs; pi++) {
            mappings.push({
              oldValue: oc.removedOptions[pi].value,
              oldLabel: oc.removedOptions[pi].label,
              newValue: oc.addedOptions[pi].value,
              newLabel: oc.addedOptions[pi].label
            });
          }
          if (mappings.length > 0) {
            suggestions.push({
              type: 'enum_rename',
              fieldId: oc.id,
              fieldLabel: oc.label,
              mappings: mappings
            });
          }
        }
        // Also suggest for renamed options
        if (oc.renamedOptions.length > 0) {
          var renameMappings = [];
          for (var ri = 0; ri < oc.renamedOptions.length; ri++) {
            renameMappings.push({
              oldValue: oc.renamedOptions[ri].oldValue,
              oldLabel: oc.renamedOptions[ri].oldLabel,
              newValue: oc.renamedOptions[ri].newValue,
              newLabel: oc.renamedOptions[ri].newLabel
            });
          }
          suggestions.push({
            type: 'enum_rename',
            fieldId: oc.id,
            fieldLabel: oc.label,
            mappings: renameMappings
          });
        }
      }

      // Attachment preserve suggestions for deleted attachment fields
      for (var di2 = 0; di2 < deletedFields.length; di2++) {
        if (deletedFields[di2].type === 'attachment') {
          suggestions.push({
            type: 'attachment_preserve',
            fieldId: deletedFields[di2].id,
            fieldLabel: deletedFields[di2].label,
            preserveAs: 'archive',
            migrateToFieldId: null
          });
        }
      }

      return suggestions;
    },

    /** Character bigram Jaccard similarity between two strings */
    _labelSimilarity: function (a, b) {
      if (!a || !b) return 0;
      var bigrams = function (s) {
        var set = {};
        for (var i = 0; i < s.length - 1; i++) set[s.substring(i, i + 2)] = true;
        return set;
      };
      var ba = bigrams(a);
      var bb = bigrams(b);
      var intersection = 0;
      for (var k in ba) if (bb[k]) intersection++;
      var union = 0;
      for (var k2 in ba) union++;
      for (var k3 in bb) if (!ba[k3]) union++;
      return union === 0 ? 0 : intersection / union;
    },

    /**
     * Apply migration rules to a single data record.
     */
    executeMigration: function (config, data, oldTpl, newTpl) {
      var migratedData = FB.util.deepClone(data);
      var appliedRules = [];
      var skippedRules = [];
      var errors = [];
      var warnings = [];

      try {
        var rules = config.rules || [];
        for (var i = 0; i < rules.length; i++) {
          var rule = rules[i];
          if (!rule.enabled) { skippedRules.push(rule.ruleId); continue; }

          try {
            if (rule.type === 'field_merge') {
              var parts = [];
              for (var si = 0; si < rule.sourceFieldIds.length; si++) {
                var sv = migratedData[rule.sourceFieldIds[si]];
                if (sv !== undefined && sv !== null && sv !== '') {
                  parts.push(String(sv));
                }
                delete migratedData[rule.sourceFieldIds[si]];
              }
              if (rule.mergeStrategy === 'concatenate') {
                var sep = (rule.mergeOptions && rule.mergeOptions.separator) || ' ';
                migratedData[rule.targetFieldId] = parts.join(sep);
              } else if (rule.mergeStrategy === 'take_first') {
                migratedData[rule.targetFieldId] = parts.length > 0 ? parts[0] : '';
              } else if (rule.mergeStrategy === 'take_last') {
                migratedData[rule.targetFieldId] = parts.length > 0 ? parts[parts.length - 1] : '';
              }
              appliedRules.push(rule.ruleId);

            } else if (rule.type === 'enum_rename') {
              var fieldVal = migratedData[rule.fieldId];
              if (fieldVal !== undefined && fieldVal !== null) {
                var mappingMap = {};
                for (var mi = 0; mi < rule.mappings.length; mi++) {
                  mappingMap[rule.mappings[mi].oldValue] = rule.mappings[mi].newValue;
                }
                if (Array.isArray(fieldVal)) {
                  // checkbox
                  for (var ci = 0; ci < fieldVal.length; ci++) {
                    if (mappingMap[fieldVal[ci]] !== undefined) fieldVal[ci] = mappingMap[fieldVal[ci]];
                  }
                } else {
                  // radio
                  if (mappingMap[fieldVal] !== undefined) {
                    migratedData[rule.fieldId] = mappingMap[fieldVal];
                  }
                }
              }
              appliedRules.push(rule.ruleId);

            } else if (rule.type === 'attachment_preserve') {
              var attachVal = migratedData[rule.fieldId];
              if (attachVal !== undefined && attachVal !== null && attachVal !== '') {
                if (rule.preserveAs === 'archive') {
                  migratedData['_archived_' + rule.fieldId] = attachVal;
                  warnings.push({ ruleId: rule.ruleId, message: '附件字段数据已保留为归档' });
                } else if (rule.preserveAs === 'migrate_to' && rule.migrateToFieldId) {
                  migratedData[rule.migrateToFieldId] = attachVal;
                }
              }
              appliedRules.push(rule.ruleId);
            }
          } catch (ruleErr) {
            errors.push({ ruleId: rule.ruleId, message: ruleErr.message });
          }
        }

        migratedData._migratedFrom = data._templateVersion || 0;
        migratedData._migratedTo = config.toVersion || 0;
        migratedData._migratedAt = FB.util.now();

        var logEntry = {
          logId: FB.util.uid(),
          templateId: config.templateId,
          fromVersion: config.fromVersion,
          toVersion: config.toVersion,
          recordId: data._recordId || 'unknown',
          status: errors.length > 0 ? 'failed' : 'success',
          error: errors.length > 0 ? errors[0].message : null,
          originalData: FB.util.deepClone(data),
          timestamp: FB.util.now()
        };
        FB.storage.appendMigrationLog(config.templateId, logEntry);

        return {
          success: errors.length === 0,
          recordId: data._recordId || 'unknown',
          fromVersion: config.fromVersion,
          toVersion: config.toVersion,
          migratedData: migratedData,
          appliedRules: appliedRules,
          skippedRules: skippedRules,
          errors: errors,
          warnings: warnings
        };
      } catch (e) {
        var failEntry = {
          logId: FB.util.uid(),
          templateId: config.templateId,
          fromVersion: config.fromVersion,
          toVersion: config.toVersion,
          recordId: data._recordId || 'unknown',
          status: 'failed',
          error: e.message,
          originalData: FB.util.deepClone(data),
          timestamp: FB.util.now()
        };
        FB.storage.appendMigrationLog(config.templateId, failEntry);

        return {
          success: false,
          recordId: data._recordId || 'unknown',
          fromVersion: config.fromVersion,
          toVersion: config.toVersion,
          migratedData: null,
          appliedRules: appliedRules,
          skippedRules: skippedRules,
          errors: [{ ruleId: null, message: e.message }],
          warnings: warnings
        };
      }
    },

    /**
     * Rollback: return the pre-migration snapshot from a log entry.
     */
    rollbackMigration: function (logEntry) {
      return FB.util.deepClone(logEntry.originalData);
    },

    /**
     * Chain-apply all migration configs from data._templateVersion up to targetVersion.
     */
    applyMigrationView: function (data, templateId, targetVersion) {
      var versions = FB.storage.getTemplateVersions(templateId);
      var fromVer = data._templateVersion || 1;
      if (fromVer >= targetVersion) return FB.util.deepClone(data);

      var currentData = FB.util.deepClone(data);
      for (var i = 0; i < versions.length; i++) {
        var ver = versions[i].version;
        if (ver <= fromVer) continue;
        if (ver > targetVersion) break;

        var config = FB.storage.getMigrationConfig(templateId, ver);
        if (!config) continue; // No migration config for this version, skip

        var prevTpl = FB.storage.getTemplateVersion(templateId, ver - 1);
        var curTpl = versions[i];
        var result = this.executeMigration(config, currentData, prevTpl, curTpl);
        if (!result.success) {
          return {
            _migrationFailed: true,
            error: result.errors.length > 0 ? result.errors[0].message : 'Migration failed',
            failedAtVersion: ver,
            originalData: FB.util.deepClone(data)
          };
        }
        currentData = result.migratedData;
      }
      return currentData;
    }
  };

  /* =========================================================
     10. Impact Assessment
     ========================================================= */
  FB.impact = {
    /**
     * Assess the impact of template changes on historical data.
     */
    assess: function (diff, templateId) {
      var allRecords = FB.storage.getFormDataAll(templateId);
      var submittedRecords = [];
      for (var i = 0; i < allRecords.length; i++) {
        if (!allRecords[i].data._draft) submittedRecords.push(allRecords[i]);
      }

      var changes = [];
      var allAffectedIds = {};

      // Deleted fields
      for (var di = 0; di < diff.deleted.length; di++) {
        var d = diff.deleted[di];
        var affected = this._countAffected(submittedRecords, d.id);
        var sample = this._getSample(submittedRecords, d.id, 3);
        for (var si = 0; si < affected.recordIds.length; si++) allAffectedIds[affected.recordIds[si]] = true;
        changes.push({
          changeType: 'deleted',
          fieldId: d.id,
          fieldLabel: d.label,
          severity: affected.count > 0 ? 'high' : 'info',
          affectedRecords: affected.count,
          affectedSample: sample,
          description: '字段「' + d.label + '」将被删除，' + affected.count + ' 条历史数据中该字段值将归档显示',
          recommendation: affected.count > 0 ? '建议配置字段合并规则，将旧数据映射到新字段' : ''
        });
      }

      // Type changed fields
      for (var ti = 0; ti < diff.typeChanged.length; ti++) {
        var tc = diff.typeChanged[ti];
        var tAffected = this._countAffected(submittedRecords, tc.id);
        var tSample = this._getSample(submittedRecords, tc.id, 3);
        for (var tsi = 0; tsi < tAffected.recordIds.length; tsi++) allAffectedIds[tAffected.recordIds[tsi]] = true;
        changes.push({
          changeType: 'typeChanged',
          fieldId: tc.id,
          fieldLabel: diff.typeChanged[ti].field ? diff.typeChanged[ti].field.label : tc.id,
          severity: tAffected.count > 0 ? 'high' : 'info',
          affectedRecords: tAffected.count,
          affectedSample: tSample,
          description: '字段类型从「' + tc.oldType + '」变更为「' + tc.newType + '」，' + tAffected.count + ' 条数据格式可能不兼容',
          recommendation: tAffected.count > 0 ? '建议检查历史数据类型兼容性' : ''
        });
      }

      // Options changed
      for (var oi = 0; oi < diff.optionsChanged.length; oi++) {
        var oc = diff.optionsChanged[oi];
        for (var roi = 0; roi < oc.removedOptions.length; roi++) {
          var optAffected = this._countByOptionValue(submittedRecords, oc.id, oc.removedOptions[roi].value);
          for (var osi = 0; osi < optAffected.recordIds.length; osi++) allAffectedIds[optAffected.recordIds[osi]] = true;
          changes.push({
            changeType: 'optionsRemoved',
            fieldId: oc.id,
            fieldLabel: oc.label,
            severity: optAffected.count > 0 ? 'medium' : 'info',
            affectedRecords: optAffected.count,
            affectedSample: optAffected.samples,
            description: '字段「' + oc.label + '」移除了选项「' + oc.removedOptions[roi].label + '」，' + optAffected.count + ' 条数据使用该选项',
            recommendation: optAffected.count > 0 ? '建议配置枚举值重命名规则' : ''
          });
        }
      }

      // Renamed fields
      for (var ri = 0; ri < diff.renamed.length; ri++) {
        var rn = diff.renamed[ri];
        var rnAffected = this._countAffected(submittedRecords, rn.id);
        for (var rsi = 0; rsi < rnAffected.recordIds.length; rsi++) allAffectedIds[rnAffected.recordIds[rsi]] = true;
        changes.push({
          changeType: 'renamed',
          fieldId: rn.id,
          fieldLabel: rn.newLabel,
          severity: 'low',
          affectedRecords: submittedRecords.length,
          affectedSample: [],
          description: '字段标签从「' + rn.oldLabel + '」重命名为「' + rn.newLabel + '」',
          recommendation: ''
        });
      }

      // Conditions changed
      for (var ci = 0; ci < diff.conditionsChanged.length; ci++) {
        var cc = diff.conditionsChanged[ci];
        changes.push({
          changeType: 'conditionsChanged',
          fieldId: cc.id,
          fieldLabel: cc.label,
          severity: 'low',
          affectedRecords: submittedRecords.length,
          affectedSample: [],
          description: '字段「' + cc.label + '」的条件显隐规则已变更',
          recommendation: ''
        });
      }

      // Reordered (info only)
      if (diff.reordered.length > 0) {
        changes.push({
          changeType: 'reordered',
          fieldId: null,
          fieldLabel: '',
          severity: 'info',
          affectedRecords: 0,
          affectedSample: [],
          description: diff.reordered.length + ' 个字段的位置已调整',
          recommendation: ''
        });
      }

      // Added fields (info)
      if (diff.added.length > 0) {
        changes.push({
          changeType: 'added',
          fieldId: null,
          fieldLabel: '',
          severity: 'info',
          affectedRecords: 0,
          affectedSample: [],
          description: '新增了 ' + diff.added.length + ' 个字段，历史数据中这些字段将为空',
          recommendation: ''
        });
      }

      // SubField changes
      for (var sfi = 0; sfi < diff.subFieldChanges.length; sfi++) {
        var sfc = diff.subFieldChanges[sfi];
        for (var sdi = 0; sdi < sfc.deleted.length; sdi++) {
          changes.push({
            changeType: 'subFieldDeleted',
            fieldId: sfc.deleted[sdi].id,
            fieldLabel: sfc.deleted[sdi].label,
            severity: 'medium',
            affectedRecords: submittedRecords.length,
            affectedSample: [],
            description: '明细表「' + sfc.parentLabel + '」中的列「' + sfc.deleted[sdi].label + '」已删除',
            recommendation: '建议配置子字段映射规则'
          });
        }
      }

      // Compute totals
      var totalHigh = 0, totalMedium = 0, totalLow = 0;
      for (var xi = 0; xi < changes.length; xi++) {
        if (changes[xi].severity === 'high') totalHigh++;
        else if (changes[xi].severity === 'medium') totalMedium++;
        else if (changes[xi].severity === 'low') totalLow++;
      }
      var affectedIdList = [];
      for (var aid in allAffectedIds) affectedIdList.push(aid);

      return {
        changes: changes,
        totalAffectedRecords: affectedIdList.length,
        totalHighSeverity: totalHigh,
        totalMediumSeverity: totalMedium,
        totalLowSeverity: totalLow,
        hasBreakingChanges: diff.summary.breakingChanges > 0
      };
    },

    _countAffected: function (records, fieldId) {
      var count = 0;
      var ids = [];
      for (var i = 0; i < records.length; i++) {
        var v = records[i].data[fieldId];
        if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
          count++;
          ids.push(records[i].recordId);
        }
      }
      return { count: count, recordIds: ids };
    },

    _getSample: function (records, fieldId, maxCount) {
      var samples = [];
      for (var i = 0; i < records.length && samples.length < maxCount; i++) {
        var v = records[i].data[fieldId];
        if (v !== undefined && v !== null && v !== '') {
          var display = typeof v === 'object' ? JSON.stringify(v) : String(v);
          if (display.length > 50) display = display.substring(0, 50) + '...';
          samples.push({ recordId: records[i].recordId, value: display });
        }
      }
      return samples;
    },

    _countByOptionValue: function (records, fieldId, optionValue) {
      var count = 0;
      var ids = [];
      var samples = [];
      for (var i = 0; i < records.length; i++) {
        var v = records[i].data[fieldId];
        var match = false;
        if (Array.isArray(v)) {
          for (var j = 0; j < v.length; j++) {
            if (v[j] === optionValue) { match = true; break; }
          }
        } else if (v === optionValue) {
          match = true;
        }
        if (match) {
          count++;
          ids.push(records[i].recordId);
          if (samples.length < 3) {
            samples.push({ recordId: records[i].recordId, value: String(v) });
          }
        }
      }
      return { count: count, recordIds: ids, samples: samples };
    },

    /**
     * Generate an HTML report of the impact assessment.
     */
    generateReport: function (impactResult, diff) {
      var html = '';
      // Summary banner
      var bannerClass = impactResult.hasBreakingChanges ? 'impact-summary-banner has-breaking' : 'impact-summary-banner no-breaking';
      html += '<div class="' + bannerClass + '">';
      html += '<strong>' + diff.summary.totalChanges + ' 项变更</strong> | ';
      html += impactResult.totalAffectedRecords + ' 条数据受影响 | ';
      html += impactResult.totalHighSeverity + ' 项高风险';
      if (impactResult.totalMediumSeverity > 0) html += ' | ' + impactResult.totalMediumSeverity + ' 项中风险';
      html += '</div>';

      // Change list
      html += '<div class="impact-change-list">';
      for (var i = 0; i < impactResult.changes.length; i++) {
        var c = impactResult.changes[i];
        html += '<div class="impact-change-card severity-' + c.severity + '">';
        html += '<div class="change-header">';
        var typeLabels = {
          deleted: '删除', typeChanged: '类型变更', optionsRemoved: '选项移除',
          renamed: '重命名', conditionsChanged: '条件变更', reordered: '重排',
          added: '新增', subFieldDeleted: '子字段删除'
        };
        html += '<span class="change-type-badge">' + (typeLabels[c.changeType] || c.changeType) + '</span>';
        if (c.fieldLabel) html += ' <strong>' + FB.util.escapeHtml(c.fieldLabel) + '</strong>';
        html += ' <span style="color:#999;font-size:11px;">' + c.affectedRecords + ' 条受影响</span>';
        html += '</div>';
        html += '<div class="change-description">' + FB.util.escapeHtml(c.description) + '</div>';
        if (c.recommendation) {
          html += '<div class="change-description" style="color:var(--primary);">💡 ' + FB.util.escapeHtml(c.recommendation) + '</div>';
        }
        if (c.affectedSample && c.affectedSample.length > 0) {
          html += '<div class="change-sample">样本: ';
          for (var si = 0; si < c.affectedSample.length; si++) {
            html += FB.util.escapeHtml(c.affectedSample[si].recordId.slice(0, 8)) + '="' +
              FB.util.escapeHtml(c.affectedSample[si].value) + '"';
            if (si < c.affectedSample.length - 1) html += ', ';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }
  };

})();
