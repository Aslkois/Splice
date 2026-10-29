import type { InputFrame } from './input';

/** Event kinds the simulation raises for authored mechanics. */
export type SimEventKind =
  | 'key.pressed'
  | 'key.released'
  | 'key.held'
  | 'tick'
  | 'landing'
  | 'collision'
  | 'hit.incoming'
  | 'block.success'
  | 'hit.resolved'
  | 'damage.taken'
  | 'entity.destroyed'
  | 'charge.interrupted'
  | 'timer.elapsed'
  | 'custom';

/**
 * How the simulation talks to the mechanic runtime. The world never knows how graphs are executed;
 * it only raises events at well-defined points of its fixed step.
 */
export interface MechanicDriver {
  /** Start of tick: fire elapsed timers and resume delayed continuations that are due. */
  beginTick(): void;
  /** Raise key events for this tick. */
  fireInput(frame: InputFrame): void;
  /** Queue an event; it runs at the next flush, in FIFO order. */
  fire(kind: SimEventKind, payload: Record<string, unknown>): void;
  /** Run handlers immediately (used for interception while a hit is still open). */
  fireSync(kind: SimEventKind, payload: Record<string, unknown>): void;
  /** Drain the event queue under the execution budget. */
  flush(): void;
  /** Forget all runtime state (variables, timers, pending delays). */
  reset(): void;
}
