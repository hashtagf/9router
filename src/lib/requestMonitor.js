// In-memory request monitor: per-minute outcome buckets, latency samples and a
// ring of recent error/lock events for the /dashboard/monitor page.
// Never throws — monitoring must not break the request path. Resets on restart.

const RETENTION_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 60 * 1000;
const MAX_LATENCY_SAMPLES = 20000;
const MAX_EVENTS = 300;
const MAX_MESSAGE_LEN = 300;
const CLIENT_CLOSED_STATUS = 499;

if (!global._requestMonitorState) {
  global._requestMonitorState = {
    startedAt: Date.now(),
    buckets: new Map(), // minute start ms → bucket
    latencies: [], // { ts, ttft, total }
    events: [], // newest last
  };
}

const state = global._requestMonitorState;

function emptyCounts() {
  return { requests: 0, ok: 0, errors: 0, aborted: 0 };
}

function getBucket(ts) {
  const key = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
  let bucket = state.buckets.get(key);
  if (!bucket) {
    bucket = { ...emptyCounts(), byStatus: {}, byConnection: {}, byModel: {} };
    state.buckets.set(key, bucket);
    prune(ts);
  }
  return bucket;
}

function prune(now) {
  const cutoff = now - RETENTION_MS;
  for (const key of state.buckets.keys()) {
    if (key < cutoff) state.buckets.delete(key);
  }
  let drop = 0;
  while (drop < state.latencies.length && state.latencies[drop].ts < cutoff) drop++;
  if (state.latencies.length - drop > MAX_LATENCY_SAMPLES) drop = state.latencies.length - MAX_LATENCY_SAMPLES;
  if (drop > 0) state.latencies.splice(0, drop);
}

function bump(map, key, field) {
  if (!key) return;
  if (!map[key]) map[key] = emptyCounts();
  map[key].requests++;
  map[key][field]++;
}

function count({ provider, model, connectionId, field, status }) {
  const bucket = getBucket(Date.now());
  bucket.requests++;
  bucket[field]++;
  if (status) bucket.byStatus[status] = (bucket.byStatus[status] || 0) + 1;
  bump(bucket.byConnection, connectionId, field);
  bump(bucket.byModel, model ? `${provider || "unknown"}/${model}` : null, field);
}

function pushEvent(event) {
  state.events.push({ ts: Date.now(), ...event });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function truncate(message) {
  if (message == null) return null;
  const text = typeof message === "string" ? message : String(message);
  return text.length > MAX_MESSAGE_LEN ? `${text.slice(0, MAX_MESSAGE_LEN)}…` : text;
}

/** A request finished successfully. latency = { ttft?, total } in ms. */
export function recordRequestDone({ provider, model, connectionId, latency } = {}) {
  try {
    count({ provider, model, connectionId, field: "ok", status: 200 });
    const total = Number(latency?.total) || 0;
    const ttft = Number(latency?.ttft) || 0;
    if (total > 0) state.latencies.push({ ts: Date.now(), ttft, total });
  } catch { }
}

/** A request failed (upstream error status or transport failure). */
export function recordRequestError({ provider, model, connectionId, status, message, latencyMs } = {}) {
  try {
    const code = Number(status) || 0;
    if (code === CLIENT_CLOSED_STATUS) {
      count({ provider, model, connectionId, field: "aborted", status: code });
      return;
    }
    count({ provider, model, connectionId, field: "errors", status: code || "unknown" });
    pushEvent({ type: "error", provider, model, connectionId, status: code || null, latencyMs: latencyMs ?? null, message: truncate(message) });
  } catch { }
}

/**
 * A request was rejected before any upstream call because every account was
 * locked. Counted as a 503 error; the "all_locked" event already explains it.
 */
export function recordRequestRejected({ provider, model, status = 503 } = {}) {
  try {
    count({ provider, model, field: "errors", status: Number(status) || 503 });
  } catch { }
}

/** An account was put on cooldown for a model after an upstream error. */
export function recordAccountLock({ provider, model, connectionId, connectionName, status, cooldownMs, message } = {}) {
  try {
    pushEvent({ type: "lock", provider, model, connectionId, connectionName, status: Number(status) || null, cooldownMs: cooldownMs ?? null, message: truncate(message) });
  } catch { }
}

/** Every account of a provider is locked — clients get an error until one resets. */
export function recordAllAccountsLocked({ provider, model, accountCount, retryAfter, message } = {}) {
  try {
    pushEvent({ type: "all_locked", provider, model, accountCount: accountCount ?? null, retryAfter: retryAfter ?? null, message: truncate(message) });
  } catch { }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function mergeCounts(target, source) {
  for (const [key, counts] of Object.entries(source)) {
    if (!target[key]) target[key] = emptyCounts();
    for (const field of Object.keys(counts)) target[key][field] += counts[field];
  }
}

/**
 * Aggregate the last `windowMinutes` minutes.
 * Timeline points are `stepMinutes` wide so long windows stay small.
 */
export function getMonitorSnapshot({ windowMinutes = 60 } = {}) {
  const now = Date.now();
  prune(now);
  const windowMs = Math.min(Math.max(1, windowMinutes), RETENTION_MS / BUCKET_MS) * BUCKET_MS;
  const from = now - windowMs;
  const stepMinutes = Math.max(1, Math.ceil(windowMs / BUCKET_MS / 120));
  const stepMs = stepMinutes * BUCKET_MS;

  const totals = emptyCounts();
  const byStatus = {};
  const byConnection = {};
  const byModel = {};
  const timeline = new Map();

  for (const [key, bucket] of state.buckets) {
    if (key + BUCKET_MS <= from) continue;
    for (const field of Object.keys(totals)) totals[field] += bucket[field];
    for (const [status, n] of Object.entries(bucket.byStatus)) byStatus[status] = (byStatus[status] || 0) + n;
    mergeCounts(byConnection, bucket.byConnection);
    mergeCounts(byModel, bucket.byModel);

    const stepKey = Math.floor(key / stepMs) * stepMs;
    const point = timeline.get(stepKey) || { ts: stepKey, ...emptyCounts() };
    for (const field of Object.keys(totals)) point[field] += bucket[field];
    timeline.set(stepKey, point);
  }

  const samples = state.latencies.filter((s) => s.ts >= from);
  const ttfts = samples.map((s) => s.ttft).filter((v) => v > 0).sort((a, b) => a - b);
  const durations = samples.map((s) => s.total).sort((a, b) => a - b);

  const finished = totals.ok + totals.errors;
  return {
    now,
    monitorStartedAt: state.startedAt,
    windowMinutes: windowMs / BUCKET_MS,
    stepMinutes,
    totals: { ...totals, errorRate: finished ? totals.errors / finished : 0 },
    latency: {
      samples: samples.length,
      ttftP50: percentile(ttfts, 0.5),
      ttftP95: percentile(ttfts, 0.95),
      totalP50: percentile(durations, 0.5),
      totalP95: percentile(durations, 0.95),
      totalMax: durations.length ? durations[durations.length - 1] : null,
    },
    byStatus,
    byConnection,
    byModel,
    timeline: [...timeline.values()].sort((a, b) => a.ts - b.ts),
    events: state.events.filter((e) => e.ts >= from).slice().reverse(),
  };
}
