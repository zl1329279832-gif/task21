import { BaseField } from './base-field.js';

export class FFCheckbox extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const options = this._fieldDef?.options || [];
    const currentVal = Array.isArray(this._value) ? this._value : [];

    body.innerHTML = `
      <style>
        .checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .checkbox-item {
          display: flex;
          align-items: center;
          cursor: pointer;
          font-size: 14px;
          color: #333;
        }
        .checkbox-item input[type="checkbox"] {
          width: auto;
          margin: 0 8px 0 0;
          cursor: pointer;
        }
      </style>
      <div class="checkbox-group">
        ${options.map(opt => `
          <label class="checkbox-item">
            <input type="checkbox"
              value="${this._escapeAttr(opt.value)}"
              ${currentVal.includes(opt.value) ? 'checked' : ''}
              ${this._mode === 'design' ? 'disabled' : ''}>
            ${this._escapeAttr(opt.label)}
          </label>
        `).join('')}
      </div>`;

    if (this._mode === 'fill') {
      const checkboxes = body.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
          this._value = this._collectCheckedValues();
          this._emitChange();
        });
      });
    }
  }

  _collectCheckedValues() {
    const checkboxes = this.shadowRoot.querySelectorAll('input[type="checkbox"]');
    const values = [];
    checkboxes.forEach(cb => {
      if (cb.checked) values.push(cb.value);
    });
    return values;
  }

  _updateDisplay() {
    const checkboxes = this.shadowRoot.querySelectorAll('input[type="checkbox"]');
    const currentVal = Array.isArray(this._value) ? this._value : [];
    checkboxes.forEach(cb => {
      cb.checked = currentVal.includes(cb.value);
    });
  }

  _validateType(config, value) {
    const count = Array.isArray(value) ? value.length : 0;
    const minSelect = config.minSelect || 0;
    const maxSelect = config.maxSelect || 0;

    if (minSelect > 0 && count < minSelect) {
      this._errors.push(this._fieldDef.errorMessages?.minSelect || `至少选择${minSelect}项`);
    }
    if (maxSelect > 0 && count > maxSelect) {
      this._errors.push(this._fieldDef.errorMessages?.maxSelect || `最多选择${maxSelect}项`);
    }
  }

  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ff-checkbox', FFCheckbox);
