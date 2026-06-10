// Main builder application shell
import { Store } from '../../core/store.js';
import { eventBus } from '../../core/event-bus.js';
import { CommandManager, AddFieldCommand, RemoveFieldCommand, MoveFieldCommand, ChangePropertyCommand } from '../../core/command-manager.js';
import { fieldRegistry } from '../../core/field-registry.js';
import { createEmptyTemplate, validateTemplateJSON } from '../../core/schema.js';
import { generateId } from '../../utils/id-generator.js';
import { storage } from '../../utils/storage.js';
import './fb-toolbar.js';
import './fb-palette.js';
import './fb-canvas.js';
import './fb-canvas-field.js';
import './fb-properties.js';
// Field components
import '../fields/ff-text.js';
import '../fields/ff-number.js';
import '../fields/ff-date.js';
import '../fields/ff-radio.js';
import '../fields/ff-checkbox.js';
import '../fields/ff-attachment.js';
import '../fields/ff-address.js';
import '../fields/ff-detail-table.js';
import '../fields/ff-group-desc.js';

export class FBApp extends HTMLElement {
  constructor() {
    super();
    this._store = new Store({
      template: createEmptyTemplate(),
      selectedFieldId: null
    });
    this._cmdManager = new CommandManager();
  }

  connectedCallback() {
    this.classList.add('builder-app');
    this.innerHTML = `
      <fb-toolbar></fb-toolbar>
      <div class="builder-main">
        <fb-palette></fb-palette>
        <fb-canvas></fb-canvas>
        <fb-properties></fb-properties>
      </div>
    `;

    this._toolbar = this.querySelector('fb-toolbar');
    this._canvas = this.querySelector('fb-canvas');
    this._properties = this.querySelector('fb-properties');

    this._initTemplate();
    this._bindEvents();
    this._renderCanvas();
  }

  _initTemplate() {
    // Try to load last edited template
    const lastId = storage.load('builder', 'lastTemplateId');
    if (lastId) {
      const tpl = storage.load('templates', lastId);
      if (tpl) {
        this._store.setState('template', tpl);
        this._toolbar.setTemplateName(tpl.name);
        return;
      }
    }
    // Create new
    const tpl = this._store.get('template');
    tpl.templateId = generateId('tpl');
    this._store.setState('template', tpl);
  }

  _bindEvents() {
    // Properties change handler
    this._properties.setChangeHandler((fieldId, property, value) => {
      const fields = this._store.get('template.fields') || [];
      const field = fields.find(f => f.fieldId === fieldId);
      if (!field) return;
      const oldValue = this._getNestedProp(field, property);
      const cmd = new ChangePropertyCommand(
        this._createFieldsProxy(),
        fieldId, property,
        oldValue, value
      );
      this._cmdManager.execute(cmd);
      this._refreshAfterChange(fieldId);
    });

    // Field add (from canvas drop)
    eventBus.on('field:add', ({ fieldDef, index }) => {
      const cmd = new AddFieldCommand(this._createFieldsProxy(), fieldDef, index);
      this._cmdManager.execute(cmd);
      this._renderCanvas();
      this._selectField(fieldDef.fieldId);
    });

    // Field remove
    eventBus.on('field:remove', ({ fieldId }) => {
      const cmd = new RemoveFieldCommand(this._createFieldsProxy(), fieldId);
      this._cmdManager.execute(cmd);
      if (this._store.get('selectedFieldId') === fieldId) {
        this._store.setState('selectedFieldId', null);
        this._properties.clear();
      }
      this._renderCanvas();
    });

    // Field copy
    eventBus.on('field:copy', ({ fieldId }) => {
      const fields = this._store.get('template.fields') || [];
      const original = fields.find(f => f.fieldId === fieldId);
      if (!original) return;
      const copy = structuredClone(original);
      copy.fieldId = generateId('fld');
      copy.label = copy.label + ' (副本)';
      const idx = fields.findIndex(f => f.fieldId === fieldId) + 1;
      const cmd = new AddFieldCommand(this._createFieldsProxy(), copy, idx);
      this._cmdManager.execute(cmd);
      this._renderCanvas();
      this._selectField(copy.fieldId);
    });

    // Field moved (reorder)
    eventBus.on('field:moved', ({ fieldId, fromIndex, targetIndex }) => {
      if (fromIndex === targetIndex) return;
      const cmd = new MoveFieldCommand(this._createFieldsProxy(), fieldId, fromIndex, targetIndex);
      this._cmdManager.execute(cmd);
      this._renderCanvas();
    });

    // Field selected
    eventBus.on('field:selected', ({ fieldId }) => {
      this._selectField(fieldId);
    });

    // Undo/Redo
    eventBus.on('command:undo', () => {
      this._cmdManager.undo();
      this._renderCanvas();
      this._refreshSelectedField();
    });
    eventBus.on('command:redo', () => {
      this._cmdManager.redo();
      this._renderCanvas();
      this._refreshSelectedField();
    });

    // Template name change
    eventBus.on('template:nameChanged', ({ name }) => {
      const tpl = this._store.get('template');
      tpl.name = name;
      this._store.setState('template', tpl);
    });

    // Save
    eventBus.on('template:save', () => this._saveTemplate());

    // Export
    eventBus.on('template:export', () => this._exportTemplate());

    // Import
    eventBus.on('template:import', () => this._importTemplate());

    // Preview
    eventBus.on('template:preview', () => this._previewTemplate());

    // Publish
    eventBus.on('template:publish', () => this._publishTemplate());

    // Template list
    eventBus.on('template:showList', () => this._showTemplateList());

    // Condition editor
    eventBus.on('condition:openEditor', ({ fieldId }) => this._openConditionEditor(fieldId));
    eventBus.on('crossValidation:openEditor', ({ fieldId }) => this._openCrossValidationEditor(fieldId));
  }

