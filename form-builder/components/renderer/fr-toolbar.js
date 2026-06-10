// Renderer toolbar
export class FRToolbar extends HTMLElement {
  _status = 'draft';
  _autoSaveState = '';
  _onAction = null;

  connectedCallback() {
    this.classList.add('renderer-toolbar');
    this._render();
  }

  setStatus(status) {
    this._status = status;
    const badge = this.querySelector('.toolbar-status');
    if (badge) {
      badge.className = `toolbar-status ${status}`;
      badge.textContent = this._statusLabel(status);
    }
  }

  setAutoSaveState(state) {
    this._autoSaveState = state;
    const indicator = this.querySelector('.auto-save-indicator');
    if (indicator) {
      indicator.className = `auto-save-indicator ${state}`;
      indicator.textContent = state === 'saving' ? '保存中...' : state === 'saved' ? '已自动保存' : '';
    }
  }

  setActionHandler(handler) {
    this._onAction = handler;
  }

  _render() {
    this.innerHTML = `
      <span class="toolbar-title">表单填报</span>
      <span class="toolbar-status ${this._status}">${this._statusLabel(this._status)}</span>
      <span class="auto-save-indicator"></span>
      <button class="btn btn-default" id="btnSaveDraft">💾 保存草稿</button>
      <button class="btn btn-primary" id="btnSubmit">✓ 提交</button>
      <div class="toolbar-sep" style="width:1px;height:24px;background:var(--border-light);margin:0 8px"></div>
      <button class="btn btn-text" id="btnHistory">📋 历史版本</button>
      <button class="btn btn-text" id="btnExport">导出数据</button>
    `;

    this.querySelector('#btnSaveDraft').addEventListener('click', () => this._onAction?.('saveDraft'));
    this.querySelector('#btnSubmit').addEventListener('click', () => this._onAction?.('submit'));
    this.querySelector('#btnHistory').addEventListener('click', () => this._onAction?.('history'));
    this.querySelector('#btnExport').addEventListener('click', () => this._onAction?.('export'));
  }

  _statusLabel(s) {
    return { draft: '草稿', submitted: '已提交', returned: '已退回' }[s] || s;
  }
}

customElements.define('fr-toolbar', FRToolbar);
