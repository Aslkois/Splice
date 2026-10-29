import type { Hit } from '../sim/combat/Combat';
import type { MechanicDriver, SimEventKind } from '../sim/driver';
import type { Entity } from '../sim/entities/Entity';
import type { Player } from '../sim/entities/Player';
import { emptyPool, type FundingPool, type OpResult, type OPERATIONS } from '../sim/exchange/Exchange';
import type { InputFrame } from '../sim/input';
import type { World } from '../sim/World';
import type { CompiledMechanic } from './compile';
import type { ParamValue, PortType, VecValue } from './schema';
import { formatValue, TraceLog, type TraceCategory, type TraceEntry, type TraceValue } from './trace';
import type { CompiledNode, Value } from './types';

export const LIMITS = {
  /** Node executions + data evaluations per world tick, across all mechanics. */
  stepsPerTick: 4000,
  /** Signals emitted from handlers of signals… this deep are dropped. */
  maxEmitDepth: 8,
  maxEventsPerTick: 256,
  maxPendingPerMechanic: 64,
  maxBranchDepth: 24,
  maxDataDepth: 64,
  maxRepeat: 32,
  maxSyncDepth: 4,
  channelTimeout: 120,
};

class BudgetExceeded extends Error {}

interface TimerState {
  start: number;
  duration: number | null;
  fired: boolean;
  running: boolean;
}

export interface Scope {
  numbers: Map<string, number>;
  flags: Map<string, boolean>;
  vectors: Map<string, VecValue>;
  entities: Map<string, number>;
  timers: Map<string, TimerState>;
}

function newScope(): Scope {
  return { numbers: new Map(), flags: new Map(), vectors: new Map(), entities: new Map(), timers: new Map() };
}

export interface NodeTrace {
  count: number;
  lastTick: number;
  fails: number;
  lastFail?: string;
  lastFailTick?: number;
}

export interface MechanicActivity {
  lastRun: number;
  lastFail: number;
  lastFailReason?: string;
  runs: number;
}

interface Continuation {
  seq: number;
  at: number;
  ctx: ExecContext;
  node: CompiledNode;
  port: string;
}

/** A paused execution waiting on the world: a charge filling up, or a windup running its course. */
type Watch =
  | { kind: 'charge'; seq: number; ctx: ExecContext; node: CompiledNode; name: string; target: number; started: number }
  | { kind: 'windup'; seq: number; ctx: ExecContext; node: CompiledNode; started: number; until: number };

interface QueuedEvent {
  kind: SimEventKind;
  payload: Record<string, unknown>;
  depth: number;
}

export function defaultFor(type: PortType): Value {
  switch (type) {
    case 'number':
    case 'entity':
      return 0;
    case 'boolean':
      return false;
    case 'vector':
      return { x: 0, y: 0 };
    default:
      return 0;
  }
}

const titleOf = (node: CompiledNode) => node.def.title?.(node.params) ?? node.def.label;

/** One execution of one event handler (and any continuations it schedules). */
export class ExecContext {
  readonly outputs = new Map<string, Value>();
  readonly funding: FundingPool = emptyPool();
  refs = 0;
  finished = false;
  private branchDepth = 0;
  private dataDepth = 0;
  /** Trace entry of the block executing right now, and the input values it has read so far. */
  private current: TraceEntry | null = null;
  private reads: TraceValue[] | null = null;

  constructor(
    readonly host: MechanicHost,
    readonly mech: CompiledMechanic,
    readonly eventNode: CompiledNode,
    readonly payload: Record<string, unknown>,
    readonly depth: number,
    readonly runId: number,
  ) {}

  get world(): World {
    return this.host.world;
  }
  get actor(): Player {
    return this.host.world.player!;
  }
  get hit(): Hit | null {
    return (this.payload.hit as Hit | undefined) ?? null;
  }

  // ---- data ----

  private literal(node: CompiledNode, port: string): Value {
    const pdef = node.def.inputs?.find((p) => p.id === port);
    const raw: ParamValue | undefined = node.params[port] ?? pdef?.default;
    if (!pdef) return 0;
    if (pdef.type === 'entity') {
      if (raw === 'self' || raw === undefined) return this.actor.id;
      return 0;
    }
    if (raw === undefined) return defaultFor(pdef.type);
    if (pdef.type === 'vector') return typeof raw === 'object' ? { x: Number(raw.x) || 0, y: Number(raw.y) || 0 } : { x: 0, y: 0 };
    if (pdef.type === 'boolean') return raw === true || raw === 'true';
    return typeof raw === 'number' ? raw : Number(raw) || 0;
  }

