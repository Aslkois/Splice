import { describe, expect, it } from 'vitest';
import { CAMPAIGN_VALIDATION, levelResources, runSolution } from '../src/dev/campaignValidation';
import { modeFor, rulesFor } from '../src/game/rules';
import { unlockedTier, type Progress } from '../src/persistence/storage';
import { CAMPAIGN_ORDER, HUB, LEVELS } from '../src/sim/levels/levels';

describe('campaign validation: every challenge is solvable under normal rules', () => {
  for (const v of CAMPAIGN_VALIDATION) {
    describe(`${LEVELS[v.levelId].name} (${v.levelId})`, () => {
      it('declares what the player has to work with', () => {
        const r = levelResources(v);
        expect(r.primitives.length).toBeGreaterThan(0);
        expect(r.objective).not.toBe('');
        expect(v.references.length).toBeGreaterThan(0);
      });
      for (const s of v.references) {
        it(`reference: ${s.name}`, () => {
          const r = runSolution(v, s);
          expect(r.rejected).toEqual([]);
          expect(r.completed).toBe(true);
          expect(r.alive).toBe(true);
        });
      }
      if (v.insufficient.length) {
        it('stays a challenge: these strategies fall short', () => {
          for (const s of v.insufficient) {
            const r = runSolution(v, s);
            expect(r.completed, s.name).toBe(false);
          }
        });
      }
    });
  }

  it('every campaign level has a validation entry', () => {
    expect(CAMPAIGN_VALIDATION.map((v) => v.levelId)).toEqual([...CAMPAIGN_ORDER]);
  });

  it("each level's reference rules are exactly what normal progression gives you there", () => {
    let progress: Progress = { completed: [], best: {}, labs: {} };
    for (const v of CAMPAIGN_VALIDATION) {
      expect(modeFor(v.levelId)).toBe('campaign');
      expect(rulesFor('campaign', v.levelId, progress)).toEqual(v.rules);
      progress = { ...progress, completed: [...progress.completed, v.levelId] };
    }
    expect(unlockedTier(progress)).toBe(3);
  });

  it('hub doors open in campaign order', () => {
    const doors = HUB.spawns.filter((s): s is Extract<typeof s, { type: 'door' }> => s.type === 'door');
    const byTarget = Object.fromEntries(doors.map((d) => [d.target, d.requires]));
    expect(byTarget.c1).toBeUndefined();
    expect(byTarget.c2).toBe('c1');
    expect(byTarget.c3).toBe('c2');
  });
});
