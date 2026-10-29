import { PHYSICS } from '../sim/config';
import {
  channelSeconds,
  effectiveWindup,
  projectileSpeedForEnergy,
  quoteImpulse,
  quoteProjectile,
  redirectCost,
  speedForEnergy,
  strikeEnergy,
  windupFactor,
} from '../sim/exchange/formulas';
import { DEFAULT_EXCHANGE, type ExchangeTable } from '../sim/exchange/table';
import { len, norm, rotate } from '../sim/math';
import { getPrimitive } from './registry';
import type { GraphNode, MechanicGraph, ParamValue, VecValue } from './schema';

/**
 * The Workshop's cost inspector: what an action will cost and whether you could run it right now,
 * computed with the same formula functions the exchange charges with, from the block's own inputs,
 * the windup in front of it, and your current state. Inputs fed by wires are evaluated when they
 * can be known in advance; otherwise the inspector says the price depends on them.
 */

export interface PlayerState {
  energy: number;
  capacity: number;
  stamina: number;
  velocity: VecValue;
  mass: number;
  facing: 1 | -1;
  charges: { name: string; amount: number; channeling: boolean; windup: number }[];
  /** Energy a dynamo in range can still give, and cells left in the level. */
  supply: { dynamoInRange: number; cellsLeft: number; cellEnergy: number };
}

export type Tone = 'ok' | 'warn' | 'bad';
export interface CostLine {
  label: string;
  value: string;
  tone?: Tone;
}
export interface CostInspection {
  heading: string;
  lines: CostLine[];
  status: { text: string; tone: Tone };
  notes: string[];
}

export const REST_STATE: PlayerState = {
  energy: DEFAULT_EXCHANGE.energy.capacity,
  capacity: DEFAULT_EXCHANGE.energy.capacity,
  stamina: DEFAULT_EXCHANGE.stamina.max,
  velocity: { x: 0, y: 0 },
  mass: 1,
  facing: 1,
  charges: [],
  supply: { dynamoInRange: 0, cellsLeft: 0, cellEnergy: DEFAULT_EXCHANGE.pickups.cellEnergy },
};

const f1 = (n: number) => (!Number.isFinite(n) ? '∞' : Math.abs(n) >= 1e5 ? n.toExponential(2) : String(Math.round(n * 10) / 10));
const fv = (v: VecValue) => `(${f1(v.x)}, ${f1(v.y)})`;

type Static = number | boolean | VecValue | null;

/** Evaluates an input when its value is knowable before running; null when it depends on the moment. */
export function staticInput(g: MechanicGraph, node: GraphNode, port: string, st: PlayerState, depth = 0): Static {
  const def = getPrimitive(node.type);
  const pdef = def?.inputs?.find((p) => p.id === port);
  const edge = g.edges.find((e) => e.to === node.id && e.toPort === port);
  if (!edge) {
    const raw: ParamValue | undefined = node.params[port] ?? pdef?.default;
    if (!pdef) return null;
    if (pdef.type === 'vector') return typeof raw === 'object' ? { x: Number(raw.x) || 0, y: Number(raw.y) || 0 } : { x: 0, y: 0 };
    if (pdef.type === 'boolean') return raw === true;
    if (pdef.type === 'entity') return null;
    return typeof raw === 'number' ? raw : Number(raw) || 0;
  }
  if (depth > 12) return null;
  const src = g.nodes.find((n) => n.id === edge.from);
  if (!src) return null;
  const n = (p: string) => staticInput(g, src, p, st, depth + 1);
  const num = (p: string) => {
    const v = n(p);
    return typeof v === 'number' ? v : null;
  };
  const vec = (p: string) => {
    const v = n(p);
    return v && typeof v === 'object' ? v : null;
  };
  switch (src.type) {
    case 'num.const':
      return num('value');
    case 'vec.make': {
      const x = num('x');
      const y = num('y');
      return x == null || y == null ? null : { x, y };
    }
    case 'vec.scale': {
      const v = vec('v');
      const s = num('s');
      return v && s != null ? { x: v.x * s, y: v.y * s } : null;
    }
    case 'vec.add': {
      const a = vec('a');
      const b = vec('b');
      return a && b ? { x: a.x + b.x, y: a.y + b.y } : null;
    }
    case 'vec.normalize': {
      const v = vec('v');
      return v ? norm(v, { x: 0, y: 0 }) : null;
    }
    case 'vec.rotate': {
      const v = vec('v');
      const d = num('deg');
      return v && d != null ? rotate(v, (d * Math.PI) / 180) : null;
    }
    case 'vec.length': {
      const v = vec('v');
      return v ? len(v) : null;
    }
    case 'vec.facing':
      return { x: st.facing, y: 0 };
    case 'res.read': {
      const r = String(src.params.resource ?? 'energy');
      return r === 'energy' ? st.energy : r === 'capacity' ? st.capacity : r === 'stamina' ? st.stamina : null;
    }
    case 'exchange.quote': {
      const e = num('energy');
      const m = num('mass');
      if (e == null || m == null) return null;
      const what = String(src.params.what ?? 'damage');
      const t = DEFAULT_EXCHANGE;
      if (what === 'damage') return Math.max(0, e) / t.strike.energyPerHp;
      if (what === 'impulse') return speedForEnergy(t, e, Math.max(0.05, m), true) * Math.max(0.05, m);
      return projectileSpeedForEnergy(t, e, Math.max(0.05, m));
    }
    case 'num.math': {
      const a = num('a');
      const b = num('b');
      if (a == null || b == null) return null;
      switch (String(src.params.op ?? '+')) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? 0 : a / b;
        case 'min':
          return Math.min(a, b);
        case 'max':
          return Math.max(a, b);
      }
      return null;
    }
    default:
      return null;
  }
}

