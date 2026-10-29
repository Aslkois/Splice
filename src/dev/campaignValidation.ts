/**
 * Development-only campaign validation. Every challenge declares what the player has to work with
 * and at least one reference solution: mechanics built from Workshop primitives (exactly what a
 * player could wire) plus a scripted "player" pressing keys. Each solution is played through the
 * real World, the real mechanic runtime and the real exchange, under normal campaign rules with the
 * Law of Equivalent Exchange on. A level only passes when its objective actually completes.
 *
 * Reference solutions prove a level is solvable; they are not the "intended" answer. Levels may also
 * list strategies that must NOT be enough (e.g. the built-in moveset), so a challenge can't quietly
 * become trivial.
 *
 * Nothing here ships to players: the game never imports this file.
 */
import { attachMechanics, GraphBuilder } from '../mechanics/builder';
import { PRIMITIVES } from '../mechanics/registry';
import type { MechanicGraph } from '../mechanics/schema';
import type { ValidateOptions } from '../mechanics/validate';
import { Projectile } from '../sim/entities/Projectile';
import { ScriptedInput } from '../sim/input';
import { LEVELS } from '../sim/levels/levels';
import type { LevelDef } from '../sim/levels/types';
import { World } from '../sim/World';

/** A scripted player: holds keys tick by tick and watches the world like a person would. */
export class Bot {
  readonly input = new ScriptedInput();
  readonly world: World;
  readonly rejected: string[];
  constructor(level: LevelDef, graphs: MechanicGraph[], rules: ValidateOptions) {
    this.world = new World({ level, mode: 'campaign', seed: 3 });
    const att = attachMechanics(this.world, graphs, rules);
    this.rejected = att.rejected.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => `${r.name}: ${i.message}`));
  }
  get p() {
    return this.world.player!;
  }
  tick(keys: string[]): void {
    this.world.step(this.input.frame(keys));
  }
  /** Runs `keys()` every tick until `cond()` holds (true) or time runs out (false). */
  until(cond: () => boolean, keys: () => string[], maxSeconds: number): boolean {
    for (let i = 0; i < maxSeconds * 60; i++) {
      if (cond()) return true;
      if (!this.p.alive) return cond();
      this.tick(keys());
    }
    return cond();
  }
  completed(): boolean {
    return this.world.objective.done && this.world.requests.some((r) => r.type === 'complete');
  }
  /** Is an enemy shot going to reach me within `seconds`? */
  incoming(seconds: number): Projectile | null {
    const p = this.p;
    for (const e of this.world.entities) {
      if (!(e instanceof Projectile) || !e.alive || e.team !== 'enemy') continue;
      const dx = p.pos.x - e.pos.x;
      const dy = p.pos.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      const closing = (dx * e.velocity.x + dy * e.velocity.y) / Math.max(d, 1);
      if (closing > 0 && d / closing < seconds) return e;
    }
    return null;
  }
}

export interface ReferenceSolution {
  name: string;
  summary: string;
  mechanics: () => MechanicGraph[];
  play: (bot: Bot) => void;
}

export interface LevelValidation {
  levelId: string;
  /** The rules a player has on this level in normal progression. */
  rules: ValidateOptions;
  difficulty: 'introduction' | 'moderate' | 'hard';
  constraints: string[];
  /** Timing or skill a solution needs, in plain words. */
  requirements: string[];
  references: ReferenceSolution[];
  /** Strategies that must fail, so the challenge stays a challenge. */
  insufficient: ReferenceSolution[];
}

export interface RunResult {
  name: string;
  completed: boolean;
  alive: boolean;
  seconds: number;
  energySpent: number;
  rejected: string[];
}

/** What a level offers, derived from its definition and rules (not hand-maintained). */
export function levelResources(v: LevelValidation): {
  primitives: string[];
  startEnergy: number;
  cells: number;
  dynamoReserve: number;
  objective: string;
} {
  const level = LEVELS[v.levelId];
  const primitives = PRIMITIVES.filter((p) => (v.rules.allowedTypes ? v.rules.allowedTypes.includes(p.type) : p.tier <= (v.rules.maxTier ?? 99))).map((p) => p.type);
  let cells = 0;
  let dynamoReserve = 0;
  for (const s of level.spawns) {
    if (s.type === 'cell') cells += s.amount ?? 35;
    if (s.type === 'dynamo') dynamoReserve += s.reserve;
  }
  return { primitives, startEnergy: level.startEnergy ?? 40, cells, dynamoReserve, objective: level.objective?.text ?? '' };
}

