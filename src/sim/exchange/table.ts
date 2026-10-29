// The Law of Equivalent Exchange, expressed as data.
//
// Dimensions are kept distinct on purpose:
//   Energy (E)      — the exchangeable currency. Stored in a battery, never created from nothing.
//   Momentum (mu)   — kg * 100px/s. Converted to energy through the target's mass: E = p^2 / 2m.
//   Health (HP)     — damage. Converted from kinetic energy at impact, or bought with energy for strikes.
//   Stamina (ST)    — the body's precision/strain budget. Regenerates, but can NEVER be turned into energy.
//   Time (s)        — an opportunity cost only. Windups, channel rates and recovery spend it; nothing stores it.
//
// There is no cap on how much an effect may cost. An effect is paid in full at the moment it happens,
// from energy released out of charges first, then from the battery (the reservoir). Anything bigger
// than the reservoir has to be committed to a charge over time from real sources first.

export interface ExchangeTable {
  version: 2;
  /** The reservoir: energy held at one instant. */
  energy: { capacity: number; start: number };
  stamina: { max: number; regenPerSec: number; regenDelay: number };
  power: {
    /** Energy per second a channel can move from the reservoir into a charge (a rate, not a cap). */
    channelRate: number;
  };
  /** Preparation makes effects more efficient, with diminishing returns (see windupFactor). */
  windup: {
    /** The most a windup can ever save (fraction). The cost never drops below 1 − maxSaving. */
    maxSaving: number;
    /** Seconds of preparation that achieve ~63% of the maximum saving. */
    timeConstant: number;
  };
  impulse: {
    /** Efficiency of pushing other bodies (transmission losses). */
    efficiency: number;
    /** Efficiency of pushing your own body: no transmission, so nothing is lost. */
    selfEfficiency: number;
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
    /** Numerical safety bound for the simulation, not a balance rule. */
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
  };
  prevent: {
    /** Dissipating damage that was not redirected costs energy per HP. */
    energyPerHp: number;
    /** When the hit's energy already went somewhere (redirected), only a small precision fee is due. */
    afterRedirectEnergy: number;
  };
  reduce: { energyPerHp: number };
  absorb: { efficiency: number; staminaPerEnergy: number };
  charge: {
    /** Fraction of a charge that scatters (is lost) when you are hurt while channelling. */
    interruptLoss: number;
    /** Damage in one hit that breaks channelling and windups. */
    interruptThreshold: number;
  };
  pickups: {
    cellEnergy: number;
    /** Energy per second a dynamo feeds into a reservoir standing in its field. */
    dynamoRate: number;
  };
}

export const DEFAULT_EXCHANGE: ExchangeTable = {
  version: 2,
  energy: { capacity: 100, start: 40 },
  stamina: { max: 100, regenPerSec: 26, regenDelay: 0.55 },
  power: { channelRate: 40 },
  windup: { maxSaving: 0.4, timeConstant: 2 },
  impulse: { efficiency: 0.85, selfEfficiency: 1, linearPerMu: 0.5, freeRange: 140, rangeFalloff: 220 },
  strike: { energyPerHp: 1.0, reach: 96, knockbackShare: 0.35 },
  projectile: { efficiency: 0.8, linearPerMu: 0.5, minMass: 0.05, maxMass: 500, minSpeed: 60, lifetime: 4 },
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
  },
  prevent: { energyPerHp: 1.5, afterRedirectEnergy: 3 },
  reduce: { energyPerHp: 1.5 },
  absorb: { efficiency: 0.6, staminaPerEnergy: 0.15 },
  charge: { interruptLoss: 0.5, interruptThreshold: 4 },
  pickups: { cellEnergy: 35, dynamoRate: 45 },
};

export function cloneTable(t: ExchangeTable = DEFAULT_EXCHANGE): ExchangeTable {
  return JSON.parse(JSON.stringify(t)) as ExchangeTable;
}
