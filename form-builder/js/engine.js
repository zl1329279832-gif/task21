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
    now: function () { return new Date().toISOString(); }
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
    publishTemplate: function (tpl, migrationRuleSet) {
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
      // Save migration rules if provided (version >= 2)
      if (migrationRuleSet && tpl.version >= 2) {
        this.saveMigrationRules(tpl.id, tpl.version - 1, tpl.version, migrationRuleSet);
      }
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
    // Migration rule storage
    saveMigrationRules: function (tplId, fromVer, toVer, ruleSet) {
      var key = 'migration_' + tplId + '_' + fromVer + '_' + toVer;
      ruleSet.templateId = tplId;
      ruleSet.fromVersion = fromVer;
      ruleSet.toVersion = toVer;
      if (!ruleSet.createdAt) ruleSet.createdAt = FB.util.now();
      this.set(key, ruleSet);
    },
    getMigrationRules: function (tplId, fromVer, toVer) {
      return this.get('migration_' + tplId + '_' + fromVer + '_' + toVer);
    },
    getAllMigrationRules: function (tplId) {
      var prefix = 'migration_' + tplId + '_';
      var allKeys = this.keys();
      var result = [];
      for (var i = 0; i < allKeys.length; i++) {
        if (allKeys[i].indexOf(prefix) === 0) {
          var rs = this.get(allKeys[i]);
          if (rs) result.push(rs);
        }
      }
      return result;
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
    isFieldHidden: function (field, values, allFields) {
      if (!field.conditions || field.conditions.length === 0) return false;
      for (var i = 0; i < field.conditions.length; i++) {
        if (!this._evalCondition(field.conditions[i], values)) return true;
      }
      return false;
    },

    _evalCondition: function (cond, values) {
      // Guard: if referenced field doesn't exist in values at all, treat as false
      if (cond.field && !(cond.field in values)) {
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
    undo: function (currentState) {
      if (this._stack.length === 0) return null;
      var prev = this._stack[this._stack.length - 1];
      // Detect boundary marker
      if (prev && prev._boundary) {
        return { _crossedBoundary: true, _label: prev._label };
      }
      this._stack.pop();
      this._redoStack.push(FB.util.deepClone(currentState));
      this._notify();
      return prev;
    },
    /** Force pop past a boundary marker (called after user confirms) */
    popBoundary: function (currentState) {
      if (this._stack.length === 0) return null;
      var top = this._stack[this._stack.length - 1];
      if (top && top._boundary) {
        this._stack.pop(); // remove boundary marker
      }
      if (this._stack.length === 0) return null;
      var prev = this._stack.pop();
      this._redoStack.push(FB.util.deepClone(currentState));
      this._notify();
      return prev;
    },
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
      if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['无效的 JSON 对象'], template: null };
      }
      if (!data.name || typeof data.name !== 'string')
        errors.push('缺少模板名称 (name)');
      if (!data.fields || !Array.isArray(data.fields))
        errors.push('缺少字段列表 (fields) 或格式不正确');
      else {
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
        }
      }
      // Validate embedded migration rules if present
      if (data._migrationRules) {
        if (!Array.isArray(data._migrationRules)) {
          errors.push('_migrationRules 必须是数组');
        } else {
          for (var mi = 0; mi < data._migrationRules.length; mi++) {
            var mr = data._migrationRules[mi];
            if (!mr.fromVersion || !mr.toVersion) {
              errors.push('迁移规则 [' + mi + '] 缺少 fromVersion 或 toVersion');
            }
            if (!mr.rules || !Array.isArray(mr.rules)) {
              errors.push('迁移规则 [' + mi + '] 缺少 rules 数组');
            }
          }
        }
      }
      return { valid: errors.length === 0, errors: errors, template: errors.length === 0 ? data : null };
    },

    exportDataMigrated: function (template, data, migrationMeta) {
      return JSON.stringify({
        _system: 'gov-form-builder',
        _exportVersion: 2,
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        data: data,
        exportedAt: FB.util.now(),
        _migration: migrationMeta || null
      }, null, 2);
    },

    exportTemplate: function (template) {
      var clone = FB.util.deepClone(template);
      clone._exportedAt = FB.util.now();
      clone._system = 'gov-form-builder';
      clone._exportVersion = 2;
      // Include migration rules if any
      var allRules = FB.storage.getAllMigrationRules(template.id);
      if (allRules.length > 0) {
        clone._migrationRules = allRules;
      }
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
     7.5 Migration - Cross-version diff, rules, migration chain
     ========================================================= */
  FB.migration = {
    /**
     * Build a flat index of all fields (including group children and table subFields).
     * Returns { id: { field, index, parentId, isSubField } }
     */
    _buildFieldIndex: function (fields, parentId, result, counter) {
      if (!result) result = {};
      if (!counter) counter = { n: 0 };
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        result[f.id] = { field: f, index: counter.n++, parentId: parentId || null, isSubField: false };
        if (f.type === 'table' && f.subFields) {
          for (var j = 0; j < f.subFields.length; j++) {
            var sf = f.subFields[j];
            result[sf.id] = { field: sf, index: counter.n++, parentId: f.id, isSubField: true };
          }
        }
        if (f.type === 'group' && f.children) {
          this._buildFieldIndex(f.children, f.id, result, counter);
        }
      }
      return result;
    },

    /** Compare two option arrays by value key. Returns { added, removed, renamed } */
    _diffOptions: function (oldOpts, newOpts) {
      oldOpts = oldOpts || [];
      newOpts = newOpts || [];
      var oldMap = {};
      for (var i = 0; i < oldOpts.length; i++) oldMap[oldOpts[i].value] = oldOpts[i];
      var newMap = {};
      for (var j = 0; j < newOpts.length; j++) newMap[newOpts[j].value] = newOpts[j];

      var added = [];
      var removed = [];
      var renamed = [];
      for (var nk in newMap) {
        if (!oldMap[nk]) added.push(newMap[nk]);
        else if (oldMap[nk].label !== newMap[nk].label) {
          renamed.push({ value: nk, oldLabel: oldMap[nk].label, newLabel: newMap[nk].label });
        }
      }
      for (var ok in oldMap) {
        if (!newMap[ok]) removed.push(oldMap[ok]);
      }
      return { added: added, removed: removed, renamed: renamed };
    },

    /** Deep compare two condition arrays */
    _diffConditions: function (oldConds, newConds) {
      return JSON.stringify(oldConds || []) !== JSON.stringify(newConds || []);
    },

    /**
     * Compare two template versions and produce a DiffReport.
     */
    diff: function (oldTpl, newTpl) {
      var oldIdx = this._buildFieldIndex(oldTpl.fields);
      var newIdx = this._buildFieldIndex(newTpl.fields);

      var report = {
        added: [],
        deleted: [],
        renamed: [],
        typeChanged: [],
        optionsChanged: [],
        conditionsChanged: [],
        reordered: []
      };

      // Detect added, renamed, typeChanged, optionsChanged, conditionsChanged
      for (var nId in newIdx) {
        var ne = newIdx[nId];
        if (!oldIdx[nId]) {
          // New field (only if not soft-deleted)
          if (!ne.field._deleted) {
            report.added.push({ field: ne.field });
          }
        } else {
          var oe = oldIdx[nId];
          var of_ = oe.field;
          var nf = ne.field;

          // Deletion state changed
          if (!of_._deleted && nf._deleted) {
            report.deleted.push({ field: nf });
            continue;
          }
          if (of_._deleted && !nf._deleted) {
            report.added.push({ field: nf });
            continue;
          }
          if (nf._deleted) continue;

          // Rename
          if (of_.label !== nf.label) {
            report.renamed.push({ fieldId: nf.id, oldLabel: of_.label, newLabel: nf.label });
          }
          // Type change
          if (of_.type !== nf.type) {
            report.typeChanged.push({ fieldId: nf.id, label: nf.label, oldType: of_.type, newType: nf.type });
          }
          // Options change (radio/checkbox)
          if ((nf.type === 'radio' || nf.type === 'checkbox') && of_.type === nf.type) {
            var optDiff = this._diffOptions(of_.options, nf.options);
            if (optDiff.added.length > 0 || optDiff.removed.length > 0 || optDiff.renamed.length > 0) {
              report.optionsChanged.push({
                fieldId: nf.id,
                label: nf.label,
                addedOpts: optDiff.added,
                removedOpts: optDiff.removed,
                renamedOpts: optDiff.renamed
              });
            }
          }
          // Conditions change
          if (this._diffConditions(of_.conditions, nf.conditions)) {
            report.conditionsChanged.push({
              fieldId: nf.id,
              label: nf.label,
              oldConditions: of_.conditions || [],
              newConditions: nf.conditions || []
            });
          }
          // Reorder (only for non-subfields at same parent level)
          if (!ne.isSubField && !oe.isSubField && oe.index !== ne.index) {
            report.reordered.push({
              fieldId: nf.id,
              label: nf.label,
              oldIndex: oe.index,
              newIndex: ne.index
            });
          }
        }
      }

      // Detect deleted (in old but not in new)
      for (var oId in oldIdx) {
        if (!newIdx[oId] && !oldIdx[oId].field._deleted) {
          report.deleted.push({ field: oldIdx[oId].field });
        }
      }

      return report;
    },

    /** Check if a diff report has any changes */
    hasChanges: function (report) {
      return report.added.length > 0 || report.deleted.length > 0 ||
        report.renamed.length > 0 || report.typeChanged.length > 0 ||
        report.optionsChanged.length > 0 || report.conditionsChanged.length > 0 ||
        report.reordered.length > 0;
    },

    /**
     * Auto-generate default migration rules from a diff report.
     */
    generateDefaultRules: function (diffReport, oldTpl, newTpl) {
      var rules = [];

      // Deleted fields -> softDelete or preserveAttachment
      for (var i = 0; i < diffReport.deleted.length; i++) {
        var df = diffReport.deleted[i].field;
        if (df.type === 'attachment') {
          rules.push({ type: 'preserveAttachment', fieldId: df.id });
        } else {
          rules.push({ type: 'softDelete', fieldId: df.id, reason: '字段已删除' });
        }
      }

      // Options renamed -> enumRename
      for (var j = 0; j < diffReport.optionsChanged.length; j++) {
        var oc = diffReport.optionsChanged[j];
        if (oc.renamedOpts.length > 0) {
          var mappings = [];
          for (var k = 0; k < oc.renamedOpts.length; k++) {
            mappings.push({ oldValue: oc.renamedOpts[k].value, newValue: oc.renamedOpts[k].value });
          }
          rules.push({ type: 'enumRename', fieldId: oc.fieldId, mappings: mappings });
        }
      }

      // Type changed -> fieldMap with transform
      for (var m = 0; m < diffReport.typeChanged.length; m++) {
        var tc = diffReport.typeChanged[m];
        var transform = null;
        if (tc.oldType === 'number' && tc.newType === 'text') transform = 'toString';
        else if (tc.oldType === 'text' && tc.newType === 'number') transform = 'toNumber';
        rules.push({
          type: 'fieldMap',
          sourceField: tc.fieldId,
          targetField: tc.fieldId,
          transform: transform
        });
      }

      return {
        templateId: newTpl.id,
        fromVersion: oldTpl.version,
        toVersion: newTpl.version || 0,
        createdAt: FB.util.now(),
        rules: rules
      };
    },

    /**
     * Apply migration rules to transform old data to new schema.
     * Returns { success: true, data } or { success: false, error, originalData }
     */
    applyRules: function (ruleSet, oldData, newTemplate) {
      try {
        var data = FB.util.deepClone(oldData);
        var rules = ruleSet.rules || [];

        for (var i = 0; i < rules.length; i++) {
          var rule = rules[i];
          switch (rule.type) {
            case 'fieldMap':
              if (data[rule.sourceField] !== undefined) {
                var val = data[rule.sourceField];
                if (rule.transform === 'toString') val = String(val);
                else if (rule.transform === 'toNumber') val = Number(val) || 0;
                data[rule.targetField] = val;
                if (rule.sourceField !== rule.targetField) {
                  delete data[rule.sourceField];
                }
              }
              break;

            case 'merge':
              var parts = [];
              var sources = rule.sourceFields || [];
              for (var si = 0; si < sources.length; si++) {
                if (data[sources[si]] !== undefined && data[sources[si]] !== '') {
                  parts.push(String(data[sources[si]]));
                }
                delete data[sources[si]];
              }
              data[rule.targetField] = parts.join(rule.separator || '; ');
              break;

            case 'enumRename':
              if (data[rule.fieldId] !== undefined && rule.mappings) {
                var mapLookup = {};
                for (var mi = 0; mi < rule.mappings.length; mi++) {
                  mapLookup[rule.mappings[mi].oldValue] = rule.mappings[mi].newValue;
                }
                if (Array.isArray(data[rule.fieldId])) {
                  // Checkbox (array)
                  for (var ai = 0; ai < data[rule.fieldId].length; ai++) {
                    if (mapLookup[data[rule.fieldId][ai]] !== undefined) {
                      data[rule.fieldId][ai] = mapLookup[data[rule.fieldId][ai]];
                    }
                  }
                } else {
                  // Radio (scalar)
                  if (mapLookup[data[rule.fieldId]] !== undefined) {
                    data[rule.fieldId] = mapLookup[data[rule.fieldId]];
                  }
                }
              }
              break;

            case 'preserveAttachment':
              // Keep the value as-is; just ensure it's carried over
              break;

            case 'softDelete':
              if (data[rule.fieldId] !== undefined) {
                if (!data._archivedFields) data._archivedFields = {};
                data._archivedFields[rule.fieldId] = {
                  value: data[rule.fieldId],
                  reason: rule.reason || '',
                  archivedAt: FB.util.now()
                };
              }
              break;
          }
        }

        // Fill defaults for new fields
        data = FB.compatibility.mergeDataWithTemplate(newTemplate, data);
        data._templateVersion = newTemplate.version;

        // Preserve metadata from original
        for (var key in oldData) {
          if (key.charAt(0) === '_' && key !== '_templateVersion' && data[key] === undefined) {
            data[key] = oldData[key];
          }
        }

        return { success: true, data: data };
      } catch (e) {
        return { success: false, error: e.message || String(e), originalData: oldData };
      }
    },

    /**
     * Validate that a rule set is internally consistent.
     */
    validateRules: function (ruleSet, oldTpl, newTpl) {
      var errors = [];
      var rules = ruleSet.rules || [];
      var oldIdx = this._buildFieldIndex(oldTpl.fields);
      var newIdx = this._buildFieldIndex(newTpl.fields);
      var targetFields = {};

      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        switch (rule.type) {
          case 'fieldMap':
            if (rule.sourceField && !oldIdx[rule.sourceField]) {
              errors.push('规则 ' + (i + 1) + ': 源字段 "' + rule.sourceField + '" 不存在于旧模板');
            }
            if (rule.targetField && !newIdx[rule.targetField]) {
              errors.push('规则 ' + (i + 1) + ': 目标字段 "' + rule.targetField + '" 不存在于新模板');
            }
            if (rule.targetField) {
              if (targetFields[rule.targetField]) {
                errors.push('规则 ' + (i + 1) + ': 目标字段 "' + rule.targetField + '" 已被其他规则映射');
              }
              targetFields[rule.targetField] = true;
            }
            break;

          case 'merge':
            var sources = rule.sourceFields || [];
            for (var si = 0; si < sources.length; si++) {
              if (!oldIdx[sources[si]]) {
                errors.push('规则 ' + (i + 1) + ': 源字段 "' + sources[si] + '" 不存在于旧模板');
              }
            }
            if (rule.targetField && !newIdx[rule.targetField]) {
              errors.push('规则 ' + (i + 1) + ': 目标字段 "' + rule.targetField + '" 不存在于新模板');
            }
            if (rule.targetField) {
              if (targetFields[rule.targetField]) {
                errors.push('规则 ' + (i + 1) + ': 目标字段 "' + rule.targetField + '" 已被其他规则映射');
              }
              targetFields[rule.targetField] = true;
            }
            break;

          case 'enumRename':
            if (rule.fieldId && !oldIdx[rule.fieldId] && !newIdx[rule.fieldId]) {
              errors.push('规则 ' + (i + 1) + ': 字段 "' + rule.fieldId + '" 不存在');
            }
            break;

          case 'preserveAttachment':
          case 'softDelete':
            if (rule.fieldId && !oldIdx[rule.fieldId]) {
              errors.push('规则 ' + (i + 1) + ': 字段 "' + rule.fieldId + '" 不存在于旧模板');
            }
            break;
        }
      }

      return { valid: errors.length === 0, errors: errors };
    },

    /**
     * Build a chain of migration rule sets from fromVer to toVer.
     */
    buildMigrationChain: function (templateId, fromVer, toVer) {
      if (fromVer >= toVer) return { complete: true, chain: [] };
      var chain = [];
      var missingSteps = [];
      for (var v = fromVer; v < toVer; v++) {
        var rs = FB.storage.getMigrationRules(templateId, v, v + 1);
        if (rs) {
          chain.push(rs);
        } else {
          missingSteps.push({ from: v, to: v + 1 });
        }
      }
      if (missingSteps.length > 0) {
        return { complete: false, chain: chain, missingSteps: missingSteps };
      }
      return { complete: true, chain: chain };
    },

    /**
     * Migrate a data record through a chain of version transitions.
     * Returns { success, data } or { success: false, error, step, originalData }
     */
    migrateData: function (templateId, data, targetVersion) {
      var currentVer = data._templateVersion || 1;
      if (currentVer >= targetVersion) {
        return { success: true, data: FB.util.deepClone(data) };
      }

      var chainResult = this.buildMigrationChain(templateId, currentVer, targetVersion);
      if (!chainResult.complete) {
        return {
          success: false,
          error: '缺少迁移规则: ' + chainResult.missingSteps.map(function (s) {
            return 'v' + s.from + ' -> v' + s.to;
          }).join(', '),
          originalData: data
        };
      }

      var currentData = FB.util.deepClone(data);
      for (var i = 0; i < chainResult.chain.length; i++) {
        var rs = chainResult.chain[i];
        var stepTpl = FB.storage.getTemplateVersion(templateId, rs.toVersion);
        if (!stepTpl) {
          return {
            success: false,
            error: '模板版本 v' + rs.toVersion + ' 不存在',
            step: i + 1,
            originalData: data
          };
        }
        var result = this.applyRules(rs, currentData, stepTpl);
        if (!result.success) {
          return {
            success: false,
            error: '步骤 ' + (i + 1) + ' (v' + rs.fromVersion + '->v' + rs.toVersion + ') 失败: ' + result.error,
            step: i + 1,
            originalData: data
          };
        }
        currentData = result.data;
      }

      return { success: true, data: currentData };
    }
  };

  /* =========================================================
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

})();
