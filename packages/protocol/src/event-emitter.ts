/**
 * Event Emitter for Telemetry Plane
 * Manages event storage and distribution to WebSocket subscribers
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { EventEnvelope, EventType, Severity, Platform } from './types';

interface EventFilter {
  severity?: Severity[];
  event_types?: EventType[];
  session_id?: string;
  account_id?: string;
  platform?: Platform;
}

interface Subscriber {
  id: string;
  filters: EventFilter;
  cursor: string;
  send: (event: EventEnvelope) => void;
}

export class TelemetryEmitter extends EventEmitter {
  private events: EventEnvelope[] = [];
  private subscribers: Map<string, Subscriber> = new Map();
  private cursorCounter = 0;
  private maxEventHistory = 10000;

  constructor() {
    super();
  }

  private generateCursor(): string {
    this.cursorCounter++;
    return `${Date.now()}-${this.cursorCounter}`;
  }

  emit(type: EventType, payload: Record<string, unknown>, options: {
    severity?: Severity;
    command_id?: string;
    correlation_id?: string;
    target?: {
      session_id?: string;
      account_id?: string;
      platform?: Platform;
    };
  } = {}): boolean {
    const event: EventEnvelope = {
      version: '1.0',
      event_id: uuidv4(),
      cursor: this.generateCursor(),
      emitted_at: new Date().toISOString(),
      severity: options.severity || 'info',
      type,
      command_id: options.command_id,
      correlation_id: options.correlation_id,
      target: options.target,
      payload,
    };

    // Store event
    this.events.push(event);
    if (this.events.length > this.maxEventHistory) {
      this.events.shift();
    }

    // Distribute to subscribers
    this.subscribers.forEach((subscriber) => {
      if (this.matchesFilter(event, subscriber.filters)) {
        subscriber.send(event);
        subscriber.cursor = event.cursor;
      }
    });

    // Emit for local listeners
    return super.emit('event', event);
  }

  private matchesFilter(event: EventEnvelope, filter: EventFilter): boolean {
    if (filter.severity && !filter.severity.includes(event.severity)) {
      return false;
    }
    if (filter.event_types && !filter.event_types.includes(event.type)) {
      return false;
    }
    if (filter.session_id && event.target?.session_id !== filter.session_id) {
      return false;
    }
    if (filter.account_id && event.target?.account_id !== filter.account_id) {
      return false;
    }
    if (filter.platform && event.target?.platform !== filter.platform) {
      return false;
    }
    return true;
  }

  subscribe(
    send: (event: EventEnvelope) => void,
    filters: EventFilter = {},
    cursor?: string
  ): string {
    const id = uuidv4();
    const subscriber: Subscriber = {
      id,
      filters,
      cursor: cursor || this.generateCursor(),
      send,
    };

    this.subscribers.set(id, subscriber);

    // Replay events if cursor provided
    if (cursor) {
      const replayEvents = this.getEventsSinceCursor(cursor, filters);
      replayEvents.forEach((event) => {
        send(event);
        subscriber.cursor = event.cursor;
      });
    }

    return id;
  }

  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  getEventsSinceCursor(cursor: string, filter?: EventFilter): EventEnvelope[] {
    const cursorIndex = this.events.findIndex((e) => e.cursor === cursor);
    const startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
    
    let events = this.events.slice(startIndex);
    
    if (filter) {
      events = events.filter((e) => this.matchesFilter(e, filter));
    }
    
    return events;
  }

  getCurrentCursor(): string {
    if (this.events.length === 0) {
      return this.generateCursor();
    }
    return this.events[this.events.length - 1].cursor;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getEventCount(): number {
    return this.events.length;
  }
}

// Singleton instance
export const telemetryEmitter = new TelemetryEmitter();