  _createFieldsProxy() {
    const store = this._store;
    return {
      get(path) {
        if (path === 'fields') return store.get('template.fields') || [];
        return store.get('template.' + path);
      },
      setState(path, value) {
        if (path === 'fields') {
          const tpl = store.get('template');
          tpl.fields = value;
          tpl.metadata.updatedAt = new Date().toISOString();
          store.setState('template', tpl);
        }
      }
    };
  }

  _renderCanvas() {
    const fields = this._store.get('template.fields') || [];
    const active = fields.filter(f => !f._deleted);
    this._canvas.renderFields(active);
    // Restore selection
    const selectedId = this._store.get('selectedFieldId');
    if (selectedId) {
      const cf = this._canvas.querySelector(`fb-canvas-field[data-field-id="${selectedId}"]`);
      if (cf) cf.setSelected(true);
    }
  }

  _selectField(fieldId) {
    this._store.setState('selectedFieldId', fieldId);
    const fields = this._store.get('template.fields') || [];
    const field = fields.find(f => f.fieldId === fieldId);
    if (field) {
      this._properties.showField(structuredClone(field));
    }
    // Update canvas selection visual
    this._canvas.querySelectorAll('fb-canvas-field').forEach(cf => {
      cf.setSelected(cf.getAttribute('data-field-id') === fieldId);
    });
  }

  _refreshSelectedField() {
    const selectedId = this._store.get('selectedFieldId');
    if (selectedId) {
      const fields = this._store.get('template.fields') || [];
      const field = fields.find(f => f.fieldId === selectedId);
      if (field) {
        this._properties.refresh(structuredClone(field));
      } else {
        this._properties.clear();
        this._store.setState('selectedFieldId', null);
      }
    }
  }

  _refreshAfterChange(fieldId) {
    const fields = this._store.get('template.fields') || [];
    const field = fields.find(f => f.fieldId === fieldId);
    if (field) {
      this._properties.refresh(structuredClone(field));
    }
    this._renderCanvas();
  }

