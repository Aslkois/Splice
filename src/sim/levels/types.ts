import type { Vec } from '../math';

export type SolidStyle = 'ground' | 'platform' | 'wall' | 'metal' | 'glass';

/** Static geometry. x/y is the top-left corner. */
export interface SolidDef {
  x: number;
  y: number;
  w: number;
  h: number;
  style?: SolidStyle;
}

export type SpawnDef =
  | { type: 'crate'; x: number; y: number; heavy?: boolean; tag?: string }
  | { type: 'turret'; x: number; y: number; facing?: -1 | 1; interval?: number; range?: number; tag?: string; hp?: number }
  | { type: 'walker'; x: number; y: number; tag?: string }
  | { type: 'cannon'; x: number; y: number; facing?: -1 | 1; tag?: string; hp?: number }
  | { type: 'target'; x: number; y: number; hp?: number; tag?: string }
  | { type: 'cell'; x: number; y: number; amount?: number }
  /** A generator with a finite reserve that feeds your reservoir while you stand in its field. */
  | { type: 'dynamo'; x: number; y: number; reserve: number; radius?: number }
  /** Rect hazards, x/y top-left. */
  | { type: 'spikes'; x: number; y: number; w: number; h?: number }
  | { type: 'goal'; x: number; y: number; w: number; h: number; tag?: string }
  | { type: 'door'; x: number; y: number; target: string; label: string; requires?: string }
  | { type: 'bench'; x: number; y: number }
  | { type: 'sign'; x: number; y: number; text: string; w?: number }
  /** A barrier that dissolves when every entity carrying `opensWhen` is destroyed. x/y top-left. */
  | { type: 'gate'; x: number; y: number; w: number; h: number; opensWhen: string }
  /** Moving platform, x/y top-left, shuttling to toX/toY. */
  | { type: 'mover'; x: number; y: number; w: number; h?: number; toX: number; toY: number; speed?: number };

export type ObjectiveDef =
  | { kind: 'reach'; zoneTag: string; text: string }
  | { kind: 'destroy'; tags: string[]; text: string }
  | { kind: 'destroyThenReach'; tags: string[]; zoneTag: string; text: string }
  /** Hold at least this much energy in the battery, alive. */
  | { kind: 'charge'; energy: number; text: string };

export type LevelTheme = 'workshop' | 'lab' | 'foundry';

export interface LevelDef {
  id: string;
  name: string;
  subtitle?: string;
  width: number;
  height: number;
  spawn: Vec;
  solids: SolidDef[];
  spawns: SpawnDef[];
  objective?: ObjectiveDef;
  startEnergy?: number;
  theme: LevelTheme;
}
