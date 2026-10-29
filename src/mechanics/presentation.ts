import { getPrimitive, PRIMITIVES } from './registry';
import type { PrimitiveDef } from './types';

/**
 * How each primitive is drawn by the two editors. Behaviour lives in the registry; this file only
 * says how a block reads and which of its flow outputs become C-block mouths in Scratch Blocks.
 *
 * Scratch text templates: plain words plus {p:paramId} (a dropdown/text field) and {i:inputId}
 * (an input slot). Every param and every input appears exactly once (checked by tests), so nothing
 * is uneditable in either editor.
 */

export interface MouthSpec {
  port: string;
  /** Words printed on the arm above this mouth (the first mouth uses the header line). */
  label: string;
}

export type ScratchKind = 'hat' | 'stack' | 'c' | 'cap' | 'reporter' | 'boolean';

export interface ScratchSpec {
  text: string;
  kind: ScratchKind;
  /**
   * The flow output that continues to the block drawn underneath. null for blocks whose mouths are
   * the only way on (if/else, cooldown, toggle) or that end a stack (sequence).
   */
  continuation: string | null;
  /**
   * Exactly one mouth runs. Blocks attached underneath run after whichever mouth ran: in the model,
   * the end of every mouth is wired to the block below (a "join").
   */
  choice: boolean;
  mouths: MouthSpec[];
  /** Mouths drawn only when something is in them (or the player adds them). */
  optionalMouths: string[];
}

export interface Presentation {
  scratch: ScratchSpec;
  /** Title used by Blueprint Blocks when it differs from the registry label. */
  blueprintTitle?: string;
  /** Extra words the block search matches (old names, synonyms). */
  aliases: string[];
}

type Spec = {
  s: string;
  mouths?: MouthSpec[];
  cont?: string | null;
  choice?: boolean;
  optional?: string[];
  bp?: string;
  aka?: string[];
};

const TRY = (s: string, aka: string[] = []): Spec => ({ s, mouths: [{ port: 'failed', label: 'if it fails' }], optional: ['failed'], aka });

