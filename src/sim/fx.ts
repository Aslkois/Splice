import type { Vec } from './math';

/**
 * Presentation events emitted by the simulation each tick. The renderer/audio layer consumes them;
 * the simulation never depends on whether anything listened.
 */
export type FxEvent =
  | { type: 'jump'; pos: Vec }
  | { type: 'land'; pos: Vec; speed: number }
  | { type: 'dash'; pos: Vec; dir: number }
  | { type: 'shot'; pos: Vec; dir: Vec; mass: number; team: string }
  | { type: 'impact'; pos: Vec; normal: Vec; energy: number; material: 'metal' | 'wood' | 'flesh' | 'stone' | 'glass' }
  | { type: 'hurt'; pos: Vec; amount: number; entityId: number }
  | { type: 'guard'; pos: Vec; dir: Vec; energy: number }
  | { type: 'parry'; pos: Vec; dir: Vec; energy: number; amplify: number }
  | { type: 'absorb'; pos: Vec; energy: number }
  | { type: 'negate'; pos: Vec; amount: number }
  | { type: 'guardBreak'; pos: Vec }
  | { type: 'break'; pos: Vec; kind: string; size: number }
  | { type: 'death'; pos: Vec }
  | { type: 'spawn'; pos: Vec }
  | { type: 'pickup'; pos: Vec; amount: number }
  | { type: 'spend'; pos: Vec; energy: number; stamina: number; label: string }
  | { type: 'fizzle'; pos: Vec; reason: string }
  | { type: 'telegraph'; pos: Vec; entityId: number; duration: number }
  | { type: 'chargeTick'; pos: Vec; amount: number }
  | { type: 'interrupt'; pos: Vec }
  | { type: 'hitstop'; duration: number }
  | { type: 'shake'; intensity: number; duration: number }
  | { type: 'gateOpen'; pos: Vec }
  | { type: 'objective'; done: boolean }
  | { type: 'thrust'; pos: Vec; dir: Vec; amount: number }
  | { type: 'cosmetic'; pos: Vec; sound: string; pitch: number };

export type FxType = FxEvent['type'];