  read(node: CompiledNode, port: string): Value {
    const top = this.dataDepth === 0 && this.reads;
    const v = this.readValue(node, port);
    if (top && this.reads) this.reads.push({ port, value: formatValue(v) });
    return v;
  }

  private readValue(node: CompiledNode, port: string): Value {
    const link = node.dataIn.get(port);
    if (!link) return this.literal(node, port);
    const src = this.mech.nodes.get(link.node);
    const outDef = src?.def.outputs?.find((p) => p.id === link.port);
    if (!src || !outDef) return this.literal(node, port);
    this.host.spend(1);
    if (src.def.event) {
      return src === this.eventNode && src.def.event.data ? src.def.event.data(this, link.port) : defaultFor(outDef.type);
    }
    if (src.def.evaluate) {
      if (++this.dataDepth > LIMITS.maxDataDepth) throw new BudgetExceeded('values feed into themselves too deeply');
      try {
        return src.def.evaluate(this, src, link.port);
      } finally {
        this.dataDepth--;
      }
    }
    return this.outputs.get(`${src.id}:${link.port}`) ?? defaultFor(outDef.type);
  }

  num(node: CompiledNode, port: string): number {
    const v = this.read(node, port);
    if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return Math.hypot(v.x, v.y);
  }

  bool(node: CompiledNode, port: string): boolean {
    const v = this.read(node, port);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    return v.x !== 0 || v.y !== 0;
  }

  vec(node: CompiledNode, port: string): VecValue {
    const v = this.read(node, port);
    if (typeof v === 'object') return { x: Number.isNaN(v.x) ? 0 : v.x, y: Number.isNaN(v.y) ? 0 : v.y };
    return { x: 0, y: 0 };
  }

  entityId(node: CompiledNode, port: string): number {
    const v = this.read(node, port);
    return typeof v === 'number' ? v : 0;
  }

  entity(node: CompiledNode, port: string): Entity | null {
    const id = this.entityId(node, port);
    if (!id) return null;
    const e = this.world.get(id);
    return e && e.alive ? e : null;
  }

  param<T extends ParamValue>(node: CompiledNode, id: string): T {
    const v = node.params[id];
    if (v !== undefined) return v as T;
    return node.def.params?.find((p) => p.id === id)?.default as T;
  }

  setOutput(node: CompiledNode, port: string, value: Value): void {
    this.outputs.set(`${node.id}:${port}`, value);
  }

  // ---- effects ----

  perform<K extends keyof typeof OPERATIONS>(
    node: CompiledNode,
    op: K,
    args: Parameters<(typeof OPERATIONS)[K]['cost']>[1],
  ): OpResult {
    const r = this.world.exchange.perform(op, this.actor, args, this.funding);
    const cur = this.current;
    if (cur) {
      cur.cost = { energy: r.cost.energy, stamina: r.cost.stamina };
      if (r.quote) cur.quote = r.quote;
      if (!r.ok) {
        cur.ok = false;
        cur.reason = r.reason ?? 'failed';
        cur.category = r.failKind ?? 'logic';
      }
    }
    if (!r.ok) this.host.traceFail(this.mech, node, r.reason ?? 'failed');
    return r;
  }

  fail(node: CompiledNode, reason: string, category: TraceCategory): null {
    const cur = this.current;
    if (cur) {
      cur.ok = false;
      cur.reason = reason;
      cur.category = category;
    }
    this.host.traceFail(this.mech, node, reason);
    return null;
  }

  /** Adds a labelled figure to the trace entry of the block running now (e.g. a variable's new value). */
  detail(label: string, value: Value): void {
    const cur = this.current;
    if (!cur) return;
    (cur.details ??= []).push({ label, value: formatValue(value) });
  }

  /** Records a pause/resume of this run in the trace. */
  note(node: CompiledNode, kind: 'wait' | 'resume', text: string, extra: Partial<TraceEntry> = {}): void {
    this.host.record(this, node, kind, text, extra);
  }

  // ---- flow ----

