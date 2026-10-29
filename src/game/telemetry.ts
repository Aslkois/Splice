import type { Txn } from '../sim/exchange/Exchange';

export interface MechChip {
  id: string;
  name: string;
  color: string;
  ok: boolean;
  lastRun: number;
  lastFail: number;
  failReason?: string;
}

export interface HudSnapshot {
  ready: boolean;
  time: number;
  levelId: string;
  levelName: string;
  mode: string;
  law: boolean;
  hp: number;
  maxHp: number;
  energy: number;
  capacity: number;
  stamina: number;
  staminaMax: number;
  guard: boolean;
  dead: boolean;
  charges: { name: string; amount: number; channeling: boolean }[];
  receipt: (Txn & { age: number })[];
  diagnostics: { message: string; age: number }[];
  mechanics: MechChip[];
  objective: string | null;
  objectiveDone: boolean;
  prompt: string | null;
  certified: boolean;
}

const EMPTY: HudSnapshot = {
  ready: false,
  time: 0,
  levelId: '',
  levelName: '',
  mode: '',
  law: true,
  hp: 0,
  maxHp: 1,
  energy: 0,
  capacity: 1,
  stamina: 0,
  staminaMax: 1,
  guard: false,
  dead: false,
  charges: [],
  receipt: [],
  diagnostics: [],
  mechanics: [],
  objective: null,
  objectiveDone: false,
  prompt: null,
  certified: true,
};

/** A tiny external store the React HUD subscribes to; the scene publishes ~15 times a second. */
class Telemetry {
  private snap: HudSnapshot = EMPTY;
  private listeners = new Set<() => void>();

  publish(s: HudSnapshot): void {
    this.snap = s;
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = (): HudSnapshot => this.snap;
}

export const telemetry = new Telemetry();
