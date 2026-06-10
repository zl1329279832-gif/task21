// Proxy-based observable state store
import { eventBus } from './event-bus.js';

export class Store {
  #state;
  #subscribers = new Map();
  #batching = false;
  #pendingNotifications = new Set();

  constructor(initialState = {}) {
    this.#state = structuredClone(initialState);
  }

  getState() {
    return structuredClone(this.#state);
  }

  get(path) {
    return this.#getByPath(this.#state, path);
  }

  setState(path, value) {
    const old = this.#getByPath(this.#state, path);
    if (old === value) return;
    this.#setByPath(this.#state, path, value);
    if (this.#batching) {
      this.#pendingNotifications.add(path);
    } else {
      this.#notify(path, old, value);
    }
  }

  update(path, fn) {
    const old = this.get(path);
    this.setState(path, fn(old));
  }

  subscribe(path, callback) {
    if (!this.#subscribers.has(path)) {
      this.#subscribers.set(path, new Set());
    }
    this.#subscribers.get(path).add(callback);
    return () => {
      const set = this.#subscribers.get(path);
      if (set) set.delete(callback);
    };
  }

  transaction(fn) {
    this.#batching = true;
    this.#pendingNotifications.clear();
    try {
      fn(this);
    } finally {
      this.#batching = false;
      for (const path of this.#pendingNotifications) {
        const val = this.#getByPath(this.#state, path);
        this.#notify(path, undefined, val);
      }
      this.#pendingNotifications.clear();
    }
  }

  #notify(path, oldValue, newValue) {
    for (const [subPath, cbs] of this.#subscribers) {
      if (path === subPath || path.startsWith(subPath + '.') || subPath.startsWith(path + '.')) {
        for (const cb of cbs) {
          try {
            cb({ path, oldValue, newValue, state: this.#state });
          } catch (e) {
            console.error(`Store subscriber error at "${subPath}":`, e);
          }
        }
      }
    }
    eventBus.emit('store:stateChanged', { path, oldValue, newValue });
  }

  #getByPath(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  #setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
}