  /** Follows the exec chain from `port` of `from`. */
  run(from: CompiledNode, port: string): void {
    let nextId = from.execOut.get(port);
    while (nextId) {
      const node = this.mech.nodes.get(nextId);
      if (!node || !node.def.exec) return;
      this.host.spend(1);
      this.host.trace(this.mech, node);
      const out = this.execTraced(node);
      if (out == null) return;
      nextId = node.execOut.get(out);
    }
  }

  private execTraced(node: CompiledNode): string | null {
    const entry = this.host.record(this, node, 'block', titleOf(node));
    const prevEntry = this.current;
    const prevReads = this.reads;
    this.current = entry;
    this.reads = entry ? [] : null;
    try {
      const out = node.def.exec!(this, node);
      if (entry) {
        if (this.reads?.length) entry.values = this.reads;
        if (out != null) entry.port = out;
        if (entry.ok && out != null && node.def.closedPorts?.includes(out)) {
          entry.category = 'condition';
          entry.reason = node.def.execOut?.find((p) => p.id === out)?.label ?? out;
        }
        if (entry.cost) entry.after = { energy: this.actor.account.energy, stamina: this.actor.account.stamina };
        this.host.traceLog.touch();
      }
      return out;
    } finally {
      this.current = prevEntry;
      this.reads = prevReads;
    }
  }

  runBranch(from: CompiledNode, port: string): void {
    if (++this.branchDepth > LIMITS.maxBranchDepth) {
      this.branchDepth--;
      throw new BudgetExceeded('branches nest too deeply');
    }
    try {
      this.run(from, port);
    } finally {
      this.branchDepth--;
    }
  }

  schedule(node: CompiledNode, port: string, seconds: number): boolean {
    return this.host.schedule(this, node, port, seconds);
  }

  watchCharge(node: CompiledNode, name: string, target: number): boolean {
    return this.host.watchCharge(this, node, name, target);
  }

  windUp(node: CompiledNode, seconds: number): boolean {
    return this.host.windUp(this, node, seconds);
  }

  emit(name: string, value: number): void {
    this.host.emitSignal(name, value, this.depth + 1, this.mech);
  }

  scope(kind: string): Scope {
    return kind === 'character' ? this.host.characterScope : this.host.scopeOf(this.mech.id);
  }

  nodeState<T extends object>(node: CompiledNode, init: () => T): T {
    return this.host.nodeState(this.mech.id, node.id, init);
  }

  /** Called when a run (or a resumed continuation) returns. Refunds unspent pooled energy once nothing is pending. */
  settle(): void {
    if (this.finished || this.refs > 0) return;
    this.finished = true;
    if (this.funding.energy > 0) {
      this.world.exchange.refund(this.actor, this.funding.energy);
      this.funding.energy = 0;
    }
  }
}

/**
 * Executes compiled mechanics for the player. Deterministic: mechanics resolve in equip-slot order,
 * handlers of the same event in run order (their order in the mechanic), queued events FIFO. Every tick is bounded.
 */
export interface HostCarry {
  trace: TraceLog;
  characterScope: Scope;
  scopes: Map<string, Scope>;
  states: Map<string, { type: string; state: object }>;
  keyDownAt: Map<string, number>;
}

export class MechanicHost implements MechanicDriver {
  readonly characterScope: Scope;
  readonly traceLog: TraceLog;
  private scopes = new Map<string, Scope>();
  private states = new Map<string, { type: string; state: object }>();
  private nextRun = 1;
  private queue: QueuedEvent[] = [];
  private delayed: Continuation[] = [];
  private watches: Watch[] = [];
  private seq = 0;
  private steps = 0;
  private eventsThisTick = 0;
  private throttled = false;
  private syncDepth = 0;
  private keyDownAt = new Map<string, number>();
  private listened: { pressed: Set<string>; released: Set<string>; held: Set<string>; tick: boolean };

  readonly traces = new Map<string, Map<string, NodeTrace>>();
  readonly activity = new Map<string, MechanicActivity>();

