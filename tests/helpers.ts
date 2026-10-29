import { ScriptedInput, type InputFrame } from '../src/sim/input';
import type { LevelDef } from '../src/sim/levels/types';
import { World, type WorldOptions } from '../src/sim/World';

/** A flat test room: floor at y=600. */
export function flatLevel(extra: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test',
    name: 'Test Room',
    theme: 'lab',
    width: 3000,
    height: 900,
    spawn: { x: 400, y: 570 },
    startEnergy: 100,
    solids: [
      { x: -40, y: 600, w: 3080, h: 300, style: 'ground' },
      { x: -40, y: -400, w: 40, h: 1000, style: 'wall' },
      { x: 3000, y: -400, w: 40, h: 1000, style: 'wall' },
    ],
    spawns: [],
    ...extra,
  };
}

export function makeWorld(opts: Partial<WorldOptions> & { level?: LevelDef } = {}): World {
  return new World({ level: opts.level ?? flatLevel(), mode: opts.mode ?? 'test', lawEnabled: opts.lawEnabled ?? true, seed: 7 });
}

/** Drives a world with a held-keys script. */
export class Driver {
  input = new ScriptedInput();
  constructor(public world: World) {}
  run(seconds: number, held: string[] = [], aim: { x: number; y: number } | null = null): void {
    const ticks = Math.round(seconds * 60);
    for (let i = 0; i < ticks; i++) this.world.step(this.input.frame(held, aim));
  }
  tap(key: string, holdTicks = 2, alsoHeld: string[] = []): void {
    for (let i = 0; i < holdTicks; i++) this.world.step(this.input.frame([key, ...alsoHeld]));
    this.world.step(this.input.frame(alsoHeld));
  }
  frame(held: string[]): InputFrame {
    return this.input.frame(held);
  }
}
