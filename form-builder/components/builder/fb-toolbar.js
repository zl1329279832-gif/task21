// Builder toolbar - top bar with actions
import { eventBus } from '../../core/event-bus.js';

export class FBToolbar extends HTMLElement {
  _canUndo = false;
  _canRedo = false;
  _templateName = '新建表单';

  connectedCallback() {
    this.classList.add('builder-toolbar');
    this._render();

    eventBus.on('command:stateChanged', ({ canUndo, canRedo }) => {
      this._canUndo = canUndo;
      this._canRedo = canRedo;
      const undoBtn = this.querySelector('#btnUndo');
      const redoBtn = this.querySelector('#btnRedo');
      if (undoBtn) undoBtn.disabled = !canUndo;
      if (redoBtn) redoBtn.disabled = !canRedo;
    });
  }

  setTemplateName(name) {
    this._templateName = name;
    const input = this.querySelector('.template-name');
    if (input) input.value = name;
  }

  _render() {
    this.innerHTML = `
      <span class="toolbar-title">表单设计器</span>
      <input class="template-name" value="${this._esc(this._templateName)}" placeholder="模板名称" id="templateNameInput">
      <div class="toolbar-sep"></div>
      <button class="btn btn-text" id="btnUndo" title="撤销 (Ctrl+Z)" ${this._canUndo ? '' : 'disabled'}>↩ 撤销</button>
      <button class="btn btn-text" id="btnRedo" title="重做 (Ctrl+Y)" ${this._canRedo ? '' : 'disabled'}>↪ 重做</button>
      <div class="toolbar-sep"></div>
      <button class="btn btn-default" id="btnSave" title="保存">💾 保存</button>
      <button class="btn btn-default" id="btnPreview" title="预览">👁 预览</button>
      <button class="btn btn-primary" id="btnPublish" title="发布">📤 发布</button>
      <div class="toolbar-sep"></div>
      <button class="btn btn-text" id="btnImport" title="导入模板">导入</button>
      <button class="btn btn-text" id="btnExport" title="导出模板">导出</button>
      <div class="toolbar-sep"></div>
      <button class="btn btn-text" id="btnTemplates" title="模板列表">📋 模板列表</button>
    `;
    this._bindEvents();
  }

  _bindEvents() {
    this.querySelector('#templateNameInput').addEventListener('change', (e) => {
      eventBus.emit('template:nameChanged', { name: e.target.value });
    });
    this.querySelector('#btnUndo').addEventListener('click', () => eventBus.emit('command:undo'));
    this.querySelector('#btnRedo').addEventListener('click', () => eventBus.emit('command:redo'));
    this.querySelector('#btnSave').addEventListener('click', () => eventBus.emit('template:save'));
    this.querySelector('#btnPreview').addEventListener('click', () => eventBus.emit('template:preview'));
    this.querySelector('#btnPublish').addEventListener('click', () => eventBus.emit('template:publish'));
    this.querySelector('#btnImport').addEventListener('click', () => eventBus.emit('template:import'));
    this.querySelector('#btnExport').addEventListener('click', () => eventBus.emit('template:export'));
    this.querySelector('#btnTemplates').addEventListener('click', () => eventBus.emit('template:showList'));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        eventBus.emit('command:undo');
      } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        eventBus.emit('command:redo');
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        eventBus.emit('template:save');
      }
    });
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('fb-toolbar', FBToolbar);