  constructor(
    readonly world: World,
    readonly mechanics: CompiledMechanic[],
    carry?: HostCarry,
  ) {
    this.traceLog = carry?.trace ?? new TraceLog();
    this.characterScope = carry?.characterScope ?? newScope();
    if (carry) {
      // Hot reload: variables, timers and block memory (toggles, cooldowns) of mechanics that are
      // still equipped carry over. Block memory only carries when the block is still the same type.
      const ids = new Set(mechanics.map((m) => m.id));
      for (const [id, s] of carry.scopes) if (ids.has(id)) this.scopes.set(id, s);
      for (const [key, st] of carry.states) {
        const [mid, nid] = key.split('\u0000');
        if (mechanics.find((m) => m.id === mid)?.nodes.get(nid)?.type === st.type) this.states.set(key, st);
      }
      for (const [k, t] of carry.keyDownAt) this.keyDownAt.set(k, t);
    }
    this.listened = { pressed: new Set(), released: new Set(), held: new Set(), tick: false };
    for (const m of mechanics) {
      for (const n of m.events.get('key.pressed') ?? []) this.listened.pressed.add(String(n.params.key ?? 'F'));
      for (const n of m.events.get('key.released') ?? []) this.listened.released.add(String(n.params.key ?? 'F'));
      for (const n of m.events.get('key.held') ?? []) this.listened.held.add(String(n.params.key ?? 'F'));
      if (m.events.get('tick')?.length) this.listened.tick = true;
      this.activity.set(m.id, { lastRun: -1, lastFail: -1, runs: 0 });
    }
  }

  // ---- MechanicDriver ----

  beginTick(): void {
    this.steps = 0;
    this.eventsThisTick = 0;
    this.throttled = false;
    const now = this.world.time;
    this.fireTimers(this.characterScope, null, now);
    for (const [mid, s] of this.scopes) this.fireTimers(s, mid, now);

    if (this.delayed.length) {
      const due = this.delayed.filter((c) => c.at <= now + 1e-9).sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (due.length) {
        this.delayed = this.delayed.filter((c) => c.at > now + 1e-9);
        for (const c of due) {
          c.ctx.refs--;
          c.ctx.note(c.node, 'resume', `${titleOf(c.node)}: wait over`, { port: c.port });
          this.execute(c.ctx, () => c.ctx.run(c.node, c.port));
        }
      }
    }
    if (this.watches.length) this.checkWatches(now);
  }

  fireInput(frame: InputFrame): void {
    const now = this.world.time;
    for (const k of [...frame.pressed].sort()) {
      this.keyDownAt.set(k, now);
      if (this.listened.pressed.has(k)) this.fire('key.pressed', { key: k });
    }
    for (const k of [...frame.released].sort()) {
      const heldFor = now - (this.keyDownAt.get(k) ?? now);
      this.keyDownAt.delete(k);
      if (this.listened.released.has(k)) this.fire('key.released', { key: k, heldFor });
    }
    for (const k of [...frame.held].sort()) {
      if (this.listened.held.has(k)) this.fire('key.held', { key: k, heldFor: now - (this.keyDownAt.get(k) ?? now) });
    }
    if (this.listened.tick) this.fire('tick', {});
  }

  fire(kind: SimEventKind, payload: Record<string, unknown>): void {
    this.queue.push({ kind, payload, depth: 0 });
  }

  fireSync(kind: SimEventKind, payload: Record<string, unknown>): void {
    if (this.syncDepth >= LIMITS.maxSyncDepth) {
      this.world.diagnose('Interception nested too deeply — inner handlers skipped.');
      this.recordLimit(null, `Interception nested more than ${LIMITS.maxSyncDepth} deep — inner handlers skipped`);
      return;
    }
    this.syncDepth++;
    try {
      this.dispatch(kind, payload, 0);
    } finally {
      this.syncDepth--;
    }
  }

  flush(): void {
    while (this.queue.length) {
      if (this.eventsThisTick >= LIMITS.maxEventsPerTick) {
        this.world.diagnose(`More than ${LIMITS.maxEventsPerTick} events in one tick — the rest were dropped. Check for signal loops.`);
        this.recordLimit(null, `More than ${LIMITS.maxEventsPerTick} events in one tick — ${this.queue.length} dropped`);
        this.queue.length = 0;
        return;
      }
      const ev = this.queue.shift()!;
      this.eventsThisTick++;
      this.dispatch(ev.kind, ev.payload, ev.depth);
    }
  }

