export class TtlCache {
  constructor() {
    this.map = new Map();
  }

  set(key, value, ttlMs = 60_000) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}
