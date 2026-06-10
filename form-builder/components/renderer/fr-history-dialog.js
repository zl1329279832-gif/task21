// History version dialog for renderer
export class FRHistoryDialog extends HTMLElement {
  _history = [];
  _onSelect = null;
  _onClose = null;

  show(history, onSelect, onClose) {
    this._history = history || [];
    this._onSelect = onSelect;
    this._onClose = onClose;
    this._render();
  }

  _render() {
    const reversed = [...this._history].reverse();
    this.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width:500px">
          <div class="modal-header">
            <span>历史版本 (${this._history.length}条)</span>
            <span class="modal-close">&times;</span>
          </div>
          <div class="modal-body" style="padding:0;max-height:60vh;overflow-y:auto">
            ${reversed.length === 0
              ? '<div class="text-muted text-center" style="padding:40px">暂无历史记录</div>'
              : reversed.map((h, i) => `
                <div class="history-item" data-idx="${this._history.length - 1 - i}">
                  <div class="flex items-center justify-between">
                    <span class="history-time">${this._formatDate(h.savedAt)}</span>
                    <span class="history-version">v${h.templateVersion}</span>
                  </div>
                  <div class="history-action">${this._actionLabel(h.action)}</div>
                </div>`).join('')
            }
          </div>
          <div class="modal-footer">
            <button class="btn btn-default modal-close-btn">关闭</button>
          </div>
        </div>
      </div>`;

    this.querySelector('.modal-close').addEventListener('click', () => this._close());
    this.querySelector('.modal-close-btn').addEventListener('click', () => this._close());
    this.querySelector('.modal-overlay').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) this._close();
    });

    this.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx);
        const entry = this._history[idx];
        if (entry && this._onSelect) {
          this._onSelect(entry);
          this._close();
        }
      });
    });
  }

  _close() {
    this.innerHTML = '';
    this._onClose?.();
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
}

customElements.define('fr-history-dialog', FRHistoryDialog);
