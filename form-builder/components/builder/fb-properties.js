// Properties panel - right side field configuration editor
import { eventBus } from '../../core/event-bus.js';
import { fieldRegistry } from '../../core/field-registry.js';
import { generateId } from '../../utils/id-generator.js';

export class FBProperties extends HTMLElement {
  _fieldDef = null;
  _activeTab = 'basic';
  _onChange = null;

  connectedCallback() {
    this.classList.add('builder-properties');
    this._renderEmpty();

    eventBus.on('field:selected', ({ fieldId }) => {
      // The parent (fb-app) will call showField with the full fieldDef
    });
  }

  setChangeHandler(handler) {
    this._onChange = handler;
  }

  showField(fieldDef) {
    this._fieldDef = fieldDef;
    this._activeTab = 'basic';
    this._render();
  }

  clear() {
    this._fieldDef = null;
    this._renderEmpty();
  }

  refresh(fieldDef) {
    this._fieldDef = fieldDef;
    this._render();
  }

  _renderEmpty() {
    this.innerHTML = `
      <div class="properties-header">属性配置</div>
      <div class="properties-body">
        <div class="properties-empty">
          <div style="font-size:32px;margin-bottom:8px;color:#ddd">⚙</div>
          <div class="text-muted">选择字段以编辑属性</div>
        </div>
      </div>`;
  }

  _render() {
    const f = this._fieldDef;
    if (!f) return this._renderEmpty();

    const typeDef = fieldRegistry.getDefinition(f.type);
    this.innerHTML = `
      <div class="properties-header">
        <span>${fieldRegistry.getIcon(f.type)} ${fieldRegistry.getLabel(f.type)}</span>
        <span class="text-sm text-muted">${f.fieldId}</span>
      </div>
      <div class="properties-tabs">
        <div class="properties-tab ${this._activeTab === 'basic' ? 'active' : ''}" data-tab="basic">基础</div>
        <div class="properties-tab ${this._activeTab === 'validation' ? 'active' : ''}" data-tab="validation">校验</div>
        <div class="properties-tab ${this._activeTab === 'advanced' ? 'active' : ''}" data-tab="advanced">高级</div>
      </div>
      <div class="properties-body">
        ${this._renderTabContent()}
      </div>`;

    this._bindEvents();
  }

  _renderTabContent() {
    switch (this._activeTab) {
      case 'basic': return this._renderBasicTab();
      case 'validation': return this._renderValidationTab();
      case 'advanced': return this._renderAdvancedTab();
      default: return '';
    }
  }

  _renderBasicTab() {
    const f = this._fieldDef;
    const config = f.config || {};
    let html = `
      <div class="prop-section">
        <div class="prop-section-title">基本信息</div>
        <div class="form-group">
          <label class="form-label">标签名称</label>
          <input class="form-input" data-prop="label" value="${this._esc(f.label)}">
        </div>`;

    // Placeholder for text/number
    if (['text', 'number'].includes(f.type)) {
      html += `
        <div class="form-group">
          <label class="form-label">占位提示</label>
          <input class="form-input" data-prop="config.placeholder" value="${this._esc(config.placeholder || '')}">
        </div>`;
    }

    // Default value (simple types)
    if (!['detailTable', 'groupDesc', 'attachment', 'addressCascade'].includes(f.type)) {
      html += `
        <div class="form-group">
          <label class="form-label">默认值</label>
          <input class="form-input" data-prop="defaultValue" value="${this._esc(f.defaultValue || '')}">
        </div>`;
    }

    // Description for groupDesc
    if (f.type === 'groupDesc') {
      html += `
        <div class="form-group">
          <label class="form-label">说明文字</label>
          <textarea class="form-input" data-prop="config.description" rows="3">${this._esc(config.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-check">
            <input type="checkbox" data-prop="config.collapsible" ${config.collapsible ? 'checked' : ''}>
            <span>可折叠</span>
          </label>
        </div>`;
    }

    html += `</div>`;

    // Options editor for radio/checkbox
    if (f.type === 'radio' || f.type === 'checkbox') {
      html += this._renderOptionsEditor();
    }

    // Columns editor for detailTable
    if (f.type === 'detailTable') {
      html += this._renderColumnsEditor();
    }

    // Address config
    if (f.type === 'addressCascade') {
      html += `
        <div class="prop-section">
          <div class="prop-section-title">地址配置</div>
          <div class="form-group">
            <label class="form-label">级联层级</label>
            <select class="form-input" data-prop="config.levels">
              <option value="1" ${config.levels === 1 ? 'selected' : ''}>省</option>
              <option value="2" ${config.levels === 2 ? 'selected' : ''}>省/市</option>
              <option value="3" ${config.levels === 3 ? 'selected' : ''}>省/市/区</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-check">
              <input type="checkbox" data-prop="config.showDetail" ${config.showDetail !== false ? 'checked' : ''}>
              <span>显示详细地址</span>
            </label>
          </div>
        </div>`;
    }

    return html;
  }

