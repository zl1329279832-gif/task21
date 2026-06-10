import { fieldRegistry } from '../../core/field-registry.js';
import { eventBus } from '../../core/event-bus.js';
import { dragDropEngine } from '../../utils/drag-drop.js';

class FBCanvas extends HTMLElement {
  constructor() {
    super();
    this._fields = [];
    this._selectedFieldId = null;
  }

  connectedCallback() {
    this.classList.add('builder-canvas');
    this._canvasInner = document.createElement('div');
    this._canvasInner.className = 'canvas-inner';
    this.appendChild(this._canvasInner);

    dragDropEngine.init(this._canvasInner);

    eventBus.on('dnd:drop', ({ fieldType, index }) => {
      const order = index != null ? index : this._fields.length;
      const fieldDef = fieldRegistry.createFieldDef(fieldType, order);
      eventBus.emit('field:add', { fieldDef, index: order });
    });

    eventBus.on('dnd:reorder', ({ fieldId, fromIndex, targetIndex }) => {
      eventBus.emit('field:moved', { fieldId, fromIndex, targetIndex });
    });

    eventBus.on('field:selected', ({ fieldId }) => {
      this._selectedFieldId = fieldId;
      const fieldEls = this._canvasInner.querySelectorAll('fb-canvas-field');
      fieldEls.forEach((el) => {
        el.setSelected(el.getAttribute('data-field-id') === fieldId);
      });
    });

    this._renderEmpty();
  }

  renderFields(fields) {
    this._fields = fields;
    this._canvasInner.innerHTML = '';

    if (!fields || fields.length === 0) {
      this._renderEmpty();
      return;
    }

    const sorted = [...fields].sort((a, b) => a.order - b.order);

    sorted.forEach((fieldDef) => {
      const el = document.createElement('fb-canvas-field');
      el.configure(fieldDef);
      if (this._selectedFieldId && fieldDef.fieldId === this._selectedFieldId) {
        el.setSelected(true);
      }
      this._canvasInner.appendChild(el);
    });
  }

  _renderEmpty() {
    this._canvasInner.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'canvas-empty';

    const icon = document.createElement('div');
    icon.textContent = '\uD83D\uDCCB';
    icon.style.fontSize = '48px';
    empty.appendChild(icon);

    const text = document.createElement('div');
    text.textContent = '\u62D6\u62FD\u5DE6\u4FA7\u5B57\u6BB5\u5230\u6B64\u5904';
    empty.appendChild(text);

    this._canvasInner.appendChild(empty);
  }
}

customElements.define('fb-canvas', FBCanvas);
