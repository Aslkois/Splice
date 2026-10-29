// The Law of Equivalent Exchange, expressed as data.
//
// Dimensions are kept distinct on purpose:
//   Energy (E)      — the exchangeable currency. Stored in a battery, never created from nothing.
//   Momentum (mu)   — kg * 100px/s. Converted to energy through the target's mass: E = p^2 / 2m.
//   Health (HP)     — damage. Converted from kinetic energy at impact, or bought with energy for strikes.
//   Stamina (ST)    — the body's precision/strain budget. Regenerates, but can NEVER be turned into energy.
//   Time (s)        — an opportunity cost only. Windups, channel rates and recovery spend it; nothing stores it.

export interface ExchangeTable {
  version: 1;
  energy: { capacity: number; start: number };
  stamina: { max: number; regenPerSec: number; regenDelay: number };
  power: {
    /** Max energy drawn straight from the battery per tick. Larger effects must be channelled first. */
    burstPerTick: number;
    /** Energy per second a channel can move from battery into a charge. */
    channelRate: number;
  };
  impulse: {
    efficiency: number;
    /** Linear momentum cost: keeps continuous thrust from being nearly free. */
    linearPerMu: number;
    /** Distance (px) at which remote impulses start costing more. */
    freeRange: number;
    /** Cost multiplier grows by ((d - freeRange) / rangeFalloff)^2. */
    rangeFalloff: number;
  };
  strike: { energyPerHp: number; reach: number; knockbackShare: number };
  projectile: {
    efficiency: number;
    linearPerMu: number;
    minMass: number;
    maxMass: number;
    minSpeed: number;
    lifetime: number;
  };
  /** Kinetic energy -> health conversion used by every physical impact. */
  damage: { hpPerEnergy: number };
  guard: {
    activateStamina: number;
    holdStaminaPerSec: number;
    /** Fraction of a guarded hit's damage the guard soaks up. */
    mitigation: number;
    staminaPerBlockedHp: number;
    recovery: number;
    /** Full width of the guard arc in degrees, centred on facing. */
    arcDegrees: number;
    breakStun: number;
  };
  reflect: {
    staminaBase: number;
    /** Precision cost: stamina grows with the square of how long the guard had been up when the hit landed. */
    staminaPerAgeSq: number;
    staminaPerHitEnergy: number;
    /** Energy efficiency for amplification beyond the reused impulse. */
    amplifyEfficiency: number;
    maxAmplify: number;
  };
  prevent: {
    /** Dissipating damage that was not redirected costs energy per HP. */
    energyPerHp: number;
    /** When the hit's energy already went somewhere (redirected), only a small precision fee is due. */
    afterRedirectEnergy: number;
  };
  reduce: { energyPerHp: number };
  absorb: { efficiency: number; staminaPerEnergy: number };
  charge: { interruptLoss: number; interruptThreshold: number };
  pickups: { cellEnergy: number };
}

export const DEFAULT_EXCHANGE: ExchangeTable = {
  version: 1,
  energy: { capacity: 100, start: 40 },
  stamina: { max: 100, regenPerSec: 26, regenDelay: 0.55 },
  power: { burstPerTick: 40, channelRate: 30 },
  impulse: { efficiency: 0.85, linearPerMu: 0.5, freeRange: 140, rangeFalloff: 220 },
  strike: { energyPerHp: 1.0, reach: 96, knockbackShare: 0.35 },
  projectile: { efficiency: 0.8, linearPerMu: 0.5, minMass: 0.05, maxMass: 25, minSpeed: 60, lifetime: 4 },
  damage: { hpPerEnergy: 1.0 },
  guard: {
    activateStamina: 6,
    holdStaminaPerSec: 3,
    mitigation: 0.6,
    staminaPerBlockedHp: 0.25,
    recovery: 0.2,
    arcDegrees: 200,
    breakStun: 0.5,
  },
  reflect: {
    staminaBase: 3,
    staminaPerAgeSq: 60,
    staminaPerHitEnergy: 0.01,
    amplifyEfficiency: 0.75,
    maxAmplify: 4,
  },
  prevent: { energyPerHp: 1.5, afterRedirectEnergy: 3 },
  reduce: { energyPerHp: 1.5 },
  absorb: { efficiency: 0.6, staminaPerEnergy: 0.15 },
  charge: { interruptLoss: 0.5, interruptThreshold: 4 },
  pickups: { cellEnergy: 35 },
};

export function cloneTable(t: ExchangeTable = DEFAULT_EXCHANGE): ExchangeTable {
  return JSON.parse(JSON.stringify(t)) as ExchangeTable;
}