export function runSolution(v: LevelValidation, s: ReferenceSolution): RunResult {
  const bot = new Bot(LEVELS[v.levelId], s.mechanics(), v.rules);
  if (bot.rejected.length) return { name: s.name, completed: false, alive: true, seconds: 0, energySpent: 0, rejected: bot.rejected };
  s.play(bot);
  return {
    name: s.name,
    completed: bot.completed(),
    alive: bot.p.alive,
    seconds: Math.round(bot.world.time * 100) / 100,
    energySpent: Math.round(bot.world.exchange.totalSpent * 10) / 10,
    rejected: [],
  };
}

// ------------------------------------------------------------------ reference mechanics

/** Air jump: Space while the normal jump is unavailable, once per air time, reset on landing. */
export function doubleJumpGraph(opts: { speed?: number; mode?: 'targetVelocity' | 'impulse'; airJumps?: number } = {}): MechanicGraph {
  const speed = opts.speed ?? 600;
  const b = new GraphBuilder('Double Jump');
  const ev = b.node('on.keyPressed', { key: 'Space' }, { x: 0, y: 0 });
  const grounded = b.node('state.grounded', {}, { x: 0, y: 140 });
  const not = b.node('logic.not', {}, { x: 180, y: 140 });
  const ifAir = b.node('flow.if', {}, { x: 260, y: 0 });
  const used = b.node('var.getNumber', { name: 'Air Jumps Used', scope: 'character' }, { x: 300, y: 160 });
  const cmp = b.node('logic.compare', { op: '<', b: opts.airJumps ?? 1 }, { x: 480, y: 160 });
  const ifLeft = b.node('flow.if', {}, { x: 520, y: 0 });
  const jump =
    opts.mode === 'impulse'
      ? b.node('act.impulse', { impulse: { x: 0, y: -speed } }, { x: 780, y: 0 })
      : b.node('act.setVelocity', { axes: 'y', velocity: { x: 0, y: -speed } }, { x: 780, y: 0 });
  const count = b.node('var.addNumber', { name: 'Air Jumps Used', scope: 'character', value: 1 }, { x: 1040, y: 0 });
  b.flow(ev, 'then', ifAir).wire(grounded, 'out', not, 'a').wire(not, 'out', ifAir, 'cond');
  b.flow(ifAir, 'then', ifLeft).wire(used, 'out', cmp, 'a').wire(cmp, 'out', ifLeft, 'cond');
  b.flow(ifLeft, 'then', jump).flow(jump, 'then', count);
  const land = b.node('on.landing', {}, { x: 0, y: 320 });
  const reset = b.node('var.setNumber', { name: 'Air Jumps Used', scope: 'character', value: 0 }, { x: 260, y: 320 });
  b.flow(land, 'then', reset);
  return b.build();
}

/** Air dash: Q in the air sets your horizontal speed along your facing. Once per air time. */
export function airDashGraph(speed = 850): MechanicGraph {
  const b = new GraphBuilder('Air Dash');
  const ev = b.node('on.keyPressed', { key: 'Q' }, { x: 0, y: 0 });
  const grounded = b.node('state.grounded', {}, { x: 0, y: 140 });
  const not = b.node('logic.not', {}, { x: 180, y: 140 });
  const ifAir = b.node('flow.if', {}, { x: 260, y: 0 });
  const spent = b.node('var.getFlag', { name: 'Dashed', scope: 'character' }, { x: 300, y: 160 });
  const notSpent = b.node('logic.not', {}, { x: 480, y: 160 });
  const ifReady = b.node('flow.if', {}, { x: 520, y: 0 });
  const facing = b.node('vec.facing', {}, { x: 560, y: 300 });
  const scale = b.node('vec.scale', { s: speed }, { x: 740, y: 300 });
  const set = b.node('act.setVelocity', { axes: 'x' }, { x: 780, y: 0 });
  const mark = b.node('var.setFlag', { name: 'Dashed', scope: 'character', value: true }, { x: 1040, y: 0 });
  b.flow(ev, 'then', ifAir).wire(grounded, 'out', not, 'a').wire(not, 'out', ifAir, 'cond');
  b.flow(ifAir, 'then', ifReady).wire(spent, 'out', notSpent, 'a').wire(notSpent, 'out', ifReady, 'cond');
  b.flow(ifReady, 'then', set).flow(set, 'then', mark);
  b.wire(facing, 'out', scale, 'v').wire(scale, 'out', set, 'velocity');
  const land = b.node('on.landing', {}, { x: 0, y: 420 });
  const reset = b.node('var.setFlag', { name: 'Dashed', scope: 'character', value: false }, { x: 260, y: 420 });
  b.flow(land, 'then', reset);
  return b.build();
}

