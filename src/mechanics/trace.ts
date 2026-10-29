import type { CostQuote, FailKind } from '../sim/exchange/Exchange';
import type { Value } from './types';

/**
 * Why something in a mechanic did not do what it says:
 *   logic       — the mechanic itself can't work (infinite numbers, values that loop, …)
 *   condition   — a condition was false or a gate was closed (If → else, Cooldown → cooling)
 *   resources   — not enough energy/stamina, the instant limit, a full battery
 *   target      — no target, a dead target, or a target out of reach
 *   requirement — a timing/eligibility rule: no open hit, guard raised too late, hit already landed
 *   interrupted — a windup or channel was broken
 *   limit       — an engine safety limit stopped it
 */
export type TraceCategory = FailKind | 'logic' | 'condition' | 'interrupted';

export type TraceKind =
  /** An event started a run. */
  | 'event'
  /** A block executed. `port` is the flow output it took (absent: it stopped the chain). */
  | 'block'
  /** A run paused (Delay, Channel Until). */
  | 'wait'
  /** A paused run continued. */
  | 'resume'
  /** A signal was queued. */
  | 'signal'
  /** A safety limit stopped or dropped something. */
  | 'limit';

export interface TraceValue {
  port: string;
  value: string;
}

export interface TraceEntry {
  seq: number;
  /** Simulation tick and time (seconds) when it happened. */
  tick: number;
  time: number;
  mechId: string;
  mechName: string;
  nodeId?: string;
  nodeType?: string;
  /** One event firing = one run. Delays and channels keep the run id of the run they paused. */
  run: number;
  kind: TraceKind;
  text: string;
  port?: string;
  ok: boolean;
  category?: TraceCategory;
  reason?: string;
  /** Values the block read from its inputs, as it saw them. */
  values?: TraceValue[];
  /** Exchange charged by this block. */
  cost?: { energy: number; stamina: number };
  /** Battery and stamina right after this block. */
  after?: { energy: number; stamina: number };
  /** How the exchange priced this block (base price, windup, where the energy came from…). */
  quote?: CostQuote;
  /** Extra figures the block reported (e.g. a variable's new value). */
  details?: { label: string; value: string }[];
}

export function formatValue(v: Value): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : 'NaN';
    return String(Math.round(v * 1000) / 1000);
  }
  return `(${Math.round(v.x * 100) / 100}, ${Math.round(v.y * 100) / 100})`;
}

/**
 * Fixed-size ring buffer of what mechanics did. It outlives runtime swaps (hot reload), so the
 * debugger keeps its history while you edit. Timestamps are simulation time, never wall-clock.
 */
export class TraceLog {
  private buf: (TraceEntry | undefined)[];
  private head = 0;
  private count = 0;
  private nextSeq = 1;
  /** Incremented on every change, so UIs can poll cheaply. */
  version = 0;
  enabled = true;

  constructor(readonly capacity = 2000) {
    this.buf = new Array(capacity);
  }

  push(e: Omit<TraceEntry, 'seq'>): TraceEntry | null {
    if (!this.enabled) return null;
    const entry = { ...e, seq: this.nextSeq++ } as TraceEntry;
    this.buf[(this.head + this.count) % this.capacity] = entry;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
    this.version++;
    return entry;
  }

  /** Mark a change to an entry already pushed (entries are filled in after their block runs). */
  touch(): void {
    this.version++;
  }

  get size(): number {
    return this.count;
  }

  /** Oldest first. */
  entries(): TraceEntry[] {
    const out: TraceEntry[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.buf[(this.head + i) % this.capacity]!);
    return out;
  }

  /** Entries with seq greater than `seq`, oldest first. */
  since(seq: number): TraceEntry[] {
    return this.entries().filter((e) => e.seq > seq);
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    this.version++;
  }
}
