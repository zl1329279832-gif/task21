import { BaseField } from './base-field.js';

export class FFAttachment extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const config = this._fieldDef?.config || {};
    const accept = config.accept || '';
    const files = Array.isArray(this._value) ? this._value : [];
    const isDesign = this._mode === 'design';

    body.innerHTML = `
      <style>
        .drop-zone {
          border: 2px dashed #d9d9d9;
          border-radius: 4px;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: ${isDesign ? 'default' : 'pointer'};
          transition: border-color 0.2s;
          background: #fafafa;
          gap: 8px;
        }
        .drop-zone:hover {
          border-color: ${isDesign ? '#d9d9d9' : '#1890ff'};
        }
        .drop-zone .file-icon {
          font-size: 28px;
          color: #999;
        }
        .drop-zone .drop-text {
          font-size: 14px;
          color: #999;
        }
        .file-input-hidden {
          display: none;
        }
        .file-list {
          margin-top: 8px;
        }
        .file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          border: 1px solid #e8e8e8;
          border-radius: 4px;
          margin-bottom: 4px;
          font-size: 13px;
          color: #333;
        }
        .file-item-info {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        .file-item-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .file-item-size {
          color: #999;
          font-size: 12px;
          flex-shrink: 0;
        }
        .file-remove {
          background: none;
          border: none;
          color: #999;
          cursor: pointer;
          font-size: 16px;
          padding: 0 4px;
          line-height: 1;
          flex-shrink: 0;
        }
        .file-remove:hover {
          color: #e74c3c;
        }
      </style>
      <div class="drop-zone">
        <span class="file-icon">&#128206;</span>
        <span class="drop-text">点击或拖拽上传文件</span>
      </div>
      <input class="file-input-hidden" type="file" ${accept ? `accept="${this._escapeAttr(accept)}"` : ''} multiple>
      <div class="file-list">
        ${files.map((f, i) => `
          <div class="file-item" data-index="${i}">
            <div class="file-item-info">
              <span class="file-item-name">${this._escapeAttr(f.name)}</span>
              <span class="file-item-size">${this._formatSize(f.size)}</span>
            </div>
            ${isDesign ? '' : `<button class="file-remove" data-index="${i}" type="button">&times;</button>`}
          </div>
        `).join('')}
      </div>`;

    if (!isDesign) {
      const dropZone = body.querySelector('.drop-zone');
      const fileInput = body.querySelector('.file-input-hidden');

      dropZone.addEventListener('click', () => fileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#1890ff';
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#d9d9d9';
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#d9d9d9';
        if (e.dataTransfer.files.length) {
          this._addFiles(e.dataTransfer.files);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
          this._addFiles(fileInput.files);
          fileInput.value = '';
        }
      });

      body.querySelectorAll('.file-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index, 10);
          if (!Array.isArray(this._value)) return;
          this._value.splice(idx, 1);
          this._render();
          this._emitChange();
        });
      });
    }
  }

  _addFiles(fileList) {
    if (!Array.isArray(this._value)) this._value = [];
    for (const file of fileList) {
      this._value.push({
        name: file.name,
        size: file.size,
        type: file.type,
        addedAt: new Date().toISOString()
      });
    }
    this._render();
    this._emitChange();
  }

  _updateDisplay() {
    this._render();
  }

  _validateType(config, value) {
    const maxFiles = config.maxFiles || 5;
    const count = Array.isArray(value) ? value.length : 0;
    if (count > maxFiles) {
      this._errors.push(this._fieldDef.errorMessages?.maxFiles || `最多上传${maxFiles}个文件`);
    }
  }

  _formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ff-attachment', FFAttachment);