/** Raise the guard on F (and note when), lower it on release. */
function guard(b: GraphBuilder): void {
  const press = b.node('on.keyPressed', { key: 'F' }, { x: 0, y: 0 });
  const raise = b.node('act.block', {}, { x: 220, y: 0 });
  const reset = b.node('timer.reset', { name: 'Parry' }, { x: 440, y: 0 });
  b.flow(press, 'then', raise).flow(raise, 'then', reset);
  const release = b.node('on.keyReleased', { key: 'F' }, { x: 0, y: 140 });
  const lower = b.node('act.unblock', {}, { x: 220, y: 140 });
  b.flow(release, 'then', lower);
}

/** Reflect a guarded hit if the guard is fresh — optionally amplified when the energy is there. */
export function returnToSenderGraph(opts: { window?: number; amplify?: number } = {}): MechanicGraph {
  const b = new GraphBuilder('Return to Sender');
  guard(b);
  const ev = b.node('on.successfulBlock', {}, { x: 0, y: 300 });
  const timer = b.node('timer.value', { name: 'Parry' }, { x: 100, y: 420 });
  const cmp = b.node('logic.compare', { op: '<', b: opts.window ?? 0.4 }, { x: 260, y: 420 });
  const iff = b.node('flow.if', {}, { x: 220, y: 300 });
  b.flow(ev, 'then', iff).wire(timer, 'out', cmp, 'a').wire(cmp, 'out', iff, 'cond');
  const plain = b.node('act.reflect', { amplify: 1 }, { x: 760, y: 420 });
  if (opts.amplify && opts.amplify > 1) {
    const afford = b.node('res.canAfford', { resource: 'energy', amount: 20 }, { x: 260, y: 560 });
    const ifRich = b.node('flow.if', {}, { x: 440, y: 300 });
    const strong = b.node('act.reflect', { amplify: opts.amplify }, { x: 760, y: 300 });
    b.flow(iff, 'then', ifRich).wire(afford, 'out', ifRich, 'cond');
    b.flow(ifRich, 'then', strong).flow(strong, 'failed', plain).flow(ifRich, 'else', plain);
  } else b.flow(iff, 'then', plain);
  return b.build();
}

/** Return to Sender plus Prevent: survives a hit that would otherwise be lethal even through a guard. */
export function deathParryGraph(window = 0.4): MechanicGraph {
  const b = new GraphBuilder('Death Parry');
  guard(b);
  const ev = b.node('on.successfulBlock', {}, { x: 0, y: 300 });
  const timer = b.node('timer.value', { name: 'Parry' }, { x: 100, y: 420 });
  const cmp = b.node('logic.compare', { op: '<', b: window }, { x: 260, y: 420 });
  const iff = b.node('flow.if', {}, { x: 220, y: 300 });
  const front = b.node('flow.if', {}, { x: 420, y: 300 });
  const reflect = b.node('act.reflect', { amplify: 1 }, { x: 620, y: 300 });
  const prevent = b.node('act.prevent', {}, { x: 820, y: 300 });
  b.flow(ev, 'then', iff).wire(timer, 'out', cmp, 'a').wire(cmp, 'out', iff, 'cond');
  b.flow(iff, 'then', front).wire(ev, 'blockable', front, 'cond');
  b.flow(front, 'then', reflect).flow(reflect, 'then', prevent);
  return b.build();
}

// ------------------------------------------------------------------ scripted players