/** The preparation and released energy in front of a block, read off the flow leading to it. */
export function preparationBefore(g: MechanicGraph, nodeId: string, st: PlayerState, t: ExchangeTable): { windup: number; known: boolean; released: number; source: string } {
  let windup = 0;
  let waited = 0;
  let released = 0;
  let known = true;
  const sources: string[] = [];
  let cur = nodeId;
  const seen = new Set<string>();
  for (let i = 0; i < 64; i++) {
    const inc = g.edges.find((e) => e.to === cur && e.toPort === 'in');
    if (!inc || seen.has(inc.from)) break;
    seen.add(inc.from);
    const n = g.nodes.find((x) => x.id === inc.from);
    if (!n) break;
    if (n.type === 'act.windUp' && inc.fromPort === 'then') {
      const s = staticInput(g, n, 'seconds', st);
      if (typeof s === 'number') {
        windup += Math.max(0, effectiveWindup(s, 0, waited));
        sources.push(`Wind Up ${f1(s)} s`);
      } else known = false;
    } else if (n.type === 'act.channelUntil' && inc.fromPort === 'charged') {
      const a = staticInput(g, n, 'amount', st);
      if (typeof a === 'number') {
        windup += Math.max(0, channelSeconds(t, a) - waited);
        released += a;
        sources.push(`channelling ${f1(a)} E (≥ ${f1(channelSeconds(t, a))} s)`);
      } else known = false;
    } else if (n.type === 'act.releaseCharge') {
      const ch = st.charges.find((c) => c.name === String(n.params.name ?? 'Shot'));
      released += ch?.amount ?? 0;
      windup += ch ? Math.max(0, ch.windup - waited) : 0;
      sources.push(`charge “${String(n.params.name ?? 'Shot')}”`);
    } else if (n.type === 'flow.delay') {
      const s = staticInput(g, n, 'seconds', st);
      if (typeof s === 'number') waited += s;
    }
    cur = n.id;
  }
  return { windup, known, released, source: sources.join(' + ') };
}

