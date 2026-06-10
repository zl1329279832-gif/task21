import { fieldRegistry } from '../../core/field-registry.js';
import { dragDropEngine } from '../../utils/drag-drop.js';

class FBPalette extends HTMLElement {
  connectedCallback() {
    this.classList.add('builder-palette');
    this._buildPalette();
  }

  _buildPalette() {
    const categories = fieldRegistry.getCategories();

    categories.forEach(({ key, label }) => {
      const section = document.createElement('div');
      section.className = 'palette-section';

      const title = document.createElement('div');
      title.className = 'palette-section-title';
      title.textContent = label;
      section.appendChild(title);

      const types = fieldRegistry.getByCategory(key);

      types.forEach((type) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.draggable = true;

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.textContent = fieldRegistry.getIcon(type);
        item.appendChild(icon);

        const labelSpan = document.createElement('span');
        labelSpan.textContent = fieldRegistry.getLabel(type);
        item.appendChild(labelSpan);

        item.addEventListener('dragstart', (e) => {
          dragDropEngine.startDrag(e, { action: 'add', fieldType: type });
        });

        section.appendChild(item);
      });

      this.appendChild(section);
    });
  }
}

customElements.define('fb-palette', FBPalette);
