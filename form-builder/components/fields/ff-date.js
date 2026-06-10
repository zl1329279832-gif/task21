import { BaseField } from './base-field.js';

export class FFDate extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const config = this._fieldDef?.config || {};
    body.innerHTML = `<input type="date"
      ${config.minDate ? `min="${config.minDate}"` : ''}
      ${config.maxDate ? `max="${config.maxDate}"` : ''}
      ${this._mode === 'design' ? 'disabled' : ''}
      value="${this._value || ''}">`;

    if (this._mode === 'fill') {
      const input = body.querySelector('input');
      input.addEventListener('change', () => {
        this._value = input.value || '';
        this._emitChange();
      });
      input.addEventListener('blur', () => this.validate());
    }
  }

  _updateDisplay() {
    const input = this.shadowRoot.querySelector('input');
    if (!input) return;
    const val = this._value || '';
    if (input.value !== val) {
      input.value = val;
    }
  }

  _validateType(config, value) {
    if (config.minDate && value < config.minDate) {
      this._errors.push(this._fieldDef.errorMessages?.range || `日期不能早于${config.minDate}`);
    }
    if (config.maxDate && value > config.maxDate) {
      this._errors.push(this._fieldDef.errorMessages?.range || `日期不能晚于${config.maxDate}`);
    }
  }
}

customElements.define('ff-date', FFDate);