/** Runs right; jumps at the edge holding Space; near the apex lets go and presses `airKey`. */
function leapWith(airKey: 'Space' | 'Q', opts: { takeoff?: number; airAt?: 'apex' | 'falling' } = {}) {
  return (bot: Bot) => {
    const takeoff = opts.takeoff ?? 760;
    bot.until(() => bot.p.pos.x >= takeoff, () => ['D'], 8);
    bot.tick(['D', 'Space']);
    const trigger = opts.airAt === 'falling' ? () => bot.p.vel.y > 250 : () => bot.p.vel.y > -40;
    bot.until(trigger, () => ['D', 'Space'], 2);
    if (airKey === 'Space') bot.tick(['D']);
    bot.tick(['D', airKey]);
    bot.until(() => bot.completed(), () => ['D', 'Space'], 10);
  };
}

/** The built-in moveset at its best: every combination of take-off point and ground dash. */
function builtinAttempt(takeoff: number, dashAt: number) {
  return (bot: Bot) => {
    bot.until(
      () => bot.p.pos.x >= takeoff,
      () => (dashAt > 0 && bot.p.pos.x >= dashAt && bot.p.pos.x < dashAt + 8 ? ['D', 'Shift'] : ['D']),
      8,
    );
    bot.tick(['D', 'Space', 'Shift']);
    bot.until(() => bot.completed(), () => ['D', 'Space', 'Shift'], 6);
  };
}

/** Walks right to `x`, hopping over crates instead of shoving them along. */
function walkTo(bot: Bot, x: number): void {
  let stuckFor = 0;
  bot.until(
    () => bot.p.pos.x >= x,
    () => {
      const crateAhead = bot.world.pushablesBeside(bot.p, 1).length > 0;
      stuckFor = (Math.abs(bot.p.vel.x) < 60 || crateAhead) && bot.p.grounded ? stuckFor + 1 : 0;
      return stuckFor > 3 ? ['D', 'Space'] : ['D'];
    },
    10,
  );
}

/** Stands at `x`, raising the guard just before each shot arrives; misses every `missEvery`-th. */
function parryFrom(x: number, opts: { lead?: number; missEvery?: number; collectPlatformCell?: boolean; until?: (bot: Bot) => boolean } = {}) {
  return (bot: Bot) => {
    if (opts.collectPlatformCell) {
      // The platform is 180 px up — out of a normal jump's reach: jump, air-jump at the top, land on it.
      bot.until(() => bot.p.pos.x >= 380, () => ['D'], 6);
      bot.tick(['D', 'Space']);
      bot.until(() => bot.p.vel.y > -40, () => ['D', 'Space'], 2);
      bot.tick(['D']);
      bot.tick(['D', 'Space']);
      bot.until(() => bot.p.grounded, () => ['D', 'Space'], 2);
      bot.until(() => !bot.world.entities.some((e) => e.alive && e.kind === 'cell' && e.pos.y < 700), () => ['D'], 2);
    }
    walkTo(bot, x);
    const lead = opts.lead ?? 0.2;
    let holdUntil = -1;
    let seen = 0;
    const handled = new Set<number>();
    const done = opts.until ?? ((b: Bot) => b.completed());
    bot.until(
      () => done(bot),
      () => {
        const shot = bot.incoming(lead);
        if (shot && !handled.has(shot.id)) {
          handled.add(shot.id);
          seen++;
          if (!opts.missEvery || seen % opts.missEvery !== 0) holdUntil = bot.world.time + lead + 0.12;
        }
        return bot.world.time < holdUntil ? ['F'] : [];
      },
      90,
    );
  };
}

// ------------------------------------------------------------------ the campaign

