import { BaseField } from './base-field.js';

export class FFText extends BaseField {
  _render() {
    const body = this._getBody();
    if (!body) return;
    const config = this._fieldDef?.config || {};
    body.innerHTML = `<input type="text"
      placeholder="${config.placeholder || ''}"
      ${config.maxLength ? `maxlength="${config.maxLength}"` : ''}
      ${this._mode === 'design' ? 'disabled' : ''}
      value="${this._escapeAttr(this._value || '')}">`;

    if (this._mode === 'fill') {
      const input = body.querySelector('input');
      input.addEventListener('input', () => {
        this._value = input.value;
        this._emitChange();
      });
      input.addEventListener('blur', () => this.validate());
    }
  }

  _updateDisplay() {
    const input = this.shadowRoot.querySelector('input');
    if (input && input.value !== (this._value || '')) {
      input.value = this._value || '';
    }
  }

  _validateType(config, value) {
    if (config.minLength && value.length < config.minLength) {
      this._errors.push(this._fieldDef.errorMessages?.range || `最少输入${config.minLength}个字符`);
    }
    if (config.maxLength && value.length > config.maxLength) {
      this._errors.push(this._fieldDef.errorMessages?.range || `最多输入${config.maxLength}个字符`);
    }
    if (config.regex) {
      try {
        if (!new RegExp(config.regex).test(value)) {
          this._errors.push(config.regexMessage || this._fieldDef.errorMessages?.regex || '格式不正确');
        }
      } catch { /* invalid regex, skip */ }
    }
  }

  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ff-text', FFText);