  reset(): void {
    this.scopes.clear();
    for (const m of [this.characterScope]) {
      m.numbers.clear();
      m.flags.clear();
      m.vectors.clear();
      m.entities.clear();
      m.timers.clear();
    }
    this.states.clear();
    this.queue.length = 0;
    this.delayed.length = 0;
    this.watches.length = 0;
    this.keyDownAt.clear();
    if (this.world.player) this.world.player.windingUp = 0;
  }

  /**
   * Retire this host (mechanics were swapped). Pending continuations are abandoned, but any energy
   * they were holding goes back to the battery: swapping code never destroys resources.
   */
  dispose(): HostCarry {
    const ctxs = new Set<ExecContext>([...this.delayed.map((c) => c.ctx), ...this.watches.map((w) => w.ctx)]);
    const p = this.world.player;
    if (p) p.windingUp = Math.max(0, p.windingUp - this.watches.filter((w) => w.kind === 'windup').length);
    this.delayed.length = 0;
    this.watches.length = 0;
    this.queue.length = 0;
    for (const ctx of ctxs) {
      ctx.refs = 0;
      ctx.settle();
    }
    return { trace: this.traceLog, characterScope: this.characterScope, scopes: this.scopes, states: this.states, keyDownAt: this.keyDownAt };
  }

  /** Energy released from charges into executions that are paused right now (delays, windups, channels). */
  pooledEnergy(): number {
    const ctxs = new Set<ExecContext>([...this.delayed.map((c) => c.ctx), ...this.watches.map((w) => w.ctx)]);
    let sum = 0;
    for (const c of ctxs) sum += c.funding.energy;
    return sum;
  }

  // ---- internals used by ExecContext / primitives ----

  spend(n: number): void {
    this.steps += n;
    if (this.steps > LIMITS.stepsPerTick) throw new BudgetExceeded(`more than ${LIMITS.stepsPerTick} steps in one tick`);
  }

  scopeOf(mechId: string): Scope {
    let s = this.scopes.get(mechId);
    if (!s) this.scopes.set(mechId, (s = newScope()));
    return s;
  }

  nodeState<T extends object>(mechId: string, nodeId: string, init: () => T): T {
    const key = `${mechId}\u0000${nodeId}`;
    let s = this.states.get(key);
    if (!s) {
      const type = this.mechanics.find((m) => m.id === mechId)?.nodes.get(nodeId)?.type ?? '';
      this.states.set(key, (s = { type, state: init() }));
    }
    return s.state as T;
  }

  schedule(ctx: ExecContext, node: CompiledNode, port: string, seconds: number): boolean {
    const pending = this.delayed.filter((c) => c.ctx.mech === ctx.mech).length + this.watches.filter((w) => w.ctx.mech === ctx.mech).length;
    if (pending >= LIMITS.maxPendingPerMechanic) {
      this.world.diagnose(`'${ctx.mech.name}' has ${pending} pending delays — new ones are dropped.`, ctx.mech.id);
      ctx.fail(node, `more than ${LIMITS.maxPendingPerMechanic} pending delays`, 'limit');
      return false;
    }
    ctx.refs++;
    const wait = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    // Even a zero delay resumes on the next tick: delays can never be used to spin within a tick.
    const at = this.world.time + Math.max(wait, 1e-6);
    this.delayed.push({ seq: this.seq++, at, ctx, node, port });
    ctx.note(node, 'wait', `waiting ${formatValue(wait)} s — resumes on tick ${Math.ceil(at * 60 - 1e-6)}`);
    return true;
  }

  watchCharge(ctx: ExecContext, node: CompiledNode, name: string, target: number): boolean {
    const pending = this.delayed.filter((c) => c.ctx.mech === ctx.mech).length + this.watches.filter((w) => w.ctx.mech === ctx.mech).length;
    if (pending >= LIMITS.maxPendingPerMechanic) {
      ctx.fail(node, `more than ${LIMITS.maxPendingPerMechanic} pending delays and channels`, 'limit');
      return false;
    }
    ctx.refs++;
    this.watches.push({ kind: 'charge', seq: this.seq++, ctx, node, name, target, started: this.world.time });
    ctx.note(node, 'wait', `channelling "${name}" until it holds ${formatValue(target)} E`);
    return true;
  }