  _getNestedProp(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  _saveTemplate() {
    const tpl = this._store.get('template');
    tpl.metadata.updatedAt = new Date().toISOString();
    storage.save('templates', tpl.templateId, tpl);
    storage.save('builder', 'lastTemplateId', tpl.templateId);
    this._showToast('模板已保存');
  }

  _exportTemplate() {
    const tpl = this._store.get('template');
    const json = JSON.stringify(tpl, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tpl.name || 'template'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('模板已导出');
  }

  _importTemplate() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          const result = validateTemplateJSON(json);
          if (!result.valid) {
            this._showImportErrors(result.errors);
            return;
          }
          // Assign new ID to avoid conflicts
          json.templateId = generateId('tpl');
          this._store.setState('template', json);
          this._store.setState('selectedFieldId', null);
          this._toolbar.setTemplateName(json.name);
          this._properties.clear();
          this._cmdManager.clear();
          this._renderCanvas();
          this._showToast('模板导入成功');
        } catch (err) {
          this._showImportErrors([{ path: '', message: 'JSON 解析失败: ' + err.message }]);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  _showImportErrors(errors) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <span>导入错误</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:12px;color:var(--danger)">模板格式校验失败，请修正后重试：</p>
          ${errors.map(e => `<div style="padding:6px 0;border-bottom:1px solid var(--border-lighter)">
            <span class="text-muted text-sm">${e.path || '根'}</span>: ${e.message}
          </div>`).join('')}
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary modal-ok">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  _previewTemplate() {
    const tpl = this._store.get('template');
    if (!tpl.fields || tpl.fields.filter(f => !f._deleted).length === 0) {
      this._showToast('请先添加字段', 'warning');
      return;
    }
    // Store template temporarily for preview page
    storage.save('preview', 'current', tpl);
    window.open('renderer.html?mode=preview', '_blank');
  }

  _publishTemplate() {
    const tpl = this._store.get('template');
    const activeFields = (tpl.fields || []).filter(f => !f._deleted);
    if (activeFields.length === 0) {
      this._showToast('请先添加字段', 'warning');
      return;
    }

    const version = (tpl.currentVersion || 0) + 1;
    const changelog = prompt(`发布版本 v${version}\n请输入变更说明:`, '');
    if (changelog === null) return;

    tpl.currentVersion = version;
    if (!tpl.versions) tpl.versions = [];
    tpl.versions.push({
      version,
      publishedAt: new Date().toISOString(),
      snapshot: structuredClone(activeFields),
      changelog: changelog || ''
    });
    tpl.metadata.updatedAt = new Date().toISOString();
    this._store.setState('template', tpl);

    storage.save('templates', tpl.templateId, tpl);
    storage.save('builder', 'lastTemplateId', tpl.templateId);
    this._showToast(`版本 v${version} 发布成功`);
  }

  _showTemplateList() {
    const templates = storage.listAll('templates');
    const items = Object.values(templates).sort((a, b) =>
      (b.metadata?.updatedAt || '').localeCompare(a.metadata?.updatedAt || '')
    );

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:500px">
        <div class="modal-header">
          <span>模板列表</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body">
          ${items.length === 0 ? '<div class="text-muted text-center">暂无保存的模板</div>' :
            items.map(t => `
              <div class="flex items-center justify-between" style="padding:10px 0;border-bottom:1px solid var(--border-lighter)">
                <div>
                  <div style="font-weight:500">${this._esc(t.name)}</div>
                  <div class="text-sm text-muted">v${t.currentVersion || 0} · ${(t.fields||[]).filter(f=>!f._deleted).length}个字段 · ${this._formatDate(t.metadata?.updatedAt)}</div>
                </div>
                <div class="flex gap-sm">
                  <button class="btn btn-default btn-sm" data-open-tpl="${t.templateId}">打开</button>
                  <button class="btn btn-danger btn-sm" data-del-tpl="${t.templateId}">删除</button>
                </div>
              </div>`).join('')
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="btnNewTemplate">+ 新建模板</button>
          <button class="btn btn-default modal-ok">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('[data-open-tpl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = storage.load('templates', btn.dataset.openTpl);
        if (tpl) {
          this._store.setState('template', tpl);
          this._store.setState('selectedFieldId', null);
          this._toolbar.setTemplateName(tpl.name);
          this._properties.clear();
          this._cmdManager.clear();
          this._renderCanvas();
          storage.save('builder', 'lastTemplateId', tpl.templateId);
        }
        overlay.remove();
      });
    });