export const CAMPAIGN_VALIDATION: LevelValidation[] = [
  {
    levelId: 'c1',
    rules: { maxTier: 0 },
    difficulty: 'introduction',
    constraints: [
      'Tier 0 primitives only (nothing unlocked yet).',
      'Starts with 40 E; two cells (+35 E each) on the way.',
      'Built-in moves: run, jump, ground dash. Nothing built-in works in the air.',
    ],
    requirements: ['Build something that adds air time or air speed, and use it once in the air.'],
    references: [
      {
        name: 'double jump (target velocity)',
        summary: 'Air jump that sets upward speed to 600 px/s; counter reset on landing.',
        mechanics: () => [doubleJumpGraph({ speed: 600 })],
        play: leapWith('Space'),
      },
      {
        name: 'double jump (fixed impulse)',
        summary: 'Air jump that adds a 650 kg·px/s impulse; used at the top of the jump.',
        mechanics: () => [doubleJumpGraph({ speed: 650, mode: 'impulse' })],
        play: leapWith('Space'),
      },
      {
        name: 'double jump used while falling',
        summary: 'The same 600 px/s air jump, pressed late, after the fall has begun.',
        mechanics: () => [doubleJumpGraph({ speed: 600 })],
        play: leapWith('Space', { airAt: 'falling' }),
      },
      {
        name: 'air dash',
        summary: 'Q in the air sets horizontal speed to 850 px/s along your facing.',
        mechanics: () => [airDashGraph(850)],
        play: leapWith('Q'),
      },
    ],
    insufficient: [690, 720, 750, 775, 790].flatMap((takeoff) =>
      [-1, 600, 660, 700, 730].map((dashAt) => ({
        name: `built-in only (take off ${takeoff}, dash ${dashAt})`,
        summary: 'Run, jump and ground dash with no mechanics.',
        mechanics: () => [],
        play: builtinAttempt(takeoff, dashAt),
      })),
    ),
  },
  {
    levelId: 'c2',
    rules: { maxTier: 1 },
    difficulty: 'moderate',
    constraints: [
      'Tier 0–1 primitives (Cross the Gap complete).',
      'Starts with 30 E; two cells (+35 E each), one on the platform.',
      'The emplacements sit across a chasm, out of reach; each has 30 HP.',
      'Each bolt carries ≈11.5 E. Reflected straight back, it deals that much damage.',
      'Dying restarts the challenge.',
    ],
    requirements: ['Raise the guard shortly before each bolt arrives (a 0.4 s window in the reference).'],
    references: [
      {
        name: 'return to sender',
        summary: 'Reflect every fresh-guarded bolt; three per emplacement.',
        mechanics: () => [returnToSenderGraph()],
        play: parryFrom(820),
      },
      {
        name: 'return to sender, missing every 4th bolt',
        summary: 'Same mechanic, imperfect timing: a quarter of the bolts land unguarded.',
        mechanics: () => [returnToSenderGraph()],
        play: parryFrom(700, { missEvery: 4 }),
      },
      {
        name: 'amplified return (with the double jump from Cross the Gap)',
        summary: 'Air-jump onto the platform for its cell; reflect ×1.5 while 20 E is affordable, plain otherwise.',
        mechanics: () => [doubleJumpGraph({ speed: 600 }), returnToSenderGraph({ amplify: 1.5 })],
        play: parryFrom(900, { collectPlatformCell: true }),
      },
    ],
    insufficient: [
      {
        name: 'guard without reflecting',
        summary: 'Blocking alone never damages the emplacements.',
        mechanics: () => {
          const b = new GraphBuilder('Guard');
          guard(b);
          return [b.build()];
        },
        play: parryFrom(820),
      },
    ],
  },
  {
    levelId: 'c3',
    rules: { maxTier: 2 },
    difficulty: 'hard',
    constraints: [
      'Tier 0–2 primitives (Return to Sender complete).',
      'The cannon’s slug carries ~400 E: lethal even through a guard.',
      'The exit opens once the cannon is gone.',
    ],
    requirements: ['A fresh guard (0.4 s) when the slug arrives.'],
    references: [
      {
        name: 'death parry',
        summary: 'Reflect + Prevent on a fresh guarded hit, then walk out.',
        mechanics: () => [deathParryGraph(0.4)],
        play: (bot) => {
          parryFrom(1150, { lead: 0.2, until: (b) => !b.world.entities.some((e) => e.alive && e.tag === 'judgement') })(bot);
          bot.until(() => bot.completed(), () => ['A'], 12);
        },
      },
    ],
    insufficient: [],
  },
];

export const VALIDATION_BY_LEVEL: Record<string, LevelValidation> = Object.fromEntries(CAMPAIGN_VALIDATION.map((v) => [v.levelId, v]));
