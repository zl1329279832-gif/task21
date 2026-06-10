// Form renderer - dynamically renders form from template config
import { fieldRegistry } from '../../core/field-registry.js';
import { ValidationEngine } from '../../core/validation-engine.js';
import { debounce } from '../../utils/debounce-throttle.js';

export class FRForm extends HTMLElement {
  _template = null;
  _values = {};
  _fieldComponents = new Map(); // fieldId -> component element
  _validationEngine = new ValidationEngine();
  _mode = 'fill'; // 'fill' or 'readonly'

  connectedCallback() {
    this.classList.add('renderer-form');
  }

  configure(template, values = {}, mode = 'fill') {
    this._template = template;
    this._values = structuredClone(values);
    this._mode = mode;
    this._render();
  }

  _render() {
    if (!this._template) return;
    this.innerHTML = '';
    this._fieldComponents.clear();

    const fields = (this._template.fields || [])
      .filter(f => !f._deleted)
      .sort((a, b) => a.order - b.order);

    // Title
    const title = document.createElement('div');
    title.className = 'form-title';
    title.textContent = this._template.name || '表单';
    this.appendChild(title);

    if (this._template.currentVersion > 0) {
      const ver = document.createElement('div');
      ver.className = 'form-version';
      ver.textContent = `v${this._template.currentVersion}`;
      this.appendChild(ver);
    }

    // Fields container
    const container = document.createElement('div');
    container.className = 'form-fields';
    this.appendChild(container);

    // Render fields
    for (const fieldDef of fields) {
      const visible = this._validationEngine.isFieldVisible(fieldDef, this._values, fields);
      const wrapper = document.createElement('div');
      wrapper.dataset.fieldId = fieldDef.fieldId;
      wrapper.style.display = visible ? '' : 'none';

      const tag = fieldRegistry.getTag(fieldDef.type);
      if (!tag) continue;

      const component = document.createElement(tag);
      component.mode = this._mode === 'readonly' ? 'design' : 'fill';
      component.configure(fieldDef);

      // Set value
      if (this._values[fieldDef.fieldId] !== undefined) {
        component.setValue(this._values[fieldDef.fieldId]);
      }

      // Listen for changes
      if (this._mode === 'fill') {
        component.addEventListener('field-change', (e) => {
          this._values[e.detail.fieldId] = e.detail.value;
          this._onValueChange(e.detail.fieldId);
        });
      }

      wrapper.appendChild(component);
      container.appendChild(wrapper);
      this._fieldComponents.set(fieldDef.fieldId, component);
    }

    // Group toggle handling
    this.addEventListener('group-toggle', (e) => {
      const { fieldId, collapsed } = e.detail;
      const groupField = fields.find(f => f.fieldId === fieldId);
      if (!groupField?.childFieldIds) return;
      for (const childId of groupField.childFieldIds) {
        const wrapper = container.querySelector(`[data-field-id="${childId}"]`);
        if (wrapper) wrapper.style.display = collapsed ? 'none' : '';
      }
    });
  }

  _onValueChange = debounce((changedFieldId) => {
    // Re-evaluate conditional visibility
    const fields = (this._template?.fields || []).filter(f => !f._deleted);
    for (const field of fields) {
      if (!field.conditions || field.conditions.length === 0) continue;
      const isSource = field.conditions.some(c => c.sourceFieldId === changedFieldId);
      if (!isSource) continue;

      const visible = this._validationEngine.isFieldVisible(field, this._values, fields);
      const wrapper = this.querySelector(`[data-field-id="${field.fieldId}"]`);
      if (wrapper) wrapper.style.display = visible ? '' : 'none';
    }

    this.dispatchEvent(new CustomEvent('form-change', {
      bubbles: true,
      detail: { values: this.getValues() }
    }));
  }, 150);

  getValues() {
    // Collect current values from all components
    for (const [fieldId, comp] of this._fieldComponents) {
      this._values[fieldId] = comp.getValue();
    }
    return structuredClone(this._values);
  }

  validate() {
    const fields = (this._template?.fields || []).filter(f => !f._deleted);
    const values = this.getValues();
    const result = this._validationEngine.validateForm(fields, values);

    // Show errors on components
    for (const [fieldId, comp] of this._fieldComponents) {
      const errs = result.errors.get(fieldId);
      if (errs) {
        comp.setError(errs);
      } else {
        comp.clearError();
      }
    }

    return result;
  }

  clearValidation() {
    for (const comp of this._fieldComponents.values()) {
      comp.clearError();
    }
  }

  scrollToField(fieldId) {
    const wrapper = this.querySelector(`[data-field-id="${fieldId}"]`);
    if (wrapper) {
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      wrapper.style.animation = 'pulse 0.5s ease 2';
    }
  }
}

customElements.define('fr-form', FRForm);