    overlay.querySelectorAll('[data-del-tpl]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('确定删除此模板？')) {
          storage.delete('templates', btn.dataset.delTpl);
          overlay.remove();
          this._showTemplateList();
        }
      });
    });

    overlay.querySelector('#btnNewTemplate')?.addEventListener('click', () => {
      const tpl = createEmptyTemplate();
      tpl.templateId = generateId('tpl');
      this._store.setState('template', tpl);
      this._store.setState('selectedFieldId', null);
      this._toolbar.setTemplateName(tpl.name);
      this._properties.clear();
      this._cmdManager.clear();
      this._renderCanvas();
      overlay.remove();
    });
  }

  _openConditionEditor(fieldId) {
    const fields = this._store.get('template.fields') || [];
    const field = fields.find(f => f.fieldId === fieldId);
    if (!field) return;
    const otherFields = fields.filter(f => f.fieldId !== fieldId && !f._deleted && f.type !== 'groupDesc');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:480px">
        <div class="modal-header">
          <span>添加联动条件</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">当字段</label>
            <select class="form-input" id="condSourceField">
              <option value="">请选择</option>
              ${otherFields.map(f => `<option value="${f.fieldId}">${this._esc(f.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">操作符</label>
            <select class="form-input" id="condOperator">
              <option value="equals">等于</option>
              <option value="notEquals">不等于</option>
              <option value="contains">包含</option>
              <option value="isEmpty">为空</option>
              <option value="isNotEmpty">不为空</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">值</label>
            <input class="form-input" id="condValue" placeholder="比较值">
          </div>
          <div class="form-group">
            <label class="form-label">动作</label>
            <select class="form-input" id="condAction">
              <option value="show">满足条件时显示</option>
              <option value="hide">满足条件时隐藏</option>
            </select>
          </div>
          <div id="condError" class="text-danger text-sm" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-default modal-cancel">取消</button>
          <button class="btn btn-primary" id="btnSaveCond">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#btnSaveCond').addEventListener('click', () => {
      const sourceFieldId = overlay.querySelector('#condSourceField').value;
      const operator = overlay.querySelector('#condOperator').value;
      const value = overlay.querySelector('#condValue').value;
      const action = overlay.querySelector('#condAction').value;
      const errorDiv = overlay.querySelector('#condError');

      if (!sourceFieldId) {
        errorDiv.textContent = '请选择源字段';
        errorDiv.style.display = '';
        return;
      }

      const conditions = [...(field.conditions || [])];
      conditions.push({
        conditionId: generateId('cond'),
        sourceFieldId, operator, value, action
      });

      this._properties._emitChange('conditions', conditions);
      overlay.remove();
    });
  }

  _openCrossValidationEditor(fieldId) {
    const fields = this._store.get('template.fields') || [];
    const field = fields.find(f => f.fieldId === fieldId);
    if (!field) return;
    const otherFields = fields.filter(f => f.fieldId !== fieldId && !f._deleted && f.type !== 'groupDesc');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:480px">
        <div class="modal-header">
          <span>添加跨字段校验</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">目标字段</label>
            <select class="form-input" id="xvalTarget">
              <option value="">请选择</option>
              ${otherFields.map(f => `<option value="${f.fieldId}">${this._esc(f.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">比较关系 (当前字段 [比较] 目标字段)</label>
            <select class="form-input" id="xvalOperator">
              <option value="lessThan">小于</option>
              <option value="lessEqual">小于等于</option>
              <option value="equals">等于</option>
              <option value="greaterThan">大于</option>
              <option value="greaterEqual">大于等于</option>
              <option value="notEquals">不等于</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">错误提示</label>
            <input class="form-input" id="xvalMessage" placeholder="校验不通过时的提示信息">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-default modal-cancel">取消</button>
          <button class="btn btn-primary" id="btnSaveXval">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#btnSaveXval').addEventListener('click', () => {
      const targetFieldId = overlay.querySelector('#xvalTarget').value;
      const operator = overlay.querySelector('#xvalOperator').value;
      const errorMessage = overlay.querySelector('#xvalMessage').value;
      if (!targetFieldId) return;

      const xvals = [...(field.crossValidation || [])];
      xvals.push({
        ruleId: generateId('xval'),
        targetFieldId, operator,
        errorMessage: errorMessage || '跨字段校验不通过'
      });
      this._properties._emitChange('crossValidation', xvals);
      overlay.remove();
    });
  }

  _showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      padding: 10px 24px; border-radius: 4px; z-index: 9999;
      font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideUp 0.2s ease;
      background: ${type === 'success' ? '#f6ffed' : '#fff7e6'};
      color: ${type === 'success' ? '#52c41a' : '#faad14'};
      border: 1px solid ${type === 'success' ? '#b7eb8f' : '#ffe58f'};
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  _formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('fb-app', FBApp);
