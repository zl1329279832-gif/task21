import { BaseField } from './base-field.js';

export class FFNumber extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const config = this._fieldDef?.config || {};
    const step = config.step ?? 1;
    const displayVal = this._value != null ? String(this._value) : '';
    body.innerHTML = `<input type="number"
      ${config.min != null ? `min="${config.min}"` : ''}
      ${config.max != null ? `max="${config.max}"` : ''}
      step="${step}"
      ${this._mode === 'design' ? 'disabled' : ''}
      value="${displayVal}">`;

    if (this._mode === 'fill') {
      const input = body.querySelector('input');
      input.addEventListener('input', () => {
        if (input.value === '') {
          this._value = null;
        } else {
          const num = parseFloat(input.value);
          this._value = isNaN(num) ? null : num;
        }
        this._emitChange();
      });
      input.addEventListener('blur', () => {
        const precision = config.precision ?? 0;
        if (this._value != null) {
          this._value = parseFloat(this._value.toFixed(precision));
          input.value = this._value.toFixed(precision);
        }
        this.validate();
      });
    }
  }

  _updateDisplay() {
    const input = this.shadowRoot.querySelector('input');
    if (!input) return;
    const displayVal = this._value != null ? String(this._value) : '';
    if (input.value !== displayVal) {
      input.value = displayVal;
    }
  }

  _validateType(config, value) {
    if (config.min != null && value < config.min) {
      this._errors.push(this._fieldDef.errorMessages?.range || `值不能小于${config.min}`);
    }
    if (config.max != null && value > config.max) {
      this._errors.push(this._fieldDef.errorMessages?.range || `值不能大于${config.max}`);
    }
  }
}

customElements.define('ff-number', FFNumber);
