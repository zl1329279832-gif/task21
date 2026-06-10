import { fieldRegistry } from '../../core/field-registry.js';
import { eventBus } from '../../core/event-bus.js';
import { dragDropEngine } from '../../utils/drag-drop.js';

class FBCanvasField extends HTMLElement {
  constructor() {
    super();
    this._fieldDef = null;
  }

  configure(fieldDef) {
    this._fieldDef = fieldDef;
    this.setAttribute('data-field-id', fieldDef.fieldId);
    this._buildDOM();
  }

  _buildDOM() {
    this.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-field';

    // Drag handle
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.textContent = '\u2807';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      const fromIndex = this._getIndex();
      dragDropEngine.startDrag(e, {
        action: 'move',
        fieldId: this._fieldDef.fieldId,
        fromIndex
      });
    });
    wrapper.appendChild(handle);

    // Field actions
    const actions = document.createElement('div');
    actions.className = 'field-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '\u29C9';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eventBus.emit('field:copy', { fieldId: this._fieldDef.fieldId });
    });
    actions.appendChild(copyBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '\u00D7';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eventBus.emit('field:remove', { fieldId: this._fieldDef.fieldId });
    });
    actions.appendChild(deleteBtn);

    wrapper.appendChild(actions);

    // Field component
    const tag = fieldRegistry.getTag(this._fieldDef.type);
    const fieldEl = document.createElement(tag);
    fieldEl.mode = 'design';
    if (typeof fieldEl.configure === 'function') {
      fieldEl.configure(this._fieldDef);
    }
    wrapper.appendChild(fieldEl);

    // Click to select
    wrapper.addEventListener('click', () => {
      eventBus.emit('field:selected', { fieldId: this._fieldDef.fieldId });
    });

    this.appendChild(wrapper);
  }

  setSelected(bool) {
    const wrapper = this.querySelector('.canvas-field');
    if (wrapper) {
      wrapper.classList.toggle('selected', bool);
    }
  }

  _getIndex() {
    const parent = this.parentElement;
    if (!parent) return 0;
    return Array.from(parent.querySelectorAll('fb-canvas-field')).indexOf(this);
  }
}

customElements.define('fb-canvas-field', FBCanvasField);
