const buckets = new Map()
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 60_000)
cleanup.unref?.()

export function rateLimit({ windowMs, max, scope }) {
  return (req, res, next) => {
    const now = Date.now()
    const key = `${scope}:${req.ip}`
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    res.set("RateLimit-Limit", String(max))
    res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)))
    if (bucket.count > max) return res.status(429).json({ message: "Too many requests. Please try again shortly." })
    next()
  }
}
