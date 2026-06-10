import { BaseField } from './base-field.js';

export class FFGroupDesc extends BaseField {
  _collapsed = false;

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
        .field-body { position: relative; }
      </style>
      <div class="field-wrapper">
        <div class="field-body"></div>
      </div>
    `;
  }

  configure(fieldDef) {
    this._fieldDef = fieldDef;
    const config = fieldDef.config || {};
    this._collapsed = !!config.defaultCollapsed;
    this._value = null;
    this._render();
  }

  _render() {
    const body = this._getBody();
    if (!body) return;
    const config = this._fieldDef?.config || {};
    const label = this._fieldDef?.label || '';
    const description = config.description || '';
    const collapsible = !!config.collapsible;
    const arrow = this._collapsed ? '&#9654;' : '&#9660;';

    body.innerHTML = `
      <style>
        .group-heading {
          border-bottom: 2px solid #1890ff;
          padding-bottom: 8px;
          margin-top: 16px;
        }
        .group-title {
          display: flex;
          align-items: center;
          font-size: 16px;
          font-weight: 600;
          color: #333;
          line-height: 1.5;
        }
        .collapse-toggle {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          color: #666;
          padding: 0;
          margin-right: 8px;
          line-height: 1;
          display: flex;
          align-items: center;
        }
        .collapse-toggle:hover {
          color: #1890ff;
        }
        .group-description {
          font-size: 13px;
          color: #888;
          margin-top: 6px;
          line-height: 1.5;
        }
        .group-description.hidden {
          display: none;
        }
      </style>
      <div class="group-heading">
        <div class="group-title">
          ${collapsible ? `<button class="collapse-toggle" type="button">${arrow}</button>` : ''}
          <span>${this._escapeAttr(label)}</span>
        </div>
        ${description ? `<div class="group-description ${this._collapsed ? 'hidden' : ''}">${this._escapeAttr(description)}</div>` : ''}
      </div>`;

    if (collapsible) {
      const toggle = body.querySelector('.collapse-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          this._collapsed = !this._collapsed;
          this._render();
          this.dispatchEvent(new CustomEvent('group-toggle', {
            bubbles: true,
            composed: true,
            detail: {
              fieldId: this._fieldDef?.fieldId,
              collapsed: this._collapsed
            }
          }));
        });
      }
    }
  }

  _updateDisplay() {
    this._render();
  }

  getValue() {
    return null;
  }

  setValue(_value) {
    this._value = null;
  }

  validate() {
    return { valid: true, errors: [] };
  }

  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ff-group-desc', FFGroupDesc);
