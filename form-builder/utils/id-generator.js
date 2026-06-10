// Unique ID generator with prefix support
export function generateId(prefix = 'id') {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}`;
}
