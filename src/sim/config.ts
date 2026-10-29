// Simulation tunables. Everything that shapes feel or balance lives in data, not scattered literals.
// Units: distance = px, time = s, velocity = px/s, mass = kg (game mass).
// "Momentum units" (mu) = kg * 100px/s.  Energy (E) = 1/2 * m * (v / 100)^2.

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
/** Velocity scale used by every energy/momentum formula. */
export const V_UNIT = 100;

export const PHYSICS = {
  gravity: 2300, // px/s^2 applied to dynamic bodies
  maxFall: 1250,
  /** Hard engine-safety cap on any body's speed, independent of the exchange law. */
  maxBodySpeed: 4200,
  maxProjectileSpeed: 3200,
  killMargin: 600,
};

export const MOVEMENT = {
  runSpeed: 330,
  groundAccel: 3200,
  groundDecel: 3800,
  airAccel: 2000,
  airDecel: 700,
  /** Deceleration applied while moving faster than run speed in the input direction (keeps momentum from impulses). */
  overspeedDecelGround: 1500,
  overspeedDecelAir: 380,
  jumpSpeed: 760,
  jumpCutFactor: 0.45,
  fallGravityMult: 1.35,
  apexGravityMult: 0.7,
  apexThreshold: 90,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  dashSpeed: 820,
  dashTime: 0.14,
  dashCooldown: 0.38,
  dashStamina: 18,
  /** Walking into a crate pushes it at this speed (scaled down by sqrt(mass / 2)). */
  pushSpeed: 190,
  blockMoveFactor: 0.4,
  channelMoveFactor: 0.55,
  hitStun: 0.22,
  playerMass: 1,
  playerSize: { w: 28, h: 46 },
};

export const PLAYER = {
  maxHp: 100,
  respawnDelay: 1.1,
};

export const IMPACT = {
  /** Kinetic energy (E) of a body-body impact below which nothing is damaged. */
  threshold: 5,
  /** Fraction of the impact energy converted to health damage on each side. */
  damageFactor: 0.6,
  pairCooldown: 0.25,
};

export const SAFETY = {
  maxEntities: 450,
  maxProjectiles: 220,
  maxDamage: 1e9,
};