const SPECS: Record<string, Spec> = {
  // ---- events (hats)
  'on.keyPressed': { s: 'when {p:key} key pressed', aka: ['key down', 'press'] },
  'on.keyReleased': { s: 'when {p:key} key released', aka: ['key up', 'release'] },
  'on.keyHeld': { s: 'every tick while {p:key} key is held', aka: ['hold', 'held'] },
  'on.tick': { s: 'every tick', aka: ['forever', 'update', 'loop'] },
  'on.landing': { s: 'when I land', aka: ['ground', 'fall'] },
  'on.collision': { s: 'when I bump into {p:filter}', aka: ['touch', 'touching', 'contact'] },
  'on.incomingHit': { s: 'when a hit is incoming (before damage)', aka: ['damage incoming', 'pre-hit', 'attacked'] },
  'on.successfulBlock': { s: 'when a hit meets my raised guard (before damage)', aka: ['successful block', 'blocked', 'parry'] },
  'on.hitResolved': { s: 'when a hit has landed (after damage)', aka: ['post-hit', 'after hit', 'blocked'] },
  'on.damageTaken': { s: 'when I take damage', aka: ['hurt', 'health lost'] },
  'on.timerElapsed': { s: 'when timer {p:name} ({p:scope}) runs out', aka: ['timer done', 'alarm'] },
  'on.entityDestroyed': { s: 'when {p:filter} is destroyed', aka: ['killed', 'broken'] },
  'on.signal': { s: 'when I receive signal {p:name}', aka: ['broadcast', 'message', 'receive'] },
  'on.chargeInterrupted': { s: 'when my charging is interrupted', aka: ['interrupt'] },

  // ---- control
  'flow.if': { s: 'if {i:cond} then', mouths: [{ port: 'then', label: '' }, { port: 'else', label: 'else' }], cont: null, choice: true, bp: 'Branch', aka: ['branch', 'else', 'condition'] },
  'flow.sequence': {
    s: 'do in order, first:',
    mouths: [
      { port: 'a', label: '' },
      { port: 'b', label: 'second:' },
      { port: 'c', label: 'third:' },
    ],
    cont: null,
    aka: ['sequence', 'order', 'then'],
  },
  'flow.delay': { s: 'wait {i:seconds} seconds', aka: ['delay', 'sleep', 'pause'] },
  'flow.cooldown': {
    s: 'if not cooling down (at most every {i:seconds} s) then',
    mouths: [{ port: 'pass', label: '' }, { port: 'blocked', label: 'else (still cooling down)' }],
    cont: null,
    choice: true,
    aka: ['cooldown', 'throttle', 'rate limit'],
  },
  'flow.toggle': {
    s: 'alternate: on the 1st, 3rd, 5th… run',
    mouths: [{ port: 'a', label: '' }, { port: 'b', label: 'on the 2nd, 4th, 6th… run' }],
    cont: null,
    choice: true,
    aka: ['flip flop', 'switch', 'toggle'],
  },
  'flow.repeat': { s: 'repeat {i:count} times instantly', mouths: [{ port: 'body', label: '' }], cont: 'done', aka: ['loop', 'for', 'repeat'] },
  'flow.emit': { s: 'send signal {p:name} with value {i:value}', aka: ['broadcast', 'message', 'emit'] },

  // ---- conditions (boolean reporters)
  'logic.compare': { s: '{i:a} {p:op} {i:b}', aka: ['less', 'greater', 'equals', '<', '>', '='] },
  'logic.and': { s: '{i:a} and {i:b}' },
  'logic.or': { s: '{i:a} or {i:b}' },
  'logic.not': { s: 'not {i:a}' },
  'state.grounded': { s: 'on the ground?', aka: ['grounded', 'standing'] },
  'state.keyHeld': { s: 'key {p:key} held?', aka: ['key pressed?', 'pressed'] },
  'state.check': { s: '{i:target} {p:state}?', aka: ['blocking', 'guarding', 'dashing', 'state'] },
  'res.canAfford': { s: 'have at least {i:amount} {p:resource}?', aka: ['enough', 'energy', 'stamina'] },
  'entity.exists': { s: '{i:target} exists?', aka: ['alive', 'valid'] },
  'entity.within': { s: '{i:target} within {i:distance} px?', aka: ['near', 'distance', 'range'] },
  'vec.isFacing': { s: '{i:dir} is within {i:angle}° of my facing?', aka: ['facing', 'direction', 'front'] },

  // ---- values (reporters)
  'num.const': { s: 'number {i:value}', aka: ['constant', 'value'] },
  'num.math': { s: '{i:a} {p:op} {i:b}', aka: ['add', 'subtract', 'multiply', 'divide', 'plus', 'minus', 'min', 'max'] },
  'num.clamp': { s: 'clamp {i:value} between {i:min} and {i:max}', aka: ['limit', 'bound'] },
  'num.random': { s: 'random number from {i:min} to {i:max}', aka: ['pick random', 'chance'] },
  'time.now': { s: 'world time', aka: ['clock', 'seconds'] },
  'vec.make': { s: 'vector x {i:x} y {i:y}', aka: ['direction', 'point'] },
  'vec.break': { s: '{o} of {i:v}', aka: ['x of', 'y of', 'split'] },
  'vec.add': { s: '{i:a} + {i:b}', aka: ['sum', 'vector add'] },
  'vec.scale': { s: '{i:v} × {i:s}', aka: ['multiply', 'times', 'scale'] },
  'vec.normalize': { s: 'direction of {i:v}', aka: ['unit', 'normalize'] },
  'vec.length': { s: 'length of {i:v}', aka: ['magnitude', 'size'] },
  'vec.rotate': { s: 'rotate {i:v} by {i:deg}°', aka: ['turn', 'angle'] },
  'vec.facing': { s: 'my facing direction', aka: ['forward', 'facing'] },
  'vec.moveInput': { s: 'direction I am holding', aka: ['input', 'joystick', 'wasd'] },
  'vec.aim': { s: 'direction to the cursor', aka: ['mouse', 'aim', 'pointer'] },
  'entity.self': { s: 'me', aka: ['self', 'player', 'myself'] },
  'entity.nearest': { s: 'nearest {p:filter} within {i:radius} px', aka: ['closest', 'find', 'target'] },
  'entity.position': { s: 'position of {i:target}', aka: ['location', 'x y'] },
  'entity.velocity': { s: 'velocity of {i:target}', aka: ['speed', 'motion'] },
  'entity.directionTo': { s: 'direction to {i:target}', aka: ['towards', 'point at'] },
  'entity.distanceTo': { s: 'distance to {i:target}', aka: ['range', 'how far'] },
  'entity.health': { s: 'health of {i:target}', aka: ['hp', 'life'] },
  'res.read': { s: 'my {p:resource}', aka: ['energy', 'stamina', 'health', 'battery'] },
  'res.charge': { s: 'energy stored in charge {p:name}', aka: ['charge amount', 'stored'] },
  'exchange.quote': { s: '{p:what} that {i:energy} E buys (mass {i:mass} kg)', aka: ['price', 'convert', 'quote'] },

  // ---- variables & timers
  'var.getNumber': { s: 'number {p:name} ({p:scope})', aka: ['variable', 'get'] },
  'var.setNumber': { s: 'set number {p:name} ({p:scope}) to {i:value}', aka: ['variable', 'set'] },
  'var.addNumber': { s: 'change number {p:name} ({p:scope}) by {i:value}', aka: ['increment', 'change by', 'add'] },
  'var.getFlag': { s: 'flag {p:name} ({p:scope})', aka: ['boolean variable', 'get'] },
  'var.setFlag': { s: 'set flag {p:name} ({p:scope}) to {i:value}', aka: ['boolean variable', 'set'] },
  'var.getVector': { s: 'vector {p:name} ({p:scope})', aka: ['vector variable'] },
  'var.setVector': { s: 'set vector {p:name} ({p:scope}) to {i:value}', aka: ['vector variable'] },
  'var.getEntity': { s: 'remembered {p:name} ({p:scope})', aka: ['entity variable', 'recall'] },
  'var.setEntity': { s: 'remember {i:value} as {p:name} ({p:scope})', aka: ['entity variable', 'store'] },
  'timer.reset': { s: 'reset timer {p:name} ({p:scope}) to 0', aka: ['restart', 'stopwatch'] },
  'timer.start': { s: 'start timer {p:name} ({p:scope}) for {i:duration} s', aka: ['countdown', 'alarm'] },
  'timer.stop': { s: 'stop timer {p:name} ({p:scope})', aka: ['cancel timer'] },
  'timer.value': { s: 'timer {p:name} ({p:scope})', aka: ['elapsed', 'stopwatch', 'seconds since'] },

  // ---- actions (most can fail: "try to …")
  'act.impulse': TRY('try to push {i:target} with impulse {i:impulse}', ['jump', 'launch', 'knockback', 'dash']),
  'act.force': TRY('try to push {i:target} with force {i:force} for one tick', ['thrust', 'jetpack', 'apply force']),
  'act.setVelocity': TRY('try to set velocity of {i:target} to {i:velocity} ({p:axes})', ['speed', 'modify velocity', 'stop']),
  'act.consume': TRY('try to spend {i:amount} {p:resource}', ['cost', 'pay', 'consume']),
  'act.block': TRY('try to raise my guard', ['activate block', 'block', 'shield', 'defend']),
  'act.unblock': { s: 'lower my guard', aka: ['deactivate block', 'unblock', 'stop blocking'] },
  'act.projectile': TRY('try to fire a projectile toward {i:dir} at {i:speed} px/s, mass {i:mass} kg', ['shoot', 'bullet', 'spawn projectile']),
  'act.strike': TRY('try to deal {i:amount} damage to {i:target}', ['attack', 'hit', 'melee', 'deal damage']),
  'act.reflect': TRY('try to reflect the incoming force ×{i:amplify}', ['parry', 'reflect', 'return']),
  'act.redirect': TRY('try to redirect the incoming force toward {i:dir} ×{i:amplify}', ['redirect force', 'deflect']),
  'act.prevent': TRY('try to prevent the incoming damage', ['cancel damage', 'negate', 'invulnerable']),
  'act.reduce': TRY('try to reduce the incoming damage by {i:amount}', ['mitigate', 'armor']),
  'act.absorb': TRY('try to absorb the incoming energy', ['harvest', 'recharge', 'accumulate resource']),
  'act.beginCharge': { s: 'start charging {p:name}', aka: ['accumulate resource', 'windup', 'channel'] },
  'act.holdCharge': { s: 'stop charging {p:name} (keep what is stored)', aka: ['pause charge'] },
  'act.releaseCharge': { s: 'release charge {p:name} into this script', aka: ['unleash', 'spend charge'] },
  'act.channelUntil': {
    s: 'charge {p:name} until it holds {i:amount} E, then continue',
    mouths: [{ port: 'interrupted', label: 'if interrupted' }],
    cont: 'charged',
    optional: [],
    aka: ['windup', 'wait for charge'],
  },
  'act.setFacing': { s: 'face {p:mode}', aka: ['turn', 'flip', 'change state'] },
  'fx.sound': { s: 'play sound {p:sound} at pitch {i:pitch}', aka: ['audio', 'noise'] },
};

