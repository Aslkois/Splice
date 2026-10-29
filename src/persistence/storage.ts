import { deserializeLibrary, serializeLibrary } from '../mechanics/serialize';
import type { MechanicLibrary } from '../mechanics/schema';

const KEYS = {
  library: 'splice.v1.library',
  progress: 'splice.v1.progress',
  settings: 'splice.v1.settings',
};

export interface LabScore {
  blocks: number;
  energy: number;
  time: number;
}

export interface Progress {
  completed: string[];
  /** Best completion time per challenge, in simulation seconds. */
  best: Record<string, number>;
  /** Best Challenge Lab result per lab (fewest blocks, then least energy, then fastest). */
  labs: Record<string, LabScore>;
}

export interface Settings {
  master: number;
  sfx: number;
  ui: number;
  shake: boolean;
  flashes: boolean;
}

export const DEFAULT_SETTINGS: Settings = { master: 0.8, sfx: 0.9, ui: 0.6, shake: true, flashes: true };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the game keeps running, it just won't remember */
  }
}

export function loadLibrary(): MechanicLibrary {
  try {
    return deserializeLibrary(read(KEYS.library));
  } catch {
    return deserializeLibrary(null);
  }
}

export function saveLibrary(lib: MechanicLibrary): void {
  write(KEYS.library, serializeLibrary(lib));
}

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(read(KEYS.progress) ?? 'null') as Partial<Progress> | null;
    return {
      completed: Array.isArray(raw?.completed) ? raw!.completed.filter((x): x is string => typeof x === 'string') : [],
      best: raw?.best && typeof raw.best === 'object' ? raw.best : {},
      labs: raw?.labs && typeof raw.labs === 'object' ? raw.labs : {},
    };
  } catch {
    return { completed: [], best: {}, labs: {} };
  }
}

export function saveProgress(p: Progress): void {
  write(KEYS.progress, JSON.stringify(p));
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(read(KEYS.settings) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  write(KEYS.settings, JSON.stringify(s));
}

export function betterLabScore(a: LabScore, b: LabScore | undefined): boolean {
  if (!b) return true;
  if (a.blocks !== b.blocks) return a.blocks < b.blocks;
  if (Math.abs(a.energy - b.energy) > 0.05) return a.energy < b.energy;
  return a.time < b.time;
}

/** Campaign unlock tier = number of challenges completed in order. */
export function unlockedTier(p: Progress): number {
  let tier = 0;
  for (const id of ['c1', 'c2', 'c3']) {
    if (p.completed.includes(id)) tier++;
    else break;
  }
  return tier;
}
