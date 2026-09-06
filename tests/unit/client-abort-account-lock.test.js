import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  db.getProviderConnections.mockResolvedValue([{ id: "account", backoffLevel: 0 }]);
});

describe("client cancellation and account health", () => {
  it.each([499, "499"])("does not lock or rotate accounts for status %s", async (status) => {
    const result = await markAccountUnavailable(
      "account", status, "Request aborted", "provider", "model", Date.now() + 30000,
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(db.getProviderConnections).not.toHaveBeenCalled();
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still locks an account when the provider rate limits it", async () => {
    const result = await markAccountUnavailable("account", 429, "Rate limited", "provider", "model");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(db.updateProviderConnection).toHaveBeenCalledWith("account", expect.objectContaining({
      testStatus: "unavailable",
      errorCode: 429,
    }));
  });
});
