import type { LevelDef } from './types';

/** The hub: a small workshop with the workbench, a practice dummy and the doors out. */
export const HUB: LevelDef = {
  id: 'hub',
  name: 'The Workshop',
  theme: 'workshop',
  width: 2000,
  height: 900,
  spawn: { x: 300, y: 700 },
  startEnergy: 100,
  solids: [
    { x: -40, y: 760, w: 2080, h: 200, style: 'ground' },
    { x: -40, y: -200, w: 60, h: 1000, style: 'wall' },
    { x: 1980, y: -200, w: 60, h: 1000, style: 'wall' },
    { x: 560, y: 610, w: 180, h: 22, style: 'platform' },
    { x: 760, y: 500, w: 120, h: 22, style: 'platform' },
  ],
  spawns: [
    { type: 'bench', x: 300, y: 732 },
    { type: 'sign', x: 300, y: 560, text: 'The workbench. Press E here, or Tab anywhere.', w: 300 },
    { type: 'target', x: 690, y: 728, hp: 30 },
    { type: 'crate', x: 820, y: 736 },
    { type: 'cell', x: 820, y: 470 },
    { type: 'sign', x: 1260, y: 540, text: 'Press E at a door to go through.', w: 260 },
    { type: 'door', x: 1080, y: 718, target: 'c1', label: 'Cross the Gap' },
    { type: 'door', x: 1260, y: 718, target: 'c2', label: 'Return to Sender', requires: 'c1' },
    { type: 'door', x: 1440, y: 718, target: 'c3', label: 'Survive the Impossible', requires: 'c2' },
    { type: 'door', x: 1760, y: 718, target: 'sandbox', label: 'Sandbox' },
  ],
};

/**
 * Challenge 1. The far ledge is beyond what the built-in jump and dash can reach together.
 * Any mechanic that legitimately adds reach (air impulses, thrust, recoil, momentum tricks) works.
 */
export const C1: LevelDef = {
  id: 'c1',
  name: 'Cross the Gap',
  subtitle: 'Reach the far ledge.',
  theme: 'lab',
  width: 2300,
  height: 1100,
  spawn: { x: 160, y: 740 },
  startEnergy: 40,
  solids: [
    { x: -40, y: 800, w: 820, h: 320, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1120, style: 'wall' },
    { x: 1220, y: 880, w: 1120, h: 240, style: 'ground' },
    { x: 2280, y: -300, w: 60, h: 1200, style: 'wall' },
    { x: 330, y: 650, w: 140, h: 20, style: 'platform' },
  ],
  spawns: [
    { type: 'cell', x: 400, y: 620 },
    { type: 'cell', x: 640, y: 772 },
    { type: 'crate', x: 540, y: 770 },
    { type: 'sign', x: 600, y: 520, text: 'Your legs are not the only thing you can program.', w: 420 },
    { type: 'goal', x: 1980, y: 760, w: 260, h: 120, tag: 'far' },
  ],
  objective: { kind: 'reach', zoneTag: 'far', text: 'Reach the far ledge.' },
};

/**
 * Challenge 2. Two emplacements sit beyond a chasm, out of reach. Their bolts are the only
 * plentiful source of energy in the room.
 */
export const C2: LevelDef = {
  id: 'c2',
  name: 'Return to Sender',
  subtitle: 'Silence both emplacements.',
  theme: 'foundry',
  width: 2000,
  height: 1100,
  spawn: { x: 220, y: 760 },
  startEnergy: 30,
  solids: [
    { x: -40, y: 820, w: 1200, h: 300, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1120, style: 'wall' },
    { x: 1420, y: 580, w: 640, h: 540, style: 'metal' },
    { x: 1700, y: 420, w: 360, h: 40, style: 'metal' },
    { x: 1980, y: -300, w: 60, h: 900, style: 'wall' },
    { x: 560, y: 640, w: 160, h: 20, style: 'platform' },
  ],
  spawns: [
    { type: 'turret', x: 1446, y: 560, facing: -1, interval: 1.8, range: 1100, tag: 'sender' },
    { type: 'turret', x: 1726, y: 400, facing: -1, interval: 2.3, range: 1300, tag: 'sender' },
    { type: 'crate', x: 640, y: 616 },
    { type: 'sign', x: 330, y: 560, text: 'They keep sending things. Send them back.', w: 380 },
  ],
  objective: { kind: 'destroy', tags: ['sender'], text: 'Silence both emplacements.' },
};