  _renderOptionsEditor() {
    const options = this._fieldDef.options || [];
    let html = `<div class="prop-section">
      <div class="prop-section-title">选项列表</div>
      <div class="options-list" id="optionsList">`;
    options.forEach((opt, i) => {
      html += `<div class="option-item" data-opt-index="${i}">
        <input class="form-input" data-opt-label="${i}" value="${this._esc(opt.label)}" placeholder="选项名称">
        <button class="btn-remove-opt" data-remove-opt="${i}" title="删除">&times;</button>
      </div>`;
    });
    html += `</div>
      <button class="btn btn-default mt-sm" id="btnAddOption">+ 添加选项</button>
    </div>`;
    return html;
  }

  _renderColumnsEditor() {
    const columns = this._fieldDef.columns || [];
    let html = `<div class="prop-section">
      <div class="prop-section-title">表格列配置</div>`;
    columns.forEach((col, i) => {
      html += `<div style="padding:8px;border:1px solid var(--border-light);border-radius:4px;margin-bottom:8px;">
        <div class="form-group">
          <label class="form-label">列${i + 1} 名称</label>
          <input class="form-input" data-col-label="${i}" value="${this._esc(col.label)}">
        </div>
        <div class="form-group">
          <label class="form-label">类型</label>
          <select class="form-input" data-col-type="${i}">
            <option value="text" ${col.type === 'text' ? 'selected' : ''}>文本</option>
            <option value="number" ${col.type === 'number' ? 'selected' : ''}>数字</option>
            <option value="date" ${col.type === 'date' ? 'selected' : ''}>日期</option>
          </select>
        </div>
        <div class="flex items-center justify-between">
          <label class="form-check">
            <input type="checkbox" data-col-required="${i}" ${col.config?.required ? 'checked' : ''}>
            <span>必填</span>
          </label>
          <button class="btn-remove-opt" data-remove-col="${i}" title="删除列">&times;</button>
        </div>
      </div>`;
    });
    html += `<button class="btn btn-default" id="btnAddColumn">+ 添加列</button></div>`;
    return html;
  }

