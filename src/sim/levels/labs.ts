import type { LevelDef } from './types';

/**
 * Challenge Lab: short rooms with a restricted parts list and a block budget.
 * Scored on blocks used, then energy spent, then time.
 */
export interface LabDef {
  id: string;
  name: string;
  brief: string;
  /** Primitive types allowed in equipped mechanics. */
  parts: string[];
  /** Total blocks across all equipped mechanics. */
  maxBlocks: number;
  level: LevelDef;
}

const LAB_LONG_JUMP: LevelDef = {
  id: 'lab1',
  name: 'Two Blocks',
  theme: 'lab',
  width: 1900,
  height: 1000,
  spawn: { x: 200, y: 700 },
  startEnergy: 100,
  solids: [
    { x: -40, y: 760, w: 740, h: 260, style: 'ground' },
    { x: 1150, y: 760, w: 790, h: 260, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1060, style: 'wall' },
    { x: 1880, y: -300, w: 60, h: 1060, style: 'wall' },
  ],
  spawns: [{ type: 'goal', x: 1500, y: 640, w: 240, h: 120, tag: 'flag' }],
  objective: { kind: 'reach', zoneTag: 'flag', text: 'Reach the flag.' },
};

const LAB_LONG_SHOT: LevelDef = {
  id: 'lab2',
  name: 'Long Distance',
  theme: 'lab',
  width: 1700,
  height: 1000,
  spawn: { x: 300, y: 700 },
  startEnergy: 60,
  solids: [
    { x: -40, y: 760, w: 1780, h: 260, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1060, style: 'wall' },
    { x: 1680, y: -300, w: 60, h: 1060, style: 'wall' },
    { x: 1200, y: 360, w: 260, h: 30, style: 'metal' },
  ],
  spawns: [{ type: 'target', x: 1222, y: 340, hp: 44, tag: 'crystal' }],
  objective: { kind: 'destroy', tags: ['crystal'], text: 'Shatter the crystal with 60 E.' },
};

const LAB_LIGHTNING_ROD: LevelDef = {
  id: 'lab3',
  name: 'Lightning Rod',
  theme: 'foundry',
  width: 1500,
  height: 1000,
  spawn: { x: 380, y: 700 },
  startEnergy: 0,
  solids: [
    { x: -40, y: 760, w: 1580, h: 260, style: 'ground' },
    { x: -40, y: -300, w: 60, h: 1060, style: 'wall' },
    { x: 1480, y: -300, w: 60, h: 1060, style: 'wall' },
  ],
  spawns: [{ type: 'turret', x: 1250, y: 740, facing: -1, interval: 1.7, range: 1200, hp: 9999 }],
  objective: { kind: 'charge', energy: 60, text: 'Fill your battery to 60 E.' },
};

export const LABS: LabDef[] = [
  {
    id: 'lab1',
    name: 'Two Blocks',
    brief: 'A gap no legs can clear. Two blocks, no more.',
    parts: ['on.keyPressed', 'on.keyReleased', 'on.keyHeld', 'act.impulse', 'act.force', 'act.setVelocity'],
    maxBlocks: 2,
    level: LAB_LONG_JUMP,
  },
  {
    id: 'lab2',
    name: 'Long Distance',
    brief: 'The crystal is out of reach and your battery holds 60 E. Make every joule count.',
    parts: ['on.keyPressed', 'act.projectile', 'vec.aim', 'entity.nearest', 'entity.directionTo', 'vec.make', 'num.const'],
    maxBlocks: 4,
    level: LAB_LONG_SHOT,
  },
  {
    id: 'lab3',
    name: 'Lightning Rod',
    brief: 'You start empty. The turret does not.',
    parts: [
      'on.keyPressed',
      'on.keyReleased',
      'on.successfulBlock',
      'on.incomingHit',
      'act.block',
      'act.unblock',
      'act.absorb',
      'flow.if',
      'logic.compare',
      'timer.reset',
      'timer.value',
    ],
    maxBlocks: 6,
    level: LAB_LIGHTNING_ROD,
  },
];

export const LAB_BY_ID: Record<string, LabDef> = Object.fromEntries(LABS.map((l) => [l.id, l]));
