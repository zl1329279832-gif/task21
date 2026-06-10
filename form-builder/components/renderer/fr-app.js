// Renderer application shell
import { storage } from '../../utils/storage.js';
import { generateId } from '../../utils/id-generator.js';
import { createEmptySubmission } from '../../core/schema.js';
import { debounce } from '../../utils/debounce-throttle.js';
import './fr-toolbar.js';
import './fr-form.js';
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

export class FRApp extends HTMLElement {
  _template = null;
  _submission = null;
  _isPreview = false;

  connectedCallback() {
    this.classList.add('renderer-app');
    this._loadData();
  }

  _loadData() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const templateId = params.get('templateId');
    const submissionId = params.get('submissionId');

    if (mode === 'preview') {
      // Preview mode: load from preview storage
      this._isPreview = true;
      this._template = storage.load('preview', 'current');
      if (!this._template) {
        this.innerHTML = '<div style="text-align:center;padding:40px;color:#999">无法加载预览模板</div>';
        return;
      }
      this._submission = createEmptySubmission(this._template.templateId, this._template.currentVersion);
      this._submission.submissionId = generateId('sub');
      this._renderApp();
      return;
    }

    // Normal mode: load template and submission
    if (templateId) {
      this._template = storage.load('templates', templateId);
    }

    if (!this._template) {
      // Show template selection
      this._showTemplateSelector();
      return;
    }

    if (submissionId) {
      this._submission = storage.load('submissions', submissionId);
      if (this._submission) {
        // Migrate if needed
        this._migrateSubmission();
      }
    }

    if (!this._submission) {
      // Check for existing drafts for this template
      const drafts = this._findDrafts(this._template.templateId);
      if (drafts.length > 0) {
        this._showDraftSelector(drafts);
        return;
      }
      // Create new submission
      this._submission = createEmptySubmission(this._template.templateId, this._template.currentVersion);
      this._submission.submissionId = generateId('sub');
    }