  _renderValidationTab() {
    const f = this._fieldDef;
    const config = f.config || {};
    let html = `<div class="prop-section">
      <div class="prop-section-title">校验规则</div>
      <div class="form-group">
        <label class="form-check">
          <input type="checkbox" data-prop="config.required" ${config.required ? 'checked' : ''}>
          <span>必填</span>
        </label>
      </div>`;

    if (f.type === 'text') {
      html += `
        <div class="form-group">
          <label class="form-label">最小长度</label>
          <input type="number" class="form-input" data-prop="config.minLength" value="${config.minLength || 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">最大长度</label>
          <input type="number" class="form-input" data-prop="config.maxLength" value="${config.maxLength || 200}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">正则表达式</label>
          <input class="form-input" data-prop="config.regex" value="${this._esc(config.regex || '')}" placeholder="如: ^[a-zA-Z]+$">
        </div>
        <div class="form-group">
          <label class="form-label">正则提示</label>
          <input class="form-input" data-prop="config.regexMessage" value="${this._esc(config.regexMessage || '')}">
        </div>`;
    }

    if (f.type === 'number') {
      html += `
        <div class="form-group">
          <label class="form-label">最小值</label>
          <input type="number" class="form-input" data-prop="config.min" value="${config.min ?? ''}">
        </div>
        <div class="form-group">
          <label class="form-label">最大值</label>
          <input type="number" class="form-input" data-prop="config.max" value="${config.max ?? ''}">
        </div>
        <div class="form-group">
          <label class="form-label">小数位数</label>
          <input type="number" class="form-input" data-prop="config.precision" value="${config.precision || 0}" min="0" max="10">
        </div>`;
    }

    if (f.type === 'date') {
      html += `
        <div class="form-group">
          <label class="form-label">最早日期</label>
          <input type="date" class="form-input" data-prop="config.minDate" value="${config.minDate || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">最晚日期</label>
          <input type="date" class="form-input" data-prop="config.maxDate" value="${config.maxDate || ''}">
        </div>`;
    }

    if (f.type === 'checkbox') {
      html += `
        <div class="form-group">
          <label class="form-label">最少选择</label>
          <input type="number" class="form-input" data-prop="config.minSelect" value="${config.minSelect || 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">最多选择 (0=不限)</label>
          <input type="number" class="form-input" data-prop="config.maxSelect" value="${config.maxSelect || 0}" min="0">
        </div>`;
    }

    if (f.type === 'detailTable') {
      html += `
        <div class="form-group">
          <label class="form-label">最少行数</label>
          <input type="number" class="form-input" data-prop="config.minRows" value="${config.minRows || 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">最大行数</label>
          <input type="number" class="form-input" data-prop="config.maxRows" value="${config.maxRows || 50}" min="1">
        </div>`;
    }

    if (f.type === 'attachment') {
      html += `
        <div class="form-group">
          <label class="form-label">最大文件数</label>
          <input type="number" class="form-input" data-prop="config.maxFiles" value="${config.maxFiles || 5}" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">接受文件类型</label>
          <input class="form-input" data-prop="config.accept" value="${this._esc(config.accept || '')}" placeholder=".pdf,.jpg,.png">
        </div>`;
    }

    html += `</div>`;

    // Error messages
    html += `<div class="prop-section">
      <div class="prop-section-title">错误提示</div>
      <div class="form-group">
        <label class="form-label">必填提示</label>
        <input class="form-input" data-prop="errorMessages.required" value="${this._esc(f.errorMessages?.required || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">格式提示</label>
        <input class="form-input" data-prop="errorMessages.regex" value="${this._esc(f.errorMessages?.regex || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">范围提示</label>
        <input class="form-input" data-prop="errorMessages.range" value="${this._esc(f.errorMessages?.range || '')}">
      </div>
    </div>`;

    return html;
  }

  _renderAdvancedTab() {
    const f = this._fieldDef;
    let html = '';

    // Conditions summary
    html += `<div class="prop-section">
      <div class="prop-section-title">联动显示</div>
      <div class="text-sm text-muted mb-sm">控制此字段的显示/隐藏条件</div>
      <div id="conditionsList">`;
    const conditions = f.conditions || [];
    if (conditions.length === 0) {
      html += `<div class="text-muted text-sm">暂无条件</div>`;
    } else {
      conditions.forEach((cond, i) => {
        html += `<div class="flex items-center justify-between" style="padding:6px 0;border-bottom:1px solid var(--border-lighter)">
          <span class="text-sm">当 ${cond.sourceFieldId} ${this._opLabel(cond.operator)} "${cond.value}" 时${cond.action === 'show' ? '显示' : '隐藏'}</span>
          <button class="btn-remove-opt" data-remove-cond="${i}">&times;</button>
        </div>`;
      });
    }
    html += `</div>
      <button class="btn btn-default mt-sm" id="btnAddCondition">+ 添加条件</button>
    </div>`;

    // Cross-field validation summary
    html += `<div class="prop-section">
      <div class="prop-section-title">跨字段校验</div>
      <div id="crossValidationList">`;
    const xvals = f.crossValidation || [];
    if (xvals.length === 0) {
      html += `<div class="text-muted text-sm">暂无跨字段校验</div>`;
    } else {
      xvals.forEach((rule, i) => {
        html += `<div class="flex items-center justify-between" style="padding:6px 0;border-bottom:1px solid var(--border-lighter)">
          <span class="text-sm">${this._opLabel(rule.operator)} ${rule.targetFieldId}: ${rule.errorMessage || ''}</span>
          <button class="btn-remove-opt" data-remove-xval="${i}">&times;</button>
        </div>`;
      });
    }
    html += `</div>
      <button class="btn btn-default mt-sm" id="btnAddCrossVal">+ 添加校验</button>
    </div>`;

    return html;
  }

