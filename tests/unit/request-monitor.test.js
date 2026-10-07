import { beforeEach, describe, expect, it } from "vitest";

const {
  recordRequestDone,
  recordRequestError,
  recordAccountLock,
  recordAllAccountsLocked,
  recordRequestRejected,
  getMonitorSnapshot,
} = await import("../../src/lib/requestMonitor.js");

function reset() {
  const state = global._requestMonitorState;
  state.buckets.clear();
  state.latencies.length = 0;
  state.events.length = 0;
}

describe("requestMonitor", () => {
  beforeEach(reset);

  it("counts outcomes per account, model and status", () => {
    recordRequestDone({ provider: "claude", model: "opus", connectionId: "a", latency: { ttft: 100, total: 1000 } });
    recordRequestDone({ provider: "claude", model: "opus", connectionId: "b", latency: { ttft: 300, total: 3000 } });
    recordRequestError({ provider: "claude", model: "opus", connectionId: "a", status: 429, message: "rate_limit_error" });

    const snap = getMonitorSnapshot({ windowMinutes: 60 });
    expect(snap.totals).toMatchObject({ requests: 3, ok: 2, errors: 1, aborted: 0 });
    expect(snap.totals.errorRate).toBeCloseTo(1 / 3);
    expect(snap.byStatus).toEqual({ 200: 2, 429: 1 });
    expect(snap.byConnection.a).toEqual({ requests: 2, ok: 1, errors: 1, aborted: 0 });
    expect(snap.byConnection.b).toEqual({ requests: 1, ok: 1, errors: 0, aborted: 0 });
    expect(snap.byModel["claude/opus"].requests).toBe(3);
    expect(snap.latency.samples).toBe(2);
    expect(snap.latency.totalMax).toBe(3000);
    expect(snap.timeline.reduce((n, p) => n + p.requests, 0)).toBe(3);
  });

  it("treats client aborts (499) as aborted, not errors", () => {
    recordRequestError({ provider: "claude", model: "opus", connectionId: "a", status: 499 });
    const snap = getMonitorSnapshot();
    expect(snap.totals).toMatchObject({ requests: 1, errors: 0, aborted: 1, errorRate: 0 });
    expect(snap.events).toHaveLength(0);
  });

  it("keeps lock events newest first with truncated messages", () => {
    recordAccountLock({ provider: "claude", model: "opus", connectionId: "a", connectionName: "spiff", status: 429, cooldownMs: 2000, message: "x".repeat(1000) });
    recordAllAccountsLocked({ provider: "claude", model: "opus", accountCount: 1, retryAfter: "2026-10-07T00:00:00Z" });

    const { events } = getMonitorSnapshot();
    expect(events.map((e) => e.type)).toEqual(["all_locked", "lock"]);
    expect(events[1].message.length).toBeLessThanOrEqual(301);
  });

  it("drops buckets older than the window", () => {
    recordRequestDone({ provider: "claude", model: "opus", connectionId: "a", latency: { total: 10 } });
    const state = global._requestMonitorState;
    const [key, bucket] = [...state.buckets.entries()][0];
    state.buckets.delete(key);
    state.buckets.set(key - 2 * 60 * 60 * 1000, bucket);
    state.latencies[0].ts -= 2 * 60 * 60 * 1000;

    const snap = getMonitorSnapshot({ windowMinutes: 60 });
    expect(snap.totals.requests).toBe(0);
    expect(snap.latency.samples).toBe(0);
  });

  it("counts requests rejected while all accounts are locked as 503 errors", () => {
    recordRequestRejected({ provider: "claude", model: "opus" });
    const snap = getMonitorSnapshot();
    expect(snap.totals).toMatchObject({ requests: 1, errors: 1 });
    expect(snap.byStatus).toEqual({ 503: 1 });
    expect(snap.events).toHaveLength(0);
  });

  it("never throws on missing input", () => {
    expect(() => recordRequestDone()).not.toThrow();
    expect(() => recordRequestError()).not.toThrow();
    expect(() => recordAccountLock()).not.toThrow();
    expect(() => recordAllAccountsLocked()).not.toThrow();
    expect(() => recordRequestRejected()).not.toThrow();
  });
});
