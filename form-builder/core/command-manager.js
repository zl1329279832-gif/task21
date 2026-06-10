// Command pattern for undo/redo
import { eventBus } from './event-bus.js';

class Command {
  constructor(description) { this.description = description; }
  execute() { throw new Error('Not implemented'); }
  undo() { throw new Error('Not implemented'); }
}

export class AddFieldCommand extends Command {
  constructor(store, fieldDef, index) {
    super(`添加字段: ${fieldDef.label}`);
    this.store = store;
    this.fieldDef = structuredClone(fieldDef);
    this.index = index;
  }
  execute() {
    const fields = this.store.get('fields') || [];
    fields.splice(this.index, 0, this.fieldDef);
    // Re-order
    fields.forEach((f, i) => f.order = i);
    this.store.setState('fields', [...fields]);
  }
  undo() {
    const fields = this.store.get('fields') || [];
    const idx = fields.findIndex(f => f.fieldId === this.fieldDef.fieldId);
    if (idx >= 0) {
      fields.splice(idx, 1);
      fields.forEach((f, i) => f.order = i);
      this.store.setState('fields', [...fields]);
    }
  }
}

export class RemoveFieldCommand extends Command {
  constructor(store, fieldId) {
    super(`删除字段`);
    this.store = store;
    this.fieldId = fieldId;
    this.fieldDef = null;
    this.index = -1;
  }
  execute() {
    const fields = this.store.get('fields') || [];
    this.index = fields.findIndex(f => f.fieldId === this.fieldId);
    if (this.index >= 0) {
      this.fieldDef = structuredClone(fields[this.index]);
      fields.splice(this.index, 1);
      fields.forEach((f, i) => f.order = i);
      this.store.setState('fields', [...fields]);
    }
  }
  undo() {
    if (this.fieldDef && this.index >= 0) {
      const fields = this.store.get('fields') || [];
      fields.splice(this.index, 0, structuredClone(this.fieldDef));
      fields.forEach((f, i) => f.order = i);
      this.store.setState('fields', [...fields]);
    }
  }
}

export class MoveFieldCommand extends Command {
  constructor(store, fieldId, fromIndex, toIndex) {
    super(`移动字段`);
    this.store = store;
    this.fieldId = fieldId;
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }
  execute() {
    this._move(this.fromIndex, this.toIndex);
  }
  undo() {
    this._move(
      this.toIndex > this.fromIndex ? this.toIndex - 1 : this.toIndex,
      this.fromIndex
    );
  }
  _move(from, to) {
    const fields = this.store.get('fields') || [];
    const [item] = fields.splice(from, 1);
    if (item) {
      const insertAt = to > from ? to - 1 : to;
      fields.splice(insertAt < 0 ? 0 : insertAt, 0, item);
      fields.forEach((f, i) => f.order = i);
      this.store.setState('fields', [...fields]);
    }
  }
}

export class ChangePropertyCommand extends Command {
  constructor(store, fieldId, property, oldValue, newValue) {
    super(`修改属性: ${property}`);
    this.store = store;
    this.fieldId = fieldId;
    this.property = property;
    this.oldValue = structuredClone(oldValue);
    this.newValue = structuredClone(newValue);
  }
  execute() {
    this._apply(this.newValue);
  }
  undo() {
    this._apply(this.oldValue);
  }
  _apply(value) {
    const fields = this.store.get('fields') || [];
    const field = fields.find(f => f.fieldId === this.fieldId);
    if (!field) return;
    const parts = this.property.split('.');
    let obj = field;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this.store.setState('fields', [...fields]);
  }
}

export class BatchCommand extends Command {
  constructor(description, commands) {
    super(description);
    this.commands = commands;
  }
  execute() {
    for (const cmd of this.commands) cmd.execute();
  }
  undo() {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

export class CommandManager {
  #undoStack = [];
  #redoStack = [];
  #maxHistory = 50;

  execute(command) {
    command.execute();
    this.#undoStack.push(command);
    this.#redoStack = [];
    if (this.#undoStack.length > this.#maxHistory) {
      this.#undoStack.shift();
    }
    this.#emitState();
  }

  undo() {
    const cmd = this.#undoStack.pop();
    if (cmd) {
      cmd.undo();
      this.#redoStack.push(cmd);
      this.#emitState();
    }
  }

  redo() {
    const cmd = this.#redoStack.pop();
    if (cmd) {
      cmd.execute();
      this.#undoStack.push(cmd);
      this.#emitState();
    }
  }

  canUndo() { return this.#undoStack.length > 0; }
  canRedo() { return this.#redoStack.length > 0; }

  clear() {
    this.#undoStack = [];
    this.#redoStack = [];
    this.#emitState();
  }

  #emitState() {
    eventBus.emit('command:stateChanged', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      lastAction: this.#undoStack.at(-1)?.description || ''
    });
  }
}
