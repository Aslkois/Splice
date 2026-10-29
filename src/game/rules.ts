import type { ValidateOptions } from '../mechanics/validate';
import { unlockedTier, type Progress } from '../persistence/storage';
import { LAB_BY_ID } from '../sim/levels/labs';
import type { GameMode } from '../sim/World';

export function modeFor(levelId: string): GameMode {
  if (levelId === 'hub') return 'hub';
  if (levelId === 'sandbox' || levelId === 'testbench') return 'sandbox';
  if (LAB_BY_ID[levelId]) return 'lab';
  return 'campaign';
}

/** Which parts a world allows: everything in the sandbox, the lab's list in a lab, unlocked tiers elsewhere. */
export function rulesFor(mode: GameMode, levelId: string, progress: Progress): ValidateOptions {
  if (mode === 'sandbox') return {};
  if (mode === 'lab') {
    const lab = LAB_BY_ID[levelId];
    return lab ? { allowedTypes: lab.parts, maxBlocks: lab.maxBlocks } : {};
  }
  return { maxTier: unlockedTier(progress) };
}
