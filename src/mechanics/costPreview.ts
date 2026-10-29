import { DEFAULT_EXCHANGE, type ExchangeTable } from '../sim/exchange/table';
import { V_UNIT } from '../sim/config';
import type { GraphNode, VecValue } from './schema';

/**
 * A plain-language price tag for an action block, computed from the same exchange table the
 * simulation uses. Shown on the block so players can see what a number they type will cost.
 */
export function previewCost(node: GraphNode, wired: (port: string) => boolean, t: ExchangeTable = DEFAULT_EXCHANGE): string | null {
  const num = (k: string, d: number) => (typeof node.params[k] === 'number' ? (node.params[k] as number) : d);
  const vec = (k: string, d: VecValue): VecValue => {
    const v = node.params[k];
    return v && typeof v === 'object' ? (v as VecValue) : d;
  };
  const fmt = (n: number) => (n >= 1e5 ? n.toExponential(1) : n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString());
  const impulseE = (j: number, m: number) => {
    const p = j / V_UNIT;
    return (t.impulse.linearPerMu * p + (p * p) / (2 * m)) / t.impulse.efficiency;
  };
  const instant = (e: number) => (e > t.power.burstPerTick ? ` — over the ${t.power.burstPerTick} E instant limit, so it needs a released charge` : '');
  const onSelf = !wired('target') && (node.params.target ?? 'self') === 'self';

  switch (node.type) {
    case 'act.impulse': {
      if (wired('impulse')) return 'Price depends on the impulse you feed it.';
      const v = vec('impulse', { x: 0, y: -650 });
      const j = Math.hypot(v.x, v.y);
      if (!onSelf) return `≈ ${fmt(impulseE(j, 2))} E on a 2 kg crate up close; less on heavier things, more at range.`;
      const e = impulseE(j, 1);
      return `≈ ${fmt(e)} E each time, on you${instant(e)}.`;
    }
    case 'act.force': {
      if (wired('force')) return 'Price depends on the force you feed it.';
      const v = vec('force', { x: 0, y: -2600 });
      const perTick = impulseE(Math.hypot(v.x, v.y) / 60, onSelf ? 1 : 2);
      return `≈ ${fmt(perTick * 60)} E per second while it keeps running${onSelf ? ', on you' : ''}.`;
    }
    case 'act.setVelocity':
      return 'Billed as the impulse needed: the faster you already move the wrong way, the more it costs.';
    case 'act.projectile': {
      if (wired('speed') || wired('mass')) return 'Price depends on the speed and mass you feed it.';
      const s = Math.min(Math.max(num('speed', 900), t.projectile.minSpeed), 3200) / V_UNIT;
      const m = Math.min(Math.max(num('mass', 0.3), t.projectile.minMass), t.projectile.maxMass);
      const ke = 0.5 * m * s * s;
      const e = (ke + t.projectile.linearPerMu * m * s) / t.projectile.efficiency;
      return `≈ ${fmt(e)} E for a shot that hits for ${fmt(ke * t.damage.hpPerEnergy)}${instant(e)}.`;
    }
    case 'act.strike': {
      if (wired('amount')) return `${t.strike.energyPerHp} E per point of damage you feed it.`;
      const e = num('amount', 10) * t.strike.energyPerHp;
      return `${fmt(e)} E per strike${instant(e)}.`;
    }
    case 'act.consume':
      return wired('amount') ? null : `Spends ${fmt(num('amount', 10))} ${node.params.resource === 'stamina' ? 'stamina' : 'E'}.`;
    case 'act.block':
      return `${t.guard.activateStamina} stamina to raise, ${t.guard.holdStaminaPerSec}/s to hold.`;
    case 'act.reflect':
    case 'act.redirect': {
      const amp = wired('amplify') ? null : num('amplify', 1);
      const base = `${t.reflect.staminaBase}+ stamina, growing with how long your guard was up`;
      if (amp === null) return `${base}; amplifying costs energy.`;
      return amp > 1 ? `${base}, plus ${fmt((amp * amp - 1) / t.reflect.amplifyEfficiency)}× the hit's energy in E.` : `${base}.`;
    }
    case 'act.prevent':
      return `${t.prevent.afterRedirectEnergy} E if you already redirected the hit; otherwise ${t.prevent.energyPerHp} E per point of damage.`;
    case 'act.reduce':
      return wired('amount') ? `${t.reduce.energyPerHp} E per point removed.` : `Up to ${fmt(num('amount', 10) * t.reduce.energyPerHp)} E.`;
    case 'act.absorb':
      return `Stores ${Math.round(t.absorb.efficiency * 100)}% of the hit's energy; ${t.absorb.staminaPerEnergy} stamina per E taken in.`;
    case 'act.channelUntil':
      return wired('amount') ? `Channels at ${t.power.channelRate} E/s.` : `About ${fmt(num('amount', 60) / t.power.channelRate)} s of channelling at ${t.power.channelRate} E/s.`;
    case 'act.beginCharge':
      return `Moves up to ${t.power.channelRate} E/s from your battery into the charge.`;
    default:
      return null;
  }
}
