export class RateLimiter {
  constructor({ windowMs = 60_000, max = 120 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.buckets = new Map();
  }

  check(key, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const next = { count: 1, resetAt: now + this.windowMs };
      this.buckets.set(key, next);
      return { allowed: true, remaining: this.max - 1, resetAt: next.resetAt };
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) {
      for (const [entryKey, entry] of this.buckets) if (entry.resetAt <= now) this.buckets.delete(entryKey);
    }
    return { allowed: bucket.count <= this.max, remaining: Math.max(0, this.max - bucket.count), resetAt: bucket.resetAt };
  }
}
