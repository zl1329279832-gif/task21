import { BaseField } from './base-field.js';

export class FFRadio extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const options = this._fieldDef?.options || [];
    const name = this._fieldDef?.fieldId || 'radio';
    const currentVal = this._value || '';

    body.innerHTML = `
      <style>
        .radio-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .radio-item {
          display: flex;
          align-items: center;
          cursor: pointer;
          font-size: 14px;
          color: #333;
        }
        .radio-item input[type="radio"] {
          width: auto;
          margin: 0 8px 0 0;
          cursor: pointer;
        }
      </style>
      <div class="radio-group">
        ${options.map(opt => `
          <label class="radio-item">
            <input type="radio"
              name="${this._escapeAttr(name)}"
              value="${this._escapeAttr(opt.value)}"
              ${opt.value === currentVal ? 'checked' : ''}
              ${this._mode === 'design' ? 'disabled' : ''}>
            ${this._escapeAttr(opt.label)}
          </label>
        `).join('')}
      </div>`;

    if (this._mode === 'fill') {
      const radios = body.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            this._value = radio.value;
            this._emitChange();
          }
        });
      });
    }
  }

  _updateDisplay() {
    const radios = this.shadowRoot.querySelectorAll('input[type="radio"]');
    const currentVal = this._value || '';
    radios.forEach(radio => {
      radio.checked = radio.value === currentVal;
    });
  }

  _validateType(_config, value) {
    const options = this._fieldDef?.options || [];
    const validValues = options.map(opt => opt.value);
    if (!validValues.includes(value)) {
      this._errors.push(this._fieldDef.errorMessages?.invalid || '请选择有效的选项');
    }
  }

  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ff-radio', FFRadio);