    this._renderApp();
  }

  _showTemplateSelector() {
    const templates = storage.listAll('templates');
    const published = Object.values(templates).filter(t => t.currentVersion > 0);

    this.innerHTML = `
      <div style="max-width:600px;margin:40px auto;padding:0 20px">
        <h2 style="margin-bottom:20px">选择表单模板</h2>
        ${published.length === 0
          ? '<div class="text-muted">暂无已发布的模板，请先在设计器中创建并发布模板。<br><br><a href="index.html">前往设计器</a></div>'
          : published.map(t => `
            <div class="history-item" data-tpl-id="${t.templateId}" style="background:#fff;margin-bottom:8px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
              <div class="history-time">${this._esc(t.name)}</div>
              <div class="history-action">v${t.currentVersion} · ${(t.fields||[]).filter(f=>!f._deleted).length}个字段 · ${this._formatDate(t.metadata?.updatedAt)}</div>
            </div>`).join('')
        }
      </div>`;

    this.querySelectorAll('[data-tpl-id]').forEach(el => {
      el.addEventListener('click', () => {
        this._template = storage.load('templates', el.dataset.tplId);
        if (this._template) {
          const drafts = this._findDrafts(this._template.templateId);
          if (drafts.length > 0) {
            this._showDraftSelector(drafts);
          } else {
            this._submission = createEmptySubmission(this._template.templateId, this._template.currentVersion);
            this._submission.submissionId = generateId('sub');
            this._renderApp();
          }
        }
      });
    });
  }

  _showDraftSelector(drafts) {
    this.innerHTML = `
      <div style="max-width:600px;margin:40px auto;padding:0 20px">
        <h2 style="margin-bottom:20px">${this._esc(this._template.name)}</h2>
        <p style="margin-bottom:16px">您有未完成的草稿，是否继续填写？</p>
        ${drafts.map(d => `
          <div class="history-item" data-sub-id="${d.submissionId}" style="background:#fff;margin-bottom:8px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
            <div class="history-time">${this._statusLabel(d.status)} · v${d.templateVersion}</div>
            <div class="history-action">${this._formatDate(d.metadata?.updatedAt)}</div>
          </div>`).join('')}
        <button class="btn btn-primary" id="btnNewSubmission" style="margin-top:16px">+ 新建填报</button>
      </div>`;

    this.querySelectorAll('[data-sub-id]').forEach(el => {
      el.addEventListener('click', () => {
        this._submission = storage.load('submissions', el.dataset.subId);
        if (this._submission) {
          this._migrateSubmission();
          this._renderApp();
        }
      });
    });

    this.querySelector('#btnNewSubmission')?.addEventListener('click', () => {
      this._submission = createEmptySubmission(this._template.templateId, this._template.currentVersion);
      this._submission.submissionId = generateId('sub');
      this._renderApp();
    });
  }

  _renderApp() {
    const isPreview = this._isPreview;
    const isReadonly = this._submission.status === 'submitted';

    this.innerHTML = '';

    if (isPreview) {
      const banner = document.createElement('div');
      banner.className = 'preview-banner';
      banner.textContent = '预览模式 — 数据不会被保存';
      this.appendChild(banner);
    }

    // Toolbar
    if (!isPreview) {
      const toolbar = document.createElement('fr-toolbar');
      this.appendChild(toolbar);
      this._toolbar = toolbar;
      toolbar.setStatus(this._submission.status);
      toolbar.setActionHandler((action) => this._handleAction(action));
    }

    // Body
    const body = document.createElement('div');
    body.className = 'renderer-body';
    this.appendChild(body);

    // Validation summary placeholder
    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'validationSummary';
    body.appendChild(summaryDiv);

    // Form
    const form = document.createElement('fr-form');
    body.appendChild(form);
    this._form = form;

    form.configure(
      this._template,
      this._submission.values || {},
      isReadonly ? 'readonly' : 'fill'
    );

    // Form change listener for auto-save
    if (!isPreview && !isReadonly) {
      form.addEventListener('form-change', debounce(() => {
        this._autoSave();
      }, 3000));
    }

    // Orphaned values
    const orphaned = this._submission.orphanedValues || {};
    if (Object.keys(orphaned).length > 0) {
      body.appendChild(this._renderOrphanedValues(orphaned));
    }

    // Return reason
    if (this._submission.status === 'returned' && this._submission.metadata?.returnReason) {
      const reasonDiv = document.createElement('div');
      reasonDiv.className = 'validation-summary';
      reasonDiv.innerHTML = `
        <div class="summary-title">退回原因</div>
        <div>${this._esc(this._submission.metadata.returnReason)}</div>`;
      body.insertBefore(reasonDiv, form);
    }
  }

  _handleAction(action) {
    switch (action) {
      case 'saveDraft': this._saveDraft(); break;
      case 'submit': this._submitForm(); break;
      case 'history': this._showHistory(); break;
      case 'export': this._exportData(); break;
    }
  }

  _saveDraft() {
    this._submission.values = this._form.getValues();
    this._submission.status = this._submission.status === 'submitted' ? 'submitted' : 'draft';
    this._submission.metadata.updatedAt = new Date().toISOString();
    this._addHistory('draft_save');
    storage.save('submissions', this._submission.submissionId, this._submission);
    this._showToast('草稿已保存');
  }

  _autoSave() {
    if (this._isPreview || this._submission.status === 'submitted') return;
    this._toolbar?.setAutoSaveState('saving');
    this._submission.values = this._form.getValues();
    this._submission.metadata.updatedAt = new Date().toISOString();
    storage.save('submissions', this._submission.submissionId, this._submission);
    setTimeout(() => this._toolbar?.setAutoSaveState('saved'), 500);
  }

  _submitForm() {
    const result = this._form.validate();
    if (!result.valid) {
      this._showValidationSummary(result.errors);
      this._showToast('请修正表单中的错误', 'warning');
      return;
    }

    this._clearValidationSummary();
    this._submission.values = this._form.getValues();
    this._submission.status = 'submitted';
    this._submission.metadata.submittedAt = new Date().toISOString();
    this._submission.metadata.updatedAt = new Date().toISOString();
    this._addHistory('submitted');
    storage.save('submissions', this._submission.submissionId, this._submission);
    this._toolbar?.setStatus('submitted');
    this._showToast('提交成功');

    // Re-render as readonly
    this._renderApp();
  }

  _showValidationSummary(errors) {
    const container = this.querySelector('#validationSummary');
    if (!container) return;
    const fields = (this._template?.fields || []).filter(f => !f._deleted);

    let html = `<div class="validation-summary">
      <div class="summary-title">请修正以下错误 (${errors.size}个字段)</div>`;
    for (const [fieldId, errs] of errors) {
      const field = fields.find(f => f.fieldId === fieldId);
      const label = field?.label || fieldId;
      html += `<div class="summary-item" data-scroll-to="${fieldId}">${label}: ${errs[0]}</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll('[data-scroll-to]').forEach(el => {
      el.addEventListener('click', () => {
        this._form.scrollToField(el.dataset.scrollTo);
      });
    });
  }

  _clearValidationSummary() {
    const container = this.querySelector('#validationSummary');
    if (container) container.innerHTML = '';
  }

  _showHistory() {
    const history = this._submission.history || [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:500px">
        <div class="modal-header">
          <span>历史版本</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body" style="padding:0">
          ${history.length === 0
            ? '<div class="text-muted text-center" style="padding:40px">暂无历史记录</div>'
            : [...history].reverse().map((h, i) => `
              <div class="history-item" data-hist-idx="${history.length - 1 - i}">
                <div class="flex items-center justify-between">
                  <span class="history-time">${this._formatDate(h.savedAt)}</span>
                  <span class="history-version">v${h.templateVersion}</span>
                </div>
                <div class="history-action">${this._actionLabel(h.action)}</div>
              </div>`).join('')
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-default modal-ok">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Click to view historical snapshot
    overlay.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.histIdx);
        const entry = history[idx];
        if (!entry?.values) return;
        overlay.remove();
        this._viewHistorySnapshot(entry);
      });
    });
  }

  _viewHistorySnapshot(entry) {
    // Find template version snapshot
    const version = this._template.versions?.find(v => v.version === entry.templateVersion);
    const snapshotTemplate = version ? {
      ...this._template,
      fields: version.snapshot
    } : this._template;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:800px;max-height:90vh">
        <div class="modal-header">
          <span>历史快照 · ${this._formatDate(entry.savedAt)} · ${this._actionLabel(entry.action)}</span>
          <span class="modal-close">&times;</span>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto"></div>
        <div class="modal-footer">
          <button class="btn btn-default" id="btnRestoreHistory">恢复此版本</button>
          <button class="btn btn-primary modal-ok">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Render historical form in readonly mode
    const formContainer = overlay.querySelector('.modal-body');
    const histForm = document.createElement('fr-form');
    formContainer.appendChild(histForm);
    histForm.configure(snapshotTemplate, entry.values, 'readonly');

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#btnRestoreHistory')?.addEventListener('click', () => {
      if (confirm('确定恢复到此历史版本？当前未保存的数据将丢失。')) {
        this._submission.values = structuredClone(entry.values);
        this._submission.status = 'draft';
        this._submission.metadata.updatedAt = new Date().toISOString();
        this._addHistory('restored');
        storage.save('submissions', this._submission.submissionId, this._submission);
        overlay.remove();
        this._renderApp();
        this._showToast('已恢复历史版本');
      }
    });
  }

  _exportData() {
    this._submission.values = this._form?.getValues() || this._submission.values;
    const data = structuredClone(this._submission);
    // Attach field labels for readability
    const fields = (this._template?.fields || []).filter(f => !f._deleted);
    data._fieldLabels = {};
    for (const f of fields) {
      data._fieldLabels[f.fieldId] = f.label;
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submission_${this._submission.submissionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('数据已导出');
  }

  _renderOrphanedValues(orphaned) {
    const section = document.createElement('div');
    section.className = 'orphaned-section';

    let collapsed = true;
    const header = document.createElement('div');
    header.className = 'orphaned-header';
    header.innerHTML = `<span>▶</span> 历史数据 (${Object.keys(orphaned).length}个已删除字段的旧值)`;
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'orphaned-body';
    body.style.display = 'none';
    for (const [, data] of Object.entries(orphaned)) {
      const item = document.createElement('div');
      item.className = 'orphaned-item';
      const displayVal = typeof data.value === 'object' ? JSON.stringify(data.value) : String(data.value);
      item.innerHTML = `
        <span class="orphan-label">${this._esc(data.label || data.fieldId)}:</span>
        <span class="orphan-value">${this._esc(displayVal)}</span>`;
      body.appendChild(item);
    }
    section.appendChild(body);

    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('span').textContent = collapsed ? '▶' : '▼';
    });

    return section;
  }

  _migrateSubmission() {
    if (!this._submission || !this._template) return;
    if (this._submission.templateVersion === this._template.currentVersion) return;

    const fromVersion = this._submission.templateVersion;
    const toVersion = this._template.currentVersion;
    const fromSnapshot = this._template.versions?.find(v => v.version === fromVersion)?.snapshot || [];
    const toFields = this._template.fields.filter(f => !f._deleted);
    const toFieldIds = new Set(toFields.map(f => f.fieldId));

    if (!this._submission.orphanedValues) this._submission.orphanedValues = {};

    // Move deleted field values to orphaned
    for (const [fieldId, value] of Object.entries(this._submission.values)) {
      if (!toFieldIds.has(fieldId)) {
        const oldField = fromSnapshot.find(f => f.fieldId === fieldId);
        this._submission.orphanedValues[fieldId] = {
          fieldId,
          label: oldField?.label || fieldId,
          type: oldField?.type || 'text',
          value: structuredClone(value),
          removedInVersion: toVersion
        };
        delete this._submission.values[fieldId];
      }
    }

    // Add defaults for new fields
    for (const field of toFields) {
      if (!(field.fieldId in this._submission.values)) {
        this._submission.values[field.fieldId] = field.defaultValue !== undefined
          ? structuredClone(field.defaultValue)
          : null;
      }
    }

    // Record migration
    this._addHistory('migrated');
    this._submission.templateVersion = toVersion;
    this._submission.metadata.updatedAt = new Date().toISOString();
    storage.save('submissions', this._submission.submissionId, this._submission);
  }

  _addHistory(action) {
    if (!this._submission.history) this._submission.history = [];
    this._submission.history.push({
      historyId: generateId('hist'),
      savedAt: new Date().toISOString(),
      templateVersion: this._submission.templateVersion,
      values: structuredClone(this._submission.values),
      action
    });
  }

  _findDrafts(templateId) {
    const keys = storage.list('submissions');
    const drafts = [];
    for (const key of keys) {
      const sub = storage.load('submissions', key);
      if (sub && sub.templateId === templateId && sub.status !== 'submitted') {
        drafts.push(sub);
      }
    }
    return drafts.sort((a, b) =>
      (b.metadata?.updatedAt || '').localeCompare(a.metadata?.updatedAt || '')
    );
  }

  _showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);
      padding:10px 24px;border-radius:4px;z-index:9999;font-size:14px;
      box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideUp 0.2s ease;
      background:${type === 'success' ? '#f6ffed' : '#fff7e6'};
      color:${type === 'success' ? '#52c41a' : '#faad14'};
      border:1px solid ${type === 'success' ? '#b7eb8f' : '#ffe58f'};`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  _statusLabel(s) {
    return { draft: '草稿', submitted: '已提交', returned: '已退回' }[s] || s;
  }

  _actionLabel(a) {
    return {
      draft_save: '保存草稿', submitted: '提交', returned: '退回',
      migrated: '版本迁移', restored: '恢复历史'
    }[a] || a;
  }

  _formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('fr-app', FRApp);
