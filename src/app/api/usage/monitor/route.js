import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/index.js";
import { getMonitorSnapshot } from "@/lib/requestMonitor.js";
import { MODEL_LOCK_PREFIX } from "open-sse/services/accountFallback.js";

const VALID_WINDOWS = new Set([15, 60, 360, 1440]);

export const dynamic = "force-dynamic";

// Only non-secret fields: account health for the monitor page.
function toAccountStatus(c, now) {
  const locks = [];
  for (const [key, value] of Object.entries(c)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !value) continue;
    const until = new Date(value).getTime();
    if (until > now) locks.push({ model: key.slice(MODEL_LOCK_PREFIX.length), until });
  }
  return {
    id: c.id,
    provider: c.provider,
    name: c.displayName || c.name || c.email || c.id?.slice(0, 8),
    isActive: c.isActive !== false,
    priority: c.priority ?? null,
    testStatus: c.testStatus || null,
    errorCode: c.errorCode ?? null,
    lastError: typeof c.lastError === "string" ? c.lastError.slice(0, 200) : null,
    lastErrorAt: c.lastErrorAt || null,
    locks,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowMinutes = Number(searchParams.get("window") || 60);
    if (!VALID_WINDOWS.has(windowMinutes)) {
      return NextResponse.json({ error: "Invalid window" }, { status: 400 });
    }

    const snapshot = getMonitorSnapshot({ windowMinutes });
    const connections = await getProviderConnections();
    const accounts = connections.map((c) => toAccountStatus(c, snapshot.now));

    return NextResponse.json({ ...snapshot, accounts });
  } catch (error) {
    console.error("[API] Failed to get monitor snapshot:", error);
    return NextResponse.json({ error: "Failed to fetch monitor snapshot" }, { status: 500 });
  }
}
