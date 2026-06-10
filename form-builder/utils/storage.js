// Namespaced localStorage wrapper
const PREFIX = 'fb_';

export class StorageManager {
  save(namespace, key, value) {
    try {
      localStorage.setItem(`${PREFIX}${namespace}:${key}`, JSON.stringify(value));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded');
        return false;
      }
      throw e;
    }
  }

  load(namespace, key) {
    const raw = localStorage.getItem(`${PREFIX}${namespace}:${key}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  delete(namespace, key) {
    localStorage.removeItem(`${PREFIX}${namespace}:${key}`);
  }

  list(namespace) {
    const prefix = `${PREFIX}${namespace}:`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(prefix)) {
        keys.push(k.slice(prefix.length));
      }
    }
    return keys;
  }

  listAll(namespace) {
    const result = {};
    for (const key of this.list(namespace)) {
      result[key] = this.load(namespace, key);
    }
    return result;
  }

  clear(namespace) {
    for (const key of this.list(namespace)) {
      this.delete(namespace, key);
    }
  }

  getUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      total += k.length + (localStorage.getItem(k) || '').length;
    }
    return { bytes: total * 2, mb: (total * 2) / (1024 * 1024) };
  }
}

export const storage = new StorageManager();
