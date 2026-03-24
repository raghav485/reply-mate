// =============================================================================
// EventBus Tests
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import { EventBusImpl } from "../EventBus.js";


describe("EventBus", () => {
  it("delivers events to subscribed handlers", () => {
    const bus = new EventBusImpl();
    const handler = vi.fn();

    bus.subscribe("generation/requested", handler);
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "generation/requested",
      sessionId: "s1",
    });
  });

  it("does not deliver events to unrelated subscribers", () => {
    const bus = new EventBusImpl();
    const handler = vi.fn();

    bus.subscribe("generation/succeeded", handler);
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports unsubscribe", () => {
    const bus = new EventBusImpl();
    const handler = vi.fn();

    const unsub = bus.subscribe("generation/requested", handler);
    unsub();
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple handlers for the same event", () => {
    const bus = new EventBusImpl();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe("generation/requested", handler1);
    bus.subscribe("generation/requested", handler2);
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("isolates handler errors from other handlers", () => {
    const bus = new EventBusImpl();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const normalHandler = vi.fn();

    bus.subscribe("generation/requested", errorHandler);
    bus.subscribe("generation/requested", normalHandler);
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(normalHandler).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("clear() removes all handlers", () => {
    const bus = new EventBusImpl();
    const handler = vi.fn();

    bus.subscribe("generation/requested", handler);
    bus.clear();
    bus.publish({ type: "generation/requested", sessionId: "s1" });

    expect(handler).not.toHaveBeenCalled();
  });
});
