import { runner } from '../game/bridge';
import { telemetry } from '../game/telemetry';
import { useApp } from '../store/store';

/**
 * Read-mostly hooks for automated browser tests and curious players (window.__SPLICE__).
 * They expose state and synthetic key presses; they never bypass the exchange ledger.
 */
export function installDebugHooks(): void {
  (window as unknown as Record<string, unknown>).__SPLICE__ = {
    runner,
    app: useApp,
    telemetry,
    press: (k: string) => runner.input.press(k),
    release: (k: string) => runner.input.release(k),
    state: () => {
      const w = runner.world;
      const p = w?.player;
      return w && p
        ? {
            level: w.level.id,
            mode: w.mode,
            time: w.time,
            alive: p.alive,
            hp: p.hp,
            energy: p.account.energy,
            stamina: p.account.stamina,
            pos: p.pos,
            vel: p.vel,
            grounded: p.grounded,
            objectiveDone: w.objective.done,
            law: w.lawEnabled,
            entities: w.entities.filter((e) => e.alive).map((e) => ({ id: e.id, kind: e.kind, x: e.pos.x, y: e.pos.y, hp: e.hp, tag: e.tag })),
          }
        : null;
    },
  };
}