  windUp(ctx: ExecContext, node: CompiledNode, seconds: number): boolean {
    const pending = this.delayed.filter((c) => c.ctx.mech === ctx.mech).length + this.watches.filter((w) => w.ctx.mech === ctx.mech).length;
    if (pending >= LIMITS.maxPendingPerMechanic) {
      ctx.fail(node, `more than ${LIMITS.maxPendingPerMechanic} pending delays and windups`, 'limit');
      return false;
    }
    const p = this.world.player;
    if (!p || !p.alive) {
      ctx.fail(node, 'you are down', 'requirement');
      return false;
    }
    ctx.refs++;
    p.windingUp++;
    const now = this.world.time;
    const wait = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.watches.push({ kind: 'windup', seq: this.seq++, ctx, node, started: now, until: now + Math.max(wait, 1e-6) });
    ctx.note(node, 'wait', `winding up for ${formatValue(wait)} s — moving slower; a hit of ${this.world.exchange.table.charge.interruptThreshold}+ damage breaks it`);
    return true;
  }

  emitSignal(name: string, value: number, depth: number, from: CompiledMechanic): void {
    if (depth > LIMITS.maxEmitDepth) {
      this.world.diagnose(`Signal '${name}' was re-emitted ${LIMITS.maxEmitDepth} levels deep — stopped to prevent a loop.`, from.id);
      this.recordLimit(from, `Signal "${name}" re-emitted ${LIMITS.maxEmitDepth} levels deep — dropped to prevent a loop`);
      return;
    }
    this.queue.push({ kind: 'custom', payload: { name, value }, depth });
  }

  /** Adds a trace entry for a run. Returns it so the block's outcome can be filled in. */
  record(ctx: ExecContext, node: CompiledNode, kind: TraceEntry['kind'], text: string, extra: Partial<TraceEntry> = {}): TraceEntry | null {
    return this.traceLog.push({
      tick: this.world.tick,
      time: this.world.time,
      mechId: ctx.mech.id,
      mechName: ctx.mech.name,
      nodeId: node.id,
      nodeType: node.type,
      run: ctx.runId,
      kind,
      text,
      ok: true,
      ...extra,
    });
  }

  private recordLimit(mech: CompiledMechanic | null, text: string, run = 0): void {
    this.traceLog.push({
      tick: this.world.tick,
      time: this.world.time,
      mechId: mech?.id ?? '',
      mechName: mech?.name ?? 'Engine',
      run,
      kind: 'limit',
      text,
      ok: false,
      category: 'limit',
      reason: text,
    });
  }

  trace(mech: CompiledMechanic, node: CompiledNode): void {
    let m = this.traces.get(mech.id);
    if (!m) this.traces.set(mech.id, (m = new Map()));
    let t = m.get(node.id);
    if (!t) m.set(node.id, (t = { count: 0, lastTick: -1, fails: 0 }));
    t.count++;
    t.lastTick = this.world.tick;
  }

  traceFail(mech: CompiledMechanic, node: CompiledNode, reason: string): void {
    this.trace(mech, node);
    const t = this.traces.get(mech.id)!.get(node.id)!;
    t.fails++;
    t.lastFail = reason;
    t.lastFailTick = this.world.tick;
    const a = this.activity.get(mech.id);
    if (a) {
      a.lastFail = this.world.time;
      a.lastFailReason = `${node.def.label}: ${reason}`;
    }
  }

  private dispatch(kind: SimEventKind, payload: Record<string, unknown>, depth: number): void {
    if (this.throttled) return;
    for (const mech of this.mechanics) {
      const handlers = mech.events.get(kind);
      if (!handlers) continue;
      for (const ev of handlers) {
        const spec = ev.def.event!;
        if (spec.match && !spec.match(ev.params, payload, mech.id)) continue;
        if (this.throttled) return;
        const ctx = new ExecContext(this, mech, ev, payload, depth, this.nextRun++);
        this.trace(mech, ev);
        if (this.traceLog.enabled) {
          const values: TraceValue[] = [];
          if (spec.data) for (const o of ev.def.outputs ?? []) values.push({ port: o.id, value: formatValue(spec.data(ctx, o.id)) });
          this.record(ctx, ev, 'event', titleOf(ev), values.length ? { values, port: 'then' } : { port: 'then' });
        }
        const a = this.activity.get(mech.id);
        if (a && ev.execOut.size) {
          a.lastRun = this.world.time;
          a.runs++;
        }
        this.execute(ctx, () => ctx.run(ev, 'then'));
      }
    }
  }

