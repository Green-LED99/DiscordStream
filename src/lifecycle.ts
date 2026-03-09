import type { StreamLifecycleEvent, StreamLifecycleEventName } from './contracts.js';

export class LifecycleReporter {
  public emit(
    event: StreamLifecycleEventName,
    details?: Record<string, unknown>
  ): StreamLifecycleEvent {
    const payload: StreamLifecycleEvent = {
      event,
      timestamp: new Date().toISOString(),
    };

    if (details) {
      payload.details = details;
    }

    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }
}
