// Offline outbox for the timekeeper screen: every tap is stamped and kept in
// localStorage (via KeyValueStorage) until the server acknowledges it, so a
// device that loses connectivity mid-race never loses a mark. See design
// spec §7.4.

import type { KeyValueStorage } from './storage';
import { readJSON, writeJSON } from './storage';
import type { TkMarkInput } from './types';

export interface LocalMark extends TkMarkInput {
  local_updated_at: number;
}

export type OutboxState = 'pending' | 'synced' | 'rejected';

export interface OutboxItem {
  mark: LocalMark;
  state: OutboxState;
  reason?: string;
  sent_at_version?: number;
}

// True for a non-null, non-array object — i.e. something that could plausibly
// be a `{ [id]: OutboxItem }` map or a single OutboxItem, as opposed to a
// primitive or an array that slipped in through hand-edited or corrupted
// localStorage.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `readJSON` only guards against unparsable JSON syntax (it catches
// JSON.parse throwing). Well-formed JSON that parses to the wrong shape —
// `'{}'`, `'null'`, `'[]'`, `'{"items":5}'`, or an `items` map whose entries
// aren't `{mark, state, ...}` objects — parses fine and must be degraded to
// empty here instead, so a corrupted/foreign value in the outbox's key can
// never crash `all()`/`pendingCount()` (which assume `Record<string,
// OutboxItem>`) or the constructor itself.
function sanitizeItems(raw: unknown): Record<string, OutboxItem> {
  if (!isRecord(raw)) return {};
  const items: Record<string, OutboxItem> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (isRecord(value) && isRecord(value.mark)) {
      items[id] = value as unknown as OutboxItem;
    }
  }
  return items;
}

export class Outbox {
  private readonly storage: KeyValueStorage;
  private readonly key: string;
  private readonly nowFn: () => number;
  private items: Record<string, OutboxItem>;

  constructor(storage: KeyValueStorage, key: string, now: () => number = Date.now) {
    this.storage = storage;
    this.key = key;
    this.nowFn = now;
    const data = readJSON<unknown>(storage, key, { items: {} });
    this.items = sanitizeItems(isRecord(data) ? data.items : undefined);
  }

  private persist(): void {
    writeJSON(this.storage, this.key, { items: this.items });
  }

  all(): OutboxItem[] {
    return Object.values(this.items).sort((a, b) => (a.mark.ts < b.mark.ts ? -1 : a.mark.ts > b.mark.ts ? 1 : 0));
  }

  get(id: string): OutboxItem | undefined {
    return this.items[id];
  }

  upsert(mark: Omit<LocalMark, 'local_updated_at'>): LocalMark {
    const local: LocalMark = { ...mark, local_updated_at: this.nowFn() };
    this.items[mark.id] = { mark: local, state: 'pending' };
    this.persist();
    return local;
  }

  pending(limit?: number): LocalMark[] {
    const marks = this.all()
      .filter((item) => item.state === 'pending')
      .map((item) => item.mark);
    return limit === undefined ? marks : marks.slice(0, limit);
  }

  markSent(marks: LocalMark[]): void {
    for (const mark of marks) {
      const item = this.items[mark.id];
      if (!item) continue;
      item.sent_at_version = mark.local_updated_at;
    }
    this.persist();
  }

  applyResult(accepted: string[], rejected: { id: string; reason: string }[]): void {
    for (const id of accepted) {
      const item = this.items[id];
      if (!item) continue;
      if (item.mark.local_updated_at === item.sent_at_version) {
        item.state = 'synced';
      }
    }
    for (const r of rejected) {
      const item = this.items[r.id];
      if (!item) continue;
      item.state = 'rejected';
      item.reason = r.reason;
    }
    this.persist();
  }

  pendingCount(): number {
    return Object.values(this.items).filter((item) => item.state === 'pending').length;
  }
}