  private execute(ctx: ExecContext, fn: () => void): void {
    if (this.throttled) {
      ctx.settle();
      return;
    }
    try {
      fn();
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        this.throttled = true;
        this.queue.length = 0;
        this.recordLimit(ctx.mech, `Stopped: ${e.message}`, ctx.runId);
        this.world.diagnose(`'${ctx.mech.name}' was stopped: ${e.message}. Is something looping?`, ctx.mech.id);
        const a = this.activity.get(ctx.mech.id);
        if (a) {
          a.lastFail = this.world.time;
          a.lastFailReason = `stopped: ${e.message}`;
        }
      } else {
        this.world.diagnose(`'${ctx.mech.name}' errored: ${(e as Error).message}`, ctx.mech.id);
        this.recordLimit(ctx.mech, `Errored: ${(e as Error).message}`, ctx.runId);
      }
    } finally {
      ctx.settle();
    }
  }

  private fireTimers(scope: Scope, mechId: string | null, now: number): void {
    for (const [name, t] of scope.timers) {
      if (!t.running || t.fired || t.duration == null) continue;
      if (now - t.start >= t.duration - 1e-9) {
        t.fired = true;
        this.queue.push({ kind: 'timer.elapsed', payload: { name, mechanicId: mechId }, depth: 0 });
      }
    }
  }

  private checkWatches(now: number): void {
    const player = this.world.player;
    const ex = this.world.exchange;
    const keep: Watch[] = [];
    const resumes: { w: Watch; port: string; ok: boolean; text: string; extra: Partial<TraceEntry> }[] = [];
    for (const w of this.watches) {
      if (w.kind === 'windup') {
        const broken = !player || !player.alive || player.staggeredAt >= w.started;
        if (broken) {
          if (player) player.windingUp = Math.max(0, player.windingUp - 1);
          resumes.push({ w, port: 'interrupted', ok: false, text: 'windup interrupted', extra: { category: 'interrupted', reason: !player?.alive ? 'you went down' : 'you were hit while winding up' } });
        } else if (now >= w.until - 1e-9) {
          player.windingUp = Math.max(0, player.windingUp - 1);
          const prepared = now - w.started;
          ex.fund(w.ctx.funding, 0, prepared);
          const { factor } = ex.windupOf(w.ctx.funding);
          resumes.push({
            w,
            port: 'then',
            ok: true,
            text: 'wound up',
            extra: { values: [{ port: 'prepared', value: `${formatValue(prepared)} s` }, { port: 'energy price', value: `×${formatValue(factor)}` }] },
          });
        } else keep.push(w);
        continue;
      }
      const ch = player?.account.charges.get(w.name);
      if (!player || !player.alive || !ch) {
        resumes.push({ w, port: 'interrupted', ok: false, text: `"${w.name}" interrupted`, extra: { category: 'interrupted', reason: !player?.alive ? 'you went down' : 'the charge is gone' } });
      } else if (ch.amount >= w.target - 1e-9) {
        ex.stopCharge(player, w.name);
        const rel = ex.releaseCharge(player, w.name);
        ex.fund(w.ctx.funding, rel.energy, rel.windup);
        w.ctx.setOutput(w.node, 'energy', rel.energy);
        resumes.push({
          w,
          port: 'charged',
          ok: true,
          text: `"${w.name}" charged`,
          extra: { values: [{ port: 'energy', value: formatValue(rel.energy) }, { port: 'prepared', value: `${formatValue(rel.windup)} s` }] },
        });
      } else if (!ch.channeling || now - w.started > LIMITS.channelTimeout) {
        resumes.push({
          w,
          port: 'interrupted',
          ok: false,
          text: `"${w.name}" interrupted`,
          extra: { category: 'interrupted', reason: ch.channeling ? `still short after ${LIMITS.channelTimeout} s` : 'channelling stopped — hit, or held by another block' },
        });
      } else keep.push(w);
    }
    this.watches = keep;
    resumes.sort((a, b) => a.w.seq - b.w.seq);
    for (const { w, port, ok, text, extra } of resumes) {
      w.ctx.refs--;
      w.ctx.note(w.node, 'resume', text, { port, ok, ...extra });
      this.execute(w.ctx, () => w.ctx.run(w.node, port));
    }
  }
}
