import { describe, expect, it, vi } from "vitest";

import { createStreamController } from "../../open-sse/utils/streamHandler.js";

describe("createStreamController client signal", () => {
  it("aborts the upstream request when the client aborts", () => {
    const clientController = new AbortController();
    const onDisconnect = vi.fn();
    const streamController = createStreamController({
      clientSignal: clientController.signal,
      onDisconnect,
      provider: "test",
      model: "model",
    });

    clientController.abort(new Error("client closed"));

    expect(streamController.signal.aborted).toBe(true);
    expect(streamController.signal.reason.name).toBe("AbortError");
    expect(streamController.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "client_aborted" }),
    );
  });

  it("handles a client signal that is already aborted", () => {
    const clientController = new AbortController();
    const onDisconnect = vi.fn();
    clientController.abort();

    const streamController = createStreamController({
      clientSignal: clientController.signal,
      onDisconnect,
      provider: "test",
      model: "model",
    });

    expect(streamController.signal.aborted).toBe(true);
    expect(streamController.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("removes the client listener after normal completion", () => {
    const clientController = new AbortController();
    const onDisconnect = vi.fn();
    const streamController = createStreamController({
      clientSignal: clientController.signal,
      onDisconnect,
      provider: "test",
      model: "model",
    });

    streamController.handleComplete();
    clientController.abort();

    expect(streamController.signal.aborted).toBe(false);
    expect(streamController.isConnected()).toBe(false);
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
