import { attachMechanics, type AttachResult } from '../mechanics/builder';
import type { MechanicGraph } from '../mechanics/schema';
import { DT } from '../sim/config';
import type { FxEvent } from '../sim/fx';
import { LEVELS } from '../sim/levels/levels';
import { World, type GameMode, type WorldRequest } from '../sim/World';
import { InputManager } from './InputManager';

export interface RunnerHooks {
  onRequest?: (req: WorldRequest, runner: GameRunner) => void;
  onWorldChanged?: (world: World) => void;
}

export interface LoadOptions {
  levelId: string;
  mode: GameMode;
  lawEnabled: boolean;
  mechanics: MechanicGraph[];
  maxTier?: number;
}

/**
 * Owns the authoritative World and advances it at a fixed 60 Hz, independent of display rate.
 * Rendering only reads from it. Hitstop and pauses freeze stepping, never the renderer.
 */
export class GameRunner {
  world!: World;
  attach!: AttachResult;
  readonly input = new InputManager();
  private acc = 0;
  paused = false;
  /** Seconds of real time remaining in a hitstop freeze. */
  hitstop = 0;
  timeScale = 1;
  /** FX produced since the presentation layer last drained them. */
  private pendingFx: FxEvent[] = [];
  private lastLoad: LoadOptions | null = null;
  ticksThisFrame = 0;
  version = 0;
  /** Entity positions at the start of the latest tick, for render interpolation. */
  readonly prevPos = new Map<number, { x: number; y: number }>();

  constructor(private hooks: RunnerHooks = {}) {}

  load(opts: LoadOptions): void {
    const level = LEVELS[opts.levelId];
    if (!level) throw new Error(`unknown level ${opts.levelId}`);
    this.lastLoad = { ...opts };
    this.world = new World({ level, mode: opts.mode, lawEnabled: opts.lawEnabled, seed: 1337 });
    this.attach = attachMechanics(this.world, opts.mechanics, { maxTier: opts.maxTier });
    this.acc = 0;
    this.hitstop = 0;
    this.pendingFx = [];
    this.prevPos.clear();
    this.version++;
    this.input.releaseAll();
    this.hooks.onWorldChanged?.(this.world);
  }

  restart(): void {
    if (this.lastLoad) this.load(this.lastLoad);
  }

  get loadOptions(): LoadOptions | null {
    return this.lastLoad;
  }

  /** Swap mechanics without resetting the world (hot reload after editing). */
  reloadMechanics(mechanics: MechanicGraph[], maxTier?: number): void {
    if (!this.world) return;
    if (this.lastLoad) this.lastLoad = { ...this.lastLoad, mechanics, maxTier };
    this.attach = attachMechanics(this.world, mechanics, { maxTier });
    this.version++;
  }

  setLaw(on: boolean): boolean {
    const ok = this.world?.setLaw(on) ?? false;
    if (ok && this.lastLoad) this.lastLoad.lawEnabled = on;
    return ok;
  }

  /** Advance by real elapsed milliseconds. Returns the number of sim ticks run. */
  advance(deltaMs: number): number {
    this.ticksThisFrame = 0;
    if (!this.world) return 0;
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (this.paused) return 0;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return 0;
    }
    this.acc += dt * this.timeScale;
    let n = 0;
    while (this.acc >= DT && n < 5) {
      this.acc -= DT;
      this.stepOnce();
      n++;
      if (this.hitstop > 0) {
        this.acc = 0;
        break;
      }
    }
    if (n === 5) this.acc = 0;
    this.ticksThisFrame = n;
    return n;
  }

  stepOnce(): void {
    const w = this.world;
    this.prevPos.clear();
    for (const e of w.entities) if (e.alive) this.prevPos.set(e.id, e.pos);
    w.step(this.input.nextFrame());
    for (const f of w.fx) {
      if (f.type === 'hitstop') this.hitstop = Math.max(this.hitstop, f.duration);
      this.pendingFx.push(f);
    }
    w.fx.length = 0;
    if (w.requests.length) {
      const reqs = w.requests.splice(0);
      for (const r of reqs) this.hooks.onRequest?.(r, this);
    }
  }

  drainFx(): FxEvent[] {
    const out = this.pendingFx;
    this.pendingFx = [];
    return out;
  }

  /** Fraction of a tick accumulated, for render interpolation. */
  get alpha(): number {
    return this.paused || this.hitstop > 0 ? 1 : Math.min(1, this.acc / DT);
  }

  /** Offset that moves an entity from its simulated position back to its interpolated one. */
  lerpOffset(id: number, cur: { x: number; y: number }): { x: number; y: number } {
    const prev = this.prevPos.get(id);
    if (!prev) return { x: 0, y: 0 };
    const k = 1 - this.alpha;
    const dx = (prev.x - cur.x) * k;
    const dy = (prev.y - cur.y) * k;
    // Teleports (respawn, reflection snaps) should not smear across the screen.
    return Math.abs(dx) > 80 || Math.abs(dy) > 80 ? { x: 0, y: 0 } : { x: dx, y: dy };
  }
}
