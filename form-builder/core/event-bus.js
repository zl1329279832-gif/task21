// Global pub/sub event bus
class EventBus {
  #listeners = new Map();

  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.#listeners.get(event);
    if (set) set.delete(callback);
  }

  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }

  emit(event, payload) {
    const set = this.#listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(payload);
        } catch (e) {
          console.error(`EventBus error in "${event}":`, e);
        }
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}

export const eventBus = new EventBus();
