"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, Badge, SegmentedControl } from "@/shared/components";

const REFRESH_MS = 10000;

const WINDOWS = [
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 360, label: "6h" },
  { value: 1440, label: "24h" },
];

const EVENT_LABELS = {
  error: { label: "Error", variant: "error" },
  lock: { label: "Account locked", variant: "warning" },
  all_locked: { label: "All accounts locked", variant: "error" },
};

const fmtMs = (ms) => {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
};

const fmtPct = (n) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`;

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });

function fmtRemaining(until, now) {
  const s = Math.max(0, Math.round((until - now) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

function StatCard({ label, value, hint, tone }) {
  const toneClass = tone === "error" ? "text-red-500" : tone === "warning" ? "text-yellow-500" : "text-text-main";
  return (
    <Card padding="sm">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  hint: PropTypes.node,
  tone: PropTypes.oneOf(["error", "warning"]),
};

function accountState(account, now) {
  if (!account.isActive) return { label: "Disabled", variant: "default" };
  if (account.locks.length) {
    const until = Math.min(...account.locks.map((l) => l.until));
    return { label: `Locked · ${fmtRemaining(until, now)}`, variant: "warning" };
  }
  return { label: "Available", variant: "success" };
}

function AccountsCard({ data }) {
  const { accounts, byConnection, now } = data;
  const totalRequests = Object.values(byConnection).reduce((sum, c) => sum + c.requests, 0);
  // Show accounts that served traffic or are locked; fall back to all active ones.
  let rows = accounts.filter((a) => byConnection[a.id] || a.locks.length);
  if (!rows.length) rows = accounts.filter((a) => a.isActive);
  rows = [...rows].sort((a, b) => (byConnection[b.id]?.requests || 0) - (byConnection[a.id]?.requests || 0));

  return (
    <Card title="Accounts" subtitle="Traffic share and lock state per provider account" icon="group">
      {!rows.length ? (
        <p className="text-sm text-text-muted">No provider accounts configured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 pr-4 font-medium text-right">Requests</th>
                <th className="py-2 pr-4 font-medium text-right">Share</th>
                <th className="py-2 pr-4 font-medium text-right">Errors</th>
                <th className="py-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const stats = byConnection[a.id] || { requests: 0, ok: 0, errors: 0 };
                const state = accountState(a, now);
                return (
                  <tr key={a.id} className="border-b border-border-subtle last:border-0 align-top">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-text-main">{a.name}</div>
                      <div className="text-xs text-text-muted">{a.provider}</div>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={state.variant} size="sm" dot>{state.label}</Badge>
                      {a.locks.length > 0 && (
                        <div className="mt-1 text-xs text-text-muted">{a.locks.map((l) => l.model).join(", ")}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{stats.requests}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totalRequests ? fmtPct(stats.requests / totalRequests) : "—"}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${stats.errors ? "text-red-500" : ""}`}>{stats.errors}</td>
                    <td className="py-2 text-xs text-text-muted max-w-[320px]">
                      {a.lastErrorAt ? (
                        <span title={a.lastError || ""}>
                          [{a.errorCode ?? "?"}] {new Date(a.lastErrorAt).toLocaleString()}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

AccountsCard.propTypes = { data: PropTypes.object.isRequired };

function TimelineCard({ data }) {
  const points = data.timeline.map((p) => ({ ...p, label: fmtClock(p.ts) }));
  return (
    <Card title="Requests over time" subtitle={`${data.stepMinutes}-minute buckets`} icon="monitoring">
      {!points.length ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No requests in this window</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} maxBarSize={32}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
            />
            <Bar dataKey="ok" name="Success" stackId="a" fill="#14b8a6" />
            <Bar dataKey="errors" name="Errors" stackId="a" fill="#ef4444" />
            <Bar dataKey="aborted" name="Aborted" stackId="a" fill="#94a3b8" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

TimelineCard.propTypes = { data: PropTypes.object.isRequired };

function BreakdownCard({ data }) {
  const statuses = Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]);
  const models = Object.entries(data.byModel).sort((a, b) => b[1].requests - a[1].requests);
  return (
    <Card title="Breakdown" icon="pie_chart">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-text-muted">Status codes</p>
          {!statuses.length ? <p className="text-sm text-text-muted">—</p> : (
            <ul className="space-y-1 text-sm">
              {statuses.map(([status, n]) => (
                <li key={status} className="flex justify-between gap-4">
                  <Badge variant={status === "200" ? "success" : status === "499" ? "default" : "error"} size="sm">{status}</Badge>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-text-muted">Models</p>
          {!models.length ? <p className="text-sm text-text-muted">—</p> : (
            <ul className="space-y-1 text-sm">
              {models.map(([model, c]) => (
                <li key={model} className="flex justify-between gap-4">
                  <span className="truncate" title={model}>{model}</span>
                  <span className="tabular-nums shrink-0">
                    {c.requests}
                    {c.errors > 0 && <span className="ml-2 text-red-500">{c.errors} err</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

BreakdownCard.propTypes = { data: PropTypes.object.isRequired };

function EventsCard({ data }) {
  const names = Object.fromEntries(data.accounts.map((a) => [a.id, a.name]));
  return (
    <Card title="Recent events" subtitle="Errors and account locks, newest first" icon="warning">
      {!data.events.length ? (
        <p className="text-sm text-text-muted">No errors or locks in this window.</p>
      ) : (
        <ul className="divide-y divide-border-subtle text-sm max-h-[420px] overflow-y-auto">
          {data.events.map((e, i) => {
            const meta = EVENT_LABELS[e.type] || { label: e.type, variant: "default" };
            const account = e.connectionName || names[e.connectionId] || (e.connectionId ? e.connectionId.slice(0, 8) : null);
            return (
              <li key={`${e.ts}-${i}`} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-muted tabular-nums">{fmtTime(e.ts)}</span>
                  <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
                  {e.status && <Badge variant="default" size="sm">{e.status}</Badge>}
                  <span className="text-text-main">{e.provider}/{e.model || "all"}</span>
                  {account && <span className="text-text-muted">· {account}</span>}
                  {e.cooldownMs != null && <span className="text-text-muted">· cooldown {fmtMs(e.cooldownMs)}</span>}
                  {e.type === "all_locked" && e.accountCount != null && <span className="text-text-muted">· {e.accountCount} account(s)</span>}
                </div>
                {e.message && <p className="mt-1 text-xs text-text-muted break-words line-clamp-2" title={e.message}>{e.message}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

EventsCard.propTypes = { data: PropTypes.object.isRequired };

export default function MonitorClient() {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/usage/monitor?window=${windowMinutes}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [windowMinutes]);

  const totals = data?.totals;
  const latency = data?.latency;
  const rateLimited = data ? data.byStatus["429"] || 0 : 0;
  const lockedAccounts = data ? data.accounts.filter((a) => a.isActive && a.locks.length).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Monitor</h1>
          <p className="text-sm text-text-muted">
            Live gateway health · refreshes every {REFRESH_MS / 1000}s
            {data && ` · collecting since ${new Date(data.monitorStartedAt).toLocaleString()} (resets on restart)`}
          </p>
        </div>
        <SegmentedControl options={WINDOWS} value={windowMinutes} onChange={setWindowMinutes} size="sm" />
      </div>

      {error && (
        <Card padding="sm" className="border-red-500/40">
          <p className="text-sm text-red-500">Failed to load monitor data: {error}</p>
        </Card>
      )}

      {!data ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Requests" value={totals.requests} hint={totals.aborted ? `${totals.aborted} aborted by client` : null} />
            <StatCard
              label="Error rate"
              value={fmtPct(totals.errorRate)}
              hint={`${totals.errors} error(s)`}
              tone={totals.errorRate >= 0.05 ? "error" : totals.errors ? "warning" : undefined}
            />
            <StatCard label="Rate limited (429)" value={rateLimited} tone={rateLimited ? "warning" : undefined} />
            <StatCard
              label="Locked accounts"
              value={lockedAccounts}
              hint="currently on cooldown"
              tone={lockedAccounts ? "warning" : undefined}
            />
            <StatCard
              label="TTFT p50 / p95"
              value={`${fmtMs(latency.ttftP50)} / ${fmtMs(latency.ttftP95)}`}
              hint={`duration p95 ${fmtMs(latency.totalP95)} · max ${fmtMs(latency.totalMax)}`}
            />
          </div>

          <AccountsCard data={data} />
          <TimelineCard data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <EventsCard data={data} />
            <BreakdownCard data={data} />
          </div>
        </>
      )}
    </div>
  );
}
