// Drag-and-drop engine using HTML5 DnD API
import { eventBus } from '../core/event-bus.js';

export class DragDropEngine {
  #canvas = null;
  #dragData = null;
  #indicator = null;
  #enterCount = 0;

  init(canvas) {
    this.#canvas = canvas;
    this.#indicator = document.createElement('div');
    this.#indicator.className = 'drop-indicator';
    this.#indicator.style.display = 'none';

    canvas.addEventListener('dragover', this.#onDragOver.bind(this));
    canvas.addEventListener('dragenter', this.#onDragEnter.bind(this));
    canvas.addEventListener('dragleave', this.#onDragLeave.bind(this));
    canvas.addEventListener('drop', this.#onDrop.bind(this));
  }

  startDrag(e, data) {
    this.#dragData = data;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(data));
    if (e.target.classList) {
      requestAnimationFrame(() => e.target.classList.add('dragging'));
    }
  }

  #onDragEnter(e) {
    e.preventDefault();
    this.#enterCount++;
  }

  #onDragLeave(e) {
    e.preventDefault();
    this.#enterCount--;
    if (this.#enterCount <= 0) {
      this.#enterCount = 0;
      this.#hideIndicator();
    }
  }

  #onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = this.#getDropTarget(e);
    if (target) {
      this.#showIndicator(target.element, target.position);
    }
  }

  #onDrop(e) {
    e.preventDefault();
    this.#enterCount = 0;
    this.#hideIndicator();

    let data = this.#dragData;
    if (!data) {
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch { return; }
    }

    const target = this.#getDropTarget(e);
    const dropIndex = target ? target.index : -1;

    if (data.action === 'add') {
      eventBus.emit('dnd:drop', { fieldType: data.fieldType, targetIndex: dropIndex });
    } else if (data.action === 'move') {
      eventBus.emit('dnd:reorder', {
        fieldId: data.fieldId,
        fromIndex: data.fromIndex,
        targetIndex: dropIndex
      });
    }

    this.#dragData = null;
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  }

  #getDropTarget(e) {
    const fields = Array.from(this.#canvas.querySelectorAll('.canvas-field'));
    if (fields.length === 0) {
      return { element: this.#canvas, position: 'inside', index: 0 };
    }

    let closest = null;
    let closestDist = Infinity;
    let closestIndex = 0;
    let position = 'after';

    for (let i = 0; i < fields.length; i++) {
      const rect = fields[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - midY);

      if (dist < closestDist) {
        closestDist = dist;
        closest = fields[i];
        closestIndex = i;
        position = e.clientY < midY ? 'before' : 'after';
      }
    }

    const index = position === 'before' ? closestIndex : closestIndex + 1;
    return { element: closest, position, index };
  }

  #showIndicator(element, position) {
    this.#indicator.style.display = 'block';
    if (position === 'inside') {
      element.appendChild(this.#indicator);
    } else if (position === 'before') {
      element.parentNode.insertBefore(this.#indicator, element);
    } else {
      element.parentNode.insertBefore(this.#indicator, element.nextSibling);
    }
  }

  #hideIndicator() {
    this.#indicator.style.display = 'none';
    if (this.#indicator.parentNode) {
      this.#indicator.parentNode.removeChild(this.#indicator);
    }
  }

  destroy() {
    this.#hideIndicator();
    this.#canvas = null;
    this.#dragData = null;
  }
}

export const dragDropEngine = new DragDropEngine();
