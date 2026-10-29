import { GameRunner, type RunnerHooks } from './GameRunner';

/**
 * The single runner shared by the Phaser scene (which advances and draws it) and the React app
 * (which loads levels, pauses it and edits mechanics).
 */
const hooks: RunnerHooks = {};
export const runner = new GameRunner(hooks);

export function setRunnerHooks(h: RunnerHooks): void {
  hooks.onRequest = h.onRequest;
  hooks.onWorldChanged = h.onWorldChanged;
}

export interface PresentationSettings {
  shake: boolean;
  flashes: boolean;
}

export const presentation: PresentationSettings = { shake: true, flashes: true };
