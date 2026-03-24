// =============================================================================
// EventBus — In-memory typed pub/sub — TRD §8
// =============================================================================

import type {
  ExtensionEvent,
  EventBus as IEventBus,
  EventHandler,
} from "@replymate/contracts";

type HandlerMap = Map<string, Set<EventHandler<any>>>;

export class EventBusImpl implements IEventBus {
  private handlers: HandlerMap = new Map();

  publish(event: ExtensionEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event.type}:`, err);
      }
    }
  }

  subscribe<T extends ExtensionEvent["type"]>(
    type: T,
    handler: EventHandler<Extract<ExtensionEvent, { type: T }>>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type)!;
    set.add(handler as EventHandler<any>);

    // Return unsubscribe function
    return () => {
      set.delete(handler as EventHandler<any>);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}