/**
 * Challenge 3. A sealed chamber. The Judgement cannon's slug carries ~400 E — lethal even through
 * a guard. The exit gate only opens once the cannon is gone.
 */
export const C3: LevelDef = {
  id: 'c3',
  name: 'Survive the Impossible',
  subtitle: 'Get out.',
  theme: 'foundry',
  width: 1700,
  height: 900,
  spawn: { x: 420, y: 700 },
  startEnergy: 40,
  solids: [
    { x: -40, y: 760, w: 1780, h: 200, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1100, style: 'wall' },
    { x: 1680, y: -300, w: 60, h: 1100, style: 'wall' },
    { x: -40, y: 260, w: 1780, h: 40, style: 'metal' },
    { x: 700, y: 560, w: 160, h: 20, style: 'platform' },
    { x: 1220, y: 450, w: 90, h: 20, style: 'metal' },
  ],
  spawns: [
    { type: 'cannon', x: 1500, y: 723, facing: -1, tag: 'judgement' },
    { type: 'gate', x: 200, y: 300, w: 40, h: 460, opensWhen: 'judgement' },
    { type: 'goal', x: 40, y: 640, w: 120, h: 120, tag: 'exit' },
    { type: 'crate', x: 980, y: 736 },
    { type: 'crate', x: 800, y: 536 },
    { type: 'cell', x: 780, y: 530 },
    { type: 'turret', x: 1265, y: 430, facing: -1, interval: 2.6, range: 900, hp: 50 },
    { type: 'sign', x: 520, y: 440, text: 'Nothing that hits this hard can be blocked. Probably.', w: 460 },
  ],
  objective: { kind: 'destroyThenReach', tags: ['judgement'], zoneTag: 'exit', text: 'Get out.' },
};

/** Free-form physics playground. */
export const ARENA: LevelDef = {
  id: 'sandbox',
  name: 'Sandbox Arena',
  theme: 'lab',
  width: 3400,
  height: 1500,
  spawn: { x: 260, y: 1100 },
  startEnergy: 100,
  solids: [
    { x: -40, y: 1180, w: 1500, h: 360, style: 'ground' },
    { x: 1700, y: 1180, w: 1740, h: 360, style: 'ground' },
    { x: -40, y: -400, w: 60, h: 1600, style: 'wall' },
    { x: 3380, y: -400, w: 60, h: 1600, style: 'wall' },
    { x: 420, y: 1020, w: 200, h: 22, style: 'platform' },
    { x: 700, y: 880, w: 200, h: 22, style: 'platform' },
    { x: 1000, y: 760, w: 260, h: 22, style: 'platform' },
    { x: 2050, y: 980, w: 300, h: 200, style: 'metal' },
    { x: 2600, y: 860, w: 200, h: 22, style: 'platform' },
    { x: 2900, y: 700, w: 480, h: 40, style: 'metal' },
    { x: 1250, y: 1060, w: 60, h: 120, style: 'wall' },
  ],
  spawns: [
    { type: 'crate', x: 600, y: 1150 },
    { type: 'crate', x: 650, y: 1150 },
    { type: 'crate', x: 625, y: 1105 },
    { type: 'crate', x: 1100, y: 730, heavy: true },
    { type: 'crate', x: 2400, y: 1150, heavy: true },
    { type: 'crate', x: 2200, y: 950 },
    { type: 'target', x: 900, y: 1148 },
    { type: 'target', x: 1150, y: 728 },
    { type: 'target', x: 2700, y: 828 },
    { type: 'target', x: 3300, y: 668 },
    { type: 'spikes', x: 1900, y: 1162, w: 140, h: 18 },
    { type: 'turret', x: 2200, y: 960, facing: -1, range: 900 },
    { type: 'turret', x: 3200, y: 680, facing: -1, interval: 2.2, range: 1100 },
    { type: 'walker', x: 2700, y: 1150 },
    { type: 'walker', x: 1600, y: 1150 },
    { type: 'cell', x: 520, y: 990 },
    { type: 'cell', x: 800, y: 850 },
    { type: 'cell', x: 1130, y: 700 },
    { type: 'cell', x: 2700, y: 830 },
    { type: 'cell', x: 3000, y: 670 },
    { type: 'sign', x: 250, y: 900, text: 'No score here, and no rules except the ones you leave switched on.', w: 380 },
  ],
};

export const LEVELS: Record<string, LevelDef> = { hub: HUB, c1: C1, c2: C2, c3: C3, sandbox: ARENA };

export const CAMPAIGN_ORDER = ['c1', 'c2', 'c3'] as const;