export function inspectCost(g: MechanicGraph, nodeId: string, st: PlayerState = REST_STATE, t: ExchangeTable = DEFAULT_EXCHANGE): CostInspection | null {
  const node = g.nodes.find((n) => n.id === nodeId);
  const def = node && getPrimitive(node.type);
  if (!node || !def || !def.execIn) return null;
  const onSelf = !g.edges.some((e) => e.to === node.id && e.toPort === 'target') && (node.params.target ?? 'self') === 'self';
  const prep = preparationBefore(g, node.id, st, t);
  const lines: CostLine[] = [];
  const notes: string[] = [];
  let base: number | null = null;
  let stamina = 0;
  let heading = def.label;
  let discount = true;

  switch (node.type) {
    case 'act.impulse':
    case 'act.force':
    case 'act.setVelocity': {
      let j: VecValue | null = null;
      if (node.type === 'act.impulse') j = staticInput(g, node, 'impulse', st) as VecValue | null;
      else if (node.type === 'act.force') {
        const f = staticInput(g, node, 'force', st) as VecValue | null;
        j = f ? { x: f.x / 60, y: f.y / 60 } : null;
      } else {
        const want = staticInput(g, node, 'velocity', st) as VecValue | null;
        const axes = String(node.params.axes ?? 'both');
        if (want && onSelf) {
          const v = st.velocity;
          j = { x: axes === 'y' ? 0 : (want.x - v.x) * st.mass, y: axes === 'x' ? 0 : (want.y - v.y) * st.mass };
          lines.push({ label: 'Target velocity', value: `${fv({ x: axes === 'y' ? v.x : want.x, y: axes === 'x' ? v.y : want.y })} px/s` });
        }
      }
      if (!onSelf) {
        notes.push('Pushing another body: the price depends on its mass, speed and distance when it runs (×1/0.85, more beyond 140 px).');
        break;
      }
      if (!j) break;
      heading = Math.abs(j.y) > Math.abs(j.x) ? (j.y < 0 ? 'Upward push' : 'Downward push') : 'Sideways push';
      const now = quoteImpulse(t, { mass: st.mass, velocity: st.velocity, impulse: j, self: true, distance: 0, maxSpeed: PHYSICS.maxBodySpeed });
      const rest = quoteImpulse(t, { mass: st.mass, velocity: { x: 0, y: 0 }, impulse: j, self: true, distance: 0, maxSpeed: PHYSICS.maxBodySpeed });
      lines.push({ label: 'Requested impulse', value: `${fv(j)} kg·px/s` });
      lines.push({ label: 'Velocity change', value: `${f1(now.deltaV)} px/s` });
      lines.push({ label: 'Your velocity now', value: `${fv(st.velocity)} px/s` });
      lines.push({ label: 'Kinetic energy gained', value: `${f1(now.deltaKE)} E` });
      lines.push({ label: 'Momentum term', value: `${f1(t.impulse.linearPerMu * now.momentum)} E` });
      lines.push({ label: 'From a standstill it would be', value: `${f1(rest.energy)} E` });
      base = now.energy;
      if (node.type === 'act.force') notes.push('Runs for one tick; each run is priced on what it adds.');
      break;
    }
    case 'act.projectile': {
      const speed = staticInput(g, node, 'speed', st);
      const mass = staticInput(g, node, 'mass', st);
      if (typeof speed !== 'number' || typeof mass !== 'number') break;
      const s = Math.min(Math.max(speed, t.projectile.minSpeed), PHYSICS.maxProjectileSpeed);
      const m = Math.min(Math.max(mass, t.projectile.minMass), t.projectile.maxMass);
      const q = quoteProjectile(t, s, m);
      lines.push({ label: 'Speed', value: `${f1(s)} px/s` });
      lines.push({ label: 'Mass', value: `${f1(m)} kg` });
      lines.push({ label: 'Damage on impact (its kinetic energy)', value: `${f1(q.damage)} HP` });
      base = q.energy;
      break;
    }
    case 'act.strike': {
      const a = staticInput(g, node, 'amount', st);
      if (typeof a !== 'number') break;
      lines.push({ label: 'Damage', value: `${f1(a)} HP` });
      base = strikeEnergy(t, a);
      break;
    }
    case 'act.consume': {
      const a = staticInput(g, node, 'amount', st);
      if (typeof a !== 'number') break;
      discount = false;
      if (String(node.params.resource ?? 'energy') === 'stamina') {
        stamina = Math.max(0, a);
        base = 0;
      } else base = Math.max(0, a);
      notes.push('A payment, not a conversion: windup never discounts it.');
      break;
    }
    case 'act.reflect':
    case 'act.redirect': {
      const amp = staticInput(g, node, 'amplify', st);
      const ampN = typeof amp === 'number' ? Math.max(1, amp) : 1;
      const typical = redirectCost(t, 0.15, 11.6, 11.6, ampN);
      lines.push({ label: 'Stamina', value: `3 + 60·(guard age)² + 0.01·hit energy — ${f1(typical.stamina)} for a turret bolt with a 0.15 s guard` });
      if (ampN > 1) lines.push({ label: 'Amplification', value: `${f1((ampN * ampN - 1) / t.reflect.amplifyEfficiency)} × the hit’s energy in E` });
      notes.push('Priced from the hit when it arrives; only works while a hit is open and your guard caught it.');
      stamina = typical.stamina;
      base = typical.energy;
      break;
    }
    case 'act.prevent':
      notes.push(`${t.prevent.afterRedirectEnergy} E if the hit’s force was already redirected; otherwise ${t.prevent.energyPerHp} E per HP it would deal.`);
      break;
    case 'act.reduce':
      notes.push(`${t.reduce.energyPerHp} E per HP removed, at most what the hit would deal.`);
      break;
    case 'act.absorb':
      notes.push(`Gains ${Math.round(t.absorb.efficiency * 100)}% of the absorbed energy; ${t.absorb.staminaPerEnergy} stamina per E absorbed.`);
      break;
    case 'act.block':
      lines.push({ label: 'Stamina', value: `${t.guard.activateStamina} to raise, ${t.guard.holdStaminaPerSec}/s while up` });
      stamina = t.guard.activateStamina;
      base = 0;
      break;
    case 'act.windUp': {
      const s = staticInput(g, node, 'seconds', st);
      if (typeof s === 'number') {
        lines.push({ label: 'Preparation', value: `${f1(s)} s` });
        lines.push({ label: 'Energy prices after it', value: `×${windupFactor(t, s).toFixed(2)}` });
      }
      notes.push(`Interrupted by a hit of ${t.charge.interruptThreshold}+ damage. You move at 55% speed meanwhile. Creates no energy.`);
      return { heading: 'Windup', lines, status: { text: 'Free — time passes', tone: 'ok' }, notes };
    }
    case 'act.channelUntil':
    case 'act.beginCharge': {
      const a = node.type === 'act.channelUntil' ? staticInput(g, node, 'amount', st) : null;
      const name = String(node.params.name ?? '');
      const ch = st.charges.find((c) => c.name === name);
      lines.push({ label: 'Channel rate', value: `${t.power.channelRate} E/s` });
      lines.push({ label: 'Your reservoir', value: `${f1(st.energy)} / ${f1(st.capacity)} E` });
      lines.push({ label: `Already in “${name}”`, value: `${f1(ch?.amount ?? 0)} E${ch ? (ch.channeling ? ' (channelling)' : ' (held)') : ''}` });
      const supply = st.supply.dynamoInRange + st.supply.cellsLeft * st.supply.cellEnergy;
      lines.push({ label: 'Supply you could still draw on', value: supply > 0 ? `${f1(supply)} E (dynamo in range ${f1(st.supply.dynamoInRange)}, cells ${st.supply.cellsLeft})` : 'none nearby' });
      if (typeof a === 'number') {
        const have = st.energy + (ch?.amount ?? 0);
        const remaining = Math.max(0, a - have);
        lines.push({ label: 'Target', value: `${f1(a)} E` });
        lines.push({ label: 'Remaining beyond what you hold', value: `${f1(remaining)} E`, tone: remaining > 0 ? (remaining > supply ? 'bad' : 'warn') : 'ok' });
        lines.push({ label: 'Channelling time', value: `≥ ${f1(channelSeconds(t, Math.max(0, a - (ch?.amount ?? 0))))} s` });
        notes.push(`A hit of ${t.charge.interruptThreshold}+ damage interrupts it and scatters ${Math.round(t.charge.interruptLoss * 100)}% of the charge.`);
        const status: CostInspection['status'] =
          remaining <= 0 ? { text: 'Ready to channel', tone: 'ok' } : remaining <= supply ? { text: 'Needs energy from the supply nearby', tone: 'warn' } : { text: 'Not enough energy anywhere in reach', tone: 'bad' };
        return { heading: 'Charging', lines, status, notes };
      }
      return { heading: 'Charging', lines, status: { text: 'Moves energy; spends none', tone: 'ok' }, notes };
    }
    default:
      return null;
  }

  if (base == null) {
    return { heading, lines, status: { text: 'Price depends on values worked out when it runs', tone: 'warn' }, notes };
  }
  const factor = discount ? windupFactor(t, prep.windup) : 1;
  const effective = base * factor;
  lines.push({ label: 'Base energy requirement', value: `${f1(base)} E` });
  if (discount && (prep.windup > 0 || prep.source)) {
    lines.push({ label: 'Windup before it', value: prep.source ? `${f1(prep.windup)} s (${prep.source})` : `${f1(prep.windup)} s` });
    lines.push({ label: 'Windup adjustment', value: `×${factor.toFixed(2)}` });
  }
  lines.push({ label: 'Effective energy requirement', value: `${f1(effective)} E` });
  if (stamina > 0) lines.push({ label: 'Stamina', value: `${f1(stamina)} (you have ${f1(st.stamina)})`, tone: stamina > st.stamina ? 'bad' : undefined });
  const available = st.energy + prep.released;
  lines.push({ label: 'Available energy', value: prep.released > 0 ? `${f1(available)} E (${f1(prep.released)} released + ${f1(st.energy)} reservoir)` : `${f1(st.energy)} E in your reservoir` });
  const committed = st.charges.reduce((s, c) => s + c.amount, 0);
  if (committed > 0) lines.push({ label: 'Committed in charges', value: `${f1(committed)} E` });
  const short = effective - available;
  if (!prep.known) notes.push('Some of the preparation in front of it depends on values worked out when it runs.');
  let status: CostInspection['status'];
  if (stamina > st.stamina + 1e-9) status = { text: 'Insufficient stamina right now', tone: 'bad' };
  else if (short <= 1e-9) status = { text: 'Ready', tone: 'ok' };
  else if (effective > st.capacity && prep.released === 0) status = { text: `Needs ${f1(effective)} E — more than your reservoir holds. Commit it to a charge first.`, tone: 'bad' };
  else status = { text: `Insufficient energy right now (short ${f1(short)} E)`, tone: 'warn' };
  return { heading, lines, status, notes };
}