  _bindEvents() {
    // Tab switching
    this.querySelectorAll('.properties-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        this._render();
      });
    });

    // Property changes via data-prop
    this.querySelectorAll('[data-prop]').forEach(input => {
      const prop = input.dataset.prop;
      const handler = () => {
        let value;
        if (input.type === 'checkbox') {
          value = input.checked;
        } else if (input.type === 'number') {
          value = input.value === '' ? null : Number(input.value);
        } else if (input.tagName === 'SELECT' && input.dataset.prop === 'config.levels') {
          value = Number(input.value);
        } else {
          value = input.value;
        }
        this._emitChange(prop, value);
      };
      if (input.type === 'checkbox') {
        input.addEventListener('change', handler);
      } else {
        input.addEventListener('change', handler);
        input.addEventListener('blur', handler);
      }
    });

    // Options
    this._bindOptionEvents();
    // Columns
    this._bindColumnEvents();
    // Conditions
    this._bindConditionEvents();
    // Cross-validation
    this._bindCrossValEvents();
  }

  _bindOptionEvents() {
    this.querySelectorAll('[data-opt-label]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.optLabel);
        const options = [...(this._fieldDef.options || [])];
        if (options[i]) {
          options[i] = { ...options[i], label: input.value };
          this._emitChange('options', options);
        }
      });
    });

    this.querySelectorAll('[data-remove-opt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.removeOpt);
        const options = [...(this._fieldDef.options || [])];
        options.splice(i, 1);
        this._emitChange('options', options);
        this._render();
      });
    });

    const addBtn = this.querySelector('#btnAddOption');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const options = [...(this._fieldDef.options || [])];
        options.push({ value: generateId('opt'), label: `选项${options.length + 1}` });
        this._emitChange('options', options);
        this._render();
      });
    }
  }

  _bindColumnEvents() {
    this.querySelectorAll('[data-col-label]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.colLabel);
        const columns = structuredClone(this._fieldDef.columns || []);
        if (columns[i]) { columns[i].label = input.value; }
        this._emitChange('columns', columns);
      });
    });

    this.querySelectorAll('[data-col-type]').forEach(select => {
      select.addEventListener('change', () => {
        const i = parseInt(select.dataset.colType);
        const columns = structuredClone(this._fieldDef.columns || []);
        if (columns[i]) { columns[i].type = select.value; }
        this._emitChange('columns', columns);
      });
    });

    this.querySelectorAll('[data-col-required]').forEach(cb => {
      cb.addEventListener('change', () => {
        const i = parseInt(cb.dataset.colRequired);
        const columns = structuredClone(this._fieldDef.columns || []);
        if (columns[i]) {
          if (!columns[i].config) columns[i].config = {};
          columns[i].config.required = cb.checked;
        }
        this._emitChange('columns', columns);
      });
    });

    this.querySelectorAll('[data-remove-col]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.removeCol);
        const columns = structuredClone(this._fieldDef.columns || []);
        if (columns.length > 1) {
          columns.splice(i, 1);
          this._emitChange('columns', columns);
          this._render();
        }
      });
    });

    const addBtn = this.querySelector('#btnAddColumn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const columns = structuredClone(this._fieldDef.columns || []);
        columns.push({
          columnId: generateId('col'),
          type: 'text',
          label: `列${columns.length + 1}`,
          config: { required: false, maxLength: 100 }
        });
        this._emitChange('columns', columns);
        this._render();
      });
    }
  }

  _bindConditionEvents() {
    this.querySelectorAll('[data-remove-cond]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.removeCond);
        const conditions = [...(this._fieldDef.conditions || [])];
        conditions.splice(i, 1);
        this._emitChange('conditions', conditions);
        this._render();
      });
    });

    const addBtn = this.querySelector('#btnAddCondition');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        eventBus.emit('condition:openEditor', { fieldId: this._fieldDef.fieldId });
      });
    }
  }

  _bindCrossValEvents() {
    this.querySelectorAll('[data-remove-xval]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.removeXval);
        const xvals = [...(this._fieldDef.crossValidation || [])];
        xvals.splice(i, 1);
        this._emitChange('crossValidation', xvals);
        this._render();
      });
    });

    const addBtn = this.querySelector('#btnAddCrossVal');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        eventBus.emit('crossValidation:openEditor', { fieldId: this._fieldDef.fieldId });
      });
    }
  }

  _emitChange(property, value) {
    if (this._onChange) {
      this._onChange(this._fieldDef.fieldId, property, value);
    }
  }

  _opLabel(op) {
    const labels = {
      equals: '等于', notEquals: '不等于', contains: '包含',
      greaterThan: '大于', lessThan: '小于', isEmpty: '为空', isNotEmpty: '不为空',
      greaterEqual: '大于等于', lessEqual: '小于等于', in: '属于', notIn: '不属于'
    };
    return labels[op] || op;
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('fb-properties', FBProperties);
