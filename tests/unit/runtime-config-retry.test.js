import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env.UPSTREAM_502_RETRY_ATTEMPTS;
  vi.resetModules();
});

describe("parseNonNegativeInt", () => {
  it("accepts zero so upstream retries can be disabled", async () => {
    const { parseNonNegativeInt } = await import(
      "../../open-sse/config/runtimeConfig.js"
    );
    expect(parseNonNegativeInt("0", 3)).toBe(0);
  });

  it("uses the default for invalid values", async () => {
    const { parseNonNegativeInt } = await import(
      "../../open-sse/config/runtimeConfig.js"
    );
    expect(parseNonNegativeInt("-1", 3)).toBe(3);
    expect(parseNonNegativeInt("invalid", 3)).toBe(3);
  });

  it("uses the environment override in the 502 retry config", async () => {
    process.env.UPSTREAM_502_RETRY_ATTEMPTS = "0";
    vi.resetModules();

    const { DEFAULT_RETRY_CONFIG } = await import(
      "../../open-sse/config/runtimeConfig.js"
    );

    expect(DEFAULT_RETRY_CONFIG[502].attempts).toBe(0);
  });
});