function kindOf(def: PrimitiveDef, spec: Spec): ScratchKind {
  if (def.event) return 'hat';
  if (!def.execIn) return def.outputs?.[0]?.type === 'boolean' ? 'boolean' : 'reporter';
  const hasMouths = (spec.mouths?.length ?? 0) > 0 && (spec.mouths ?? []).some((m) => !(spec.optional ?? []).includes(m.port));
  const cont = spec.cont === undefined ? 'then' : spec.cont;
  if (cont === null && !spec.choice) return 'cap';
  return hasMouths ? 'c' : 'stack';
}

const BY_TYPE = new Map<string, Presentation>();

function build(def: PrimitiveDef): Presentation {
  const spec = SPECS[def.type];
  if (!spec) throw new Error(`no presentation for ${def.type}`);
  const execOuts = def.execOut?.map((e) => e.id) ?? [];
  const continuation = def.execIn || def.event ? (spec.cont === undefined ? (execOuts.includes('then') ? 'then' : (execOuts[0] ?? null)) : spec.cont) : null;
  return {
    scratch: {
      text: spec.s,
      kind: kindOf(def, spec),
      continuation,
      choice: !!spec.choice,
      mouths: spec.mouths ?? [],
      optionalMouths: spec.optional ?? [],
    },
    blueprintTitle: spec.bp,
    aliases: spec.aka ?? [],
  };
}

export function presentationOf(type: string): Presentation {
  let p = BY_TYPE.get(type);
  if (!p) {
    const def = getPrimitive(type);
    if (!def) throw new Error(`unknown block ${type}`);
    p = build(def);
    BY_TYPE.set(type, p);
  }
  return p;
}

export function hasPresentation(type: string): boolean {
  return type in SPECS;
}

/** Every primitive has a spec — enforced by tests so new blocks can't ship half-presented. */
export function missingPresentations(): string[] {
  return PRIMITIVES.filter((p) => !(p.type in SPECS)).map((p) => p.type);
}

export type TemplatePart = { kind: 'text'; text: string } | { kind: 'param'; id: string } | { kind: 'input'; id: string } | { kind: 'outputPick' };

export function parseTemplate(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const re = /\{(p|i):([a-zA-Z0-9_]+)\}|\{o\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[0] === '{o}') parts.push({ kind: 'outputPick' });
    else parts.push(m[1] === 'p' ? { kind: 'param', id: m[2] } : { kind: 'input', id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts.filter((p) => p.kind !== 'text' || p.text.trim().length > 0);
}
