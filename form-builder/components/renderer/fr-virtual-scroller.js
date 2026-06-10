// Virtual scroller for long forms using IntersectionObserver
import { fieldRegistry } from '../../core/field-registry.js';

const FIELD_HEIGHT_ESTIMATES = {
  text: 80, number: 80, date: 80,
  radio: 120, checkbox: 120,
  attachment: 100, addressCascade: 140,
  detailTable: 300, groupDesc: 60
};

const VIRTUAL_THRESHOLD = 30; // Activate virtual scrolling above this field count

export class FRVirtualScroller extends HTMLElement {
  #observer = null;
  #fieldDefs = [];
  #values = {};
  #placeholders = new Map(); // fieldId -> { height, mounted }
  #onValueChange = null;
  #mode = 'fill';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          overflow-y: auto;
          position: relative;
        }
        .scroll-container {
          position: relative;
        }
        .field-placeholder {
          transition: min-height 0.1s;
        }
      </style>
      <div class="scroll-container"></div>
    `;
  }

  get container() {
    return this.shadowRoot.querySelector('.scroll-container');
  }

  /**
   * Check if virtual scrolling should be used.
   */
  static shouldVirtualize(fieldCount) {
    return fieldCount > VIRTUAL_THRESHOLD;
  }

  configure(fieldDefs, values = {}, mode = 'fill') {
    this.#fieldDefs = fieldDefs;
    this.#values = values;
    this.#mode = mode;
    this.#setup();
  }

  setValueChangeHandler(handler) {
    this.#onValueChange = handler;
  }

  #setup() {
    const container = this.container;
    container.innerHTML = '';
    this.#placeholders.clear();

    // Disconnect old observer
    if (this.#observer) this.#observer.disconnect();

    this.#observer = new IntersectionObserver(
      this.#onIntersection.bind(this),
      { root: this, rootMargin: '200px 0px' }
    );

    for (const fieldDef of this.#fieldDefs) {
      const placeholder = document.createElement('div');
      placeholder.className = 'field-placeholder';
      placeholder.dataset.fieldId = fieldDef.fieldId;
      placeholder.style.minHeight = (FIELD_HEIGHT_ESTIMATES[fieldDef.type] || 80) + 'px';

      container.appendChild(placeholder);
      this.#observer.observe(placeholder);
      this.#placeholders.set(fieldDef.fieldId, { height: 0, mounted: false });
    }
  }

  #onIntersection(entries) {
    for (const entry of entries) {
      const fieldId = entry.target.dataset.fieldId;
      if (entry.isIntersecting) {
        this.#mount(fieldId, entry.target);
      } else {
        this.#unmount(fieldId, entry.target);
      }
    }
  }

  #mount(fieldId, placeholder) {
    const info = this.#placeholders.get(fieldId);
    if (!info || info.mounted) return;

    const fieldDef = this.#fieldDefs.find(f => f.fieldId === fieldId);
    if (!fieldDef) return;

    const tag = fieldRegistry.getTag(fieldDef.type);
    if (!tag) return;

    const component = document.createElement(tag);
    component.mode = this.#mode;
    component.configure(fieldDef);

    if (this.#values[fieldId] !== undefined) {
      component.setValue(this.#values[fieldId]);
    }

    if (this.#mode === 'fill') {
      component.addEventListener('field-change', (e) => {
        this.#values[e.detail.fieldId] = e.detail.value;
        this.#onValueChange?.(e.detail.fieldId, e.detail.value);
      });
    }

    placeholder.appendChild(component);
    info.mounted = true;

    // Record actual height
    requestAnimationFrame(() => {
      info.height = placeholder.offsetHeight;
    });
  }

  #unmount(fieldId, placeholder) {
    const info = this.#placeholders.get(fieldId);
    if (!info || !info.mounted) return;

    // Save value before unmounting
    const component = placeholder.firstElementChild;
    if (component?.getValue) {
      this.#values[fieldId] = component.getValue();
    }

    // Preserve measured height
    if (info.height > 0) {
      placeholder.style.minHeight = info.height + 'px';
    }

    placeholder.innerHTML = '';
    info.mounted = false;
  }

  getValues() {
    // Collect from mounted components
    for (const [fieldId, info] of this.#placeholders) {
      if (info.mounted) {
        const placeholder = this.container.querySelector(`[data-field-id="${fieldId}"]`);
        const component = placeholder?.firstElementChild;
        if (component?.getValue) {
          this.#values[fieldId] = component.getValue();
        }
      }
    }
    return structuredClone(this.#values);
  }

  validateAll() {
    const errors = new Map();
    // Mount all for validation
    for (const [fieldId, info] of this.#placeholders) {
      if (!info.mounted) {
        const placeholder = this.container.querySelector(`[data-field-id="${fieldId}"]`);
        if (placeholder) this.#mount(fieldId, placeholder);
      }
    }

    // Validate each mounted component
    for (const [fieldId] of this.#placeholders) {
      const placeholder = this.container.querySelector(`[data-field-id="${fieldId}"]`);
      const component = placeholder?.firstElementChild;
      if (component?.validate) {
        const result = component.validate();
        if (!result.valid) {
          errors.set(fieldId, result.errors);
        }
      }
    }

    return errors;
  }

  scrollToField(fieldId) {
    const placeholder = this.container.querySelector(`[data-field-id="${fieldId}"]`);
    if (placeholder) {
      placeholder.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  disconnectedCallback() {
    if (this.#observer) {
      this.#observer.disconnect();
      this.#observer = null;
    }
  }
}

customElements.define('fr-virtual-scroller', FRVirtualScroller);
