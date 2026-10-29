import { DT, PHYSICS } from '../sim/config';
import { channelSeconds, quoteImpulse, quoteProjectile, redirectCost, strikeEnergy, windupFactor } from '../sim/exchange/formulas';
import { DEFAULT_EXCHANGE, type ExchangeTable } from '../sim/exchange/table';
import type { GraphNode, VecValue } from './schema';

/**
 * A plain-language price tag for an action block, computed with the same functions the exchange
 * charges with (src/sim/exchange/formulas.ts). Shown on the block so players can see what a number
 * they type will cost. Exact prices depend on the moment (your speed, preparation) — the debugger
 * shows those.
 */
export function previewCost(node: GraphNode, wired: (port: string) => boolean, t: ExchangeTable = DEFAULT_EXCHANGE): string | null {
  const num = (k: string, d: number) => (typeof node.params[k] === 'number' ? (node.params[k] as number) : d);
  const vec = (k: string, d: VecValue): VecValue => {
    const v = node.params[k];
    return v && typeof v === 'object' ? (v as VecValue) : d;
  };
  const fmt = (n: number) => (n >= 1e5 ? n.toExponential(1) : n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString());
  const fromRest = (j: VecValue, mass: number, self: boolean) =>
    quoteImpulse(t, { mass, velocity: { x: 0, y: 0 }, impulse: j, self, distance: 0, maxSpeed: PHYSICS.maxBodySpeed });
  const reservoir = (e: number) => (e > t.energy.capacity ? ` — more than a full reservoir (${t.energy.capacity} E): commit it to a charge first` : '');
  const onSelf = !wired('target') && (node.params.target ?? 'self') === 'self';

  switch (node.type) {
    case 'act.impulse': {
      if (wired('impulse')) return 'Price depends on the impulse you feed it.';
      const v = vec('impulse', { x: 0, y: -650 });
      if (!onSelf) return `≈ ${fmt(fromRest(v, 2, false).energy)} E on a resting 2 kg crate up close; more at range.`;
      const q = fromRest(v, 1, true);
      const cancel = t.impulse.linearPerMu * q.momentum;
      return `≈ ${fmt(q.energy)} E from a standstill${reservoir(q.energy)}. You pay for speed gained: more if already moving that way, as little as ${fmt(cancel)} E if it only cancels motion.`;
    }
    case 'act.force': {
      if (wired('force')) return 'Price depends on the force you feed it.';
      const f = vec('force', { x: 0, y: -2600 });
      const mass = onSelf ? 1 : 2;
      // One second of continuous use from rest, gravity aside: the per-tick prices add up to the same as one push.
      const q = fromRest({ x: f.x * DT * 60, y: f.y * DT * 60 }, mass, onSelf);
      return `One tick per run. Kept up for 1 s from rest ≈ ${fmt(q.energy)} E${onSelf ? ' on you' : ''} (same as one push of that size).`;
    }
    case 'act.setVelocity':
      return 'Billed as the push needed to reach that velocity: cheap when it slows you, dear when it speeds you up.';
    case 'act.projectile': {
      if (wired('speed') || wired('mass')) return 'Price depends on the speed and mass you feed it.';
      const s = Math.min(Math.max(num('speed', 900), t.projectile.minSpeed), PHYSICS.maxProjectileSpeed);
      const m = Math.min(Math.max(num('mass', 0.3), t.projectile.minMass), t.projectile.maxMass);
      const q = quoteProjectile(t, s, m);
      return `≈ ${fmt(q.energy)} E for a shot that hits for ${fmt(q.damage)}${reservoir(q.energy)}.`;
    }
    case 'act.strike': {
      if (wired('amount')) return `${t.strike.energyPerHp} E per point of damage you feed it.`;
      const e = strikeEnergy(t, num('amount', 10));
      return `${fmt(e)} E per strike${reservoir(e)}.`;
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
      return amp > 1 ? `${base}, plus ${fmt(redirectCost(t, 0, 1, 1, amp).energy)}× the hit's energy in E.` : `${base}.`;
    }
    case 'act.prevent':
      return `${t.prevent.afterRedirectEnergy} E if you already redirected the hit; otherwise ${t.prevent.energyPerHp} E per point of damage.`;
    case 'act.reduce':
      return wired('amount') ? `${t.reduce.energyPerHp} E per point removed.` : `Up to ${fmt(num('amount', 10) * t.reduce.energyPerHp)} E.`;
    case 'act.absorb':
      return `Stores ${Math.round(t.absorb.efficiency * 100)}% of the hit's energy; ${t.absorb.staminaPerEnergy} stamina per E taken in.`;
    case 'act.channelUntil':
      return wired('amount')
        ? `Channels at ${t.power.channelRate} E/s.`
        : `At least ${fmt(channelSeconds(t, num('amount', 60)))} s of channelling at ${t.power.channelRate} E/s (longer if your reservoir runs dry).`;
    case 'act.beginCharge':
      return `Moves up to ${t.power.channelRate} E/s from your reservoir into the charge.`;
    case 'act.windUp':
      return wired('seconds') ? 'Makes the effects after it cheaper.' : `Effects after it cost ×${fmt(windupFactor(t, num('seconds', 1)))} energy.`;
    default:
      return null;
  }
}
