// Abstract base class for all form field Web Components
export class BaseField extends HTMLElement {
  _fieldDef = null;
  _mode = 'fill'; // 'design' or 'fill'
  _value = null;
  _errors = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = this._getBaseTemplate();
  }

  _getBaseTemplate() {
    return `
      <style>
        :host {
          display: block;
          margin-bottom: 12px;
          font-family: -apple-system, "Microsoft YaHei", sans-serif;
          font-size: 14px;
        }
        :host([hidden]) { display: none; }
        .field-wrapper { position: relative; }
        .field-label {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
          font-weight: 500;
          color: #333;
          line-height: 1.5;
        }
        .field-label .required {
          color: #e74c3c;
          margin-right: 4px;
          font-weight: bold;
        }
        .field-body { position: relative; }
        .field-error {
          color: #e74c3c;
          font-size: 12px;
          margin-top: 4px;
          min-height: 0;
        }
        .field-error:empty { display: none; }
        .field-description {
          color: #888;
          font-size: 12px;
          margin-top: 2px;
        }
        /* Design mode */
        :host(.design-mode) .field-body {
          pointer-events: none;
          opacity: 0.7;
        }
        /* Common input styles */
        input, select, textarea {
          box-sizing: border-box;
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d9d9d9;
          border-radius: 4px;
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s;
          outline: none;
          background: #fff;
        }
        input:focus, select:focus, textarea:focus {
          border-color: #1890ff;
          box-shadow: 0 0 0 2px rgba(24,144,255,0.1);
        }
        input:disabled, select:disabled, textarea:disabled {
          background: #f5f5f5;
          cursor: not-allowed;
        }
        input.has-error, select.has-error, textarea.has-error {
          border-color: #e74c3c;
        }
        input.has-error:focus, select.has-error:focus, textarea.has-error:focus {
          box-shadow: 0 0 0 2px rgba(231,76,60,0.1);
        }
      </style>
      <div class="field-wrapper">
        <label class="field-label">
          <span class="required" style="display:none">*</span>
          <span class="label-text"></span>
        </label>
        <div class="field-body"></div>
        <div class="field-error"></div>
      </div>
    `;
  }

  configure(fieldDef) {
    this._fieldDef = fieldDef;
    const label = this.shadowRoot.querySelector('.label-text');
    const required = this.shadowRoot.querySelector('.required');
    if (label) label.textContent = fieldDef.label || '';
    if (required) required.style.display = fieldDef.config?.required ? '' : 'none';
    if (fieldDef.defaultValue !== undefined && this._value === null) {
      this._value = structuredClone(fieldDef.defaultValue);
    }
    this._render();
  }

  get mode() { return this._mode; }
  set mode(val) {
    this._mode = val;
    this.classList.toggle('design-mode', val === 'design');
    this._render();
  }

  getValue() {
    return structuredClone(this._value);
  }

  setValue(value) {
    this._value = value;
    this._updateDisplay();
  }

  validate() {
    this._errors = [];
    if (!this._fieldDef) return { valid: true, errors: [] };
    const config = this._fieldDef.config || {};
    const val = this._value;

    if (config.required && this._isEmpty(val)) {
      this._errors.push(this._fieldDef.errorMessages?.required || `${this._fieldDef.label}不能为空`);
      this._showErrors();
      return { valid: false, errors: [...this._errors] };
    }

    if (!this._isEmpty(val)) {
      this._validateType(config, val);
    }

    this._showErrors();
    return { valid: this._errors.length === 0, errors: [...this._errors] };
  }

  _validateType(_config, _value) {
    // Override in subclasses
  }

  _isEmpty(val) {
    if (val === null || val === undefined || val === '') return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.values(val).every(v => !v);
    return false;
  }

  setError(msg) {
    this._errors = Array.isArray(msg) ? msg : [msg];
    this._showErrors();
  }

  clearError() {
    this._errors = [];
    this._showErrors();
  }

  _showErrors() {
    const el = this.shadowRoot.querySelector('.field-error');
    if (el) el.textContent = this._errors.join('; ');
    const inputs = this.shadowRoot.querySelectorAll('input, select, textarea');
    inputs.forEach(inp => inp.classList.toggle('has-error', this._errors.length > 0));
  }

  _render() {
    // Override in subclasses
  }

  _updateDisplay() {
    // Override in subclasses for value-only updates
    this._render();
  }

  _emitChange() {
    this.dispatchEvent(new CustomEvent('field-change', {
      bubbles: true,
      composed: true,
      detail: { fieldId: this._fieldDef?.fieldId, value: this.getValue() }
    }));
  }

  _getBody() {
    return this.shadowRoot.querySelector('.field-body');
  }
}
