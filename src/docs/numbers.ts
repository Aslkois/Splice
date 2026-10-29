import { MOVEMENT, PHYSICS } from '../sim/config';
import { channelSeconds, kineticEnergy, quoteImpulse, quoteProjectile, redirectCost, speedForEnergy, windupFactor } from '../sim/exchange/formulas';
import { DEFAULT_EXCHANGE as T } from '../sim/exchange/table';

/**
 * Every number the docs quote, computed with the formulas the exchange charges with. Articles refer
 * to them as {{name}}; nothing in the docs is typed in by hand, so the docs can't drift from the game.
 */
const self = (v0y: number, v0x: number, jx: number, jy: number) =>
  quoteImpulse(T, { mass: MOVEMENT.playerMass, velocity: { x: v0x, y: v0y }, impulse: { x: jx, y: jy }, self: true, distance: 0, maxSpeed: PHYSICS.maxBodySpeed }).energy;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function compute(): Record<string, number> {
  const boltEnergy = kineticEnergy(0.4, 760);
  const overcapSeconds = channelSeconds(T, 250);
  return {
    capacity: T.energy.capacity,
    channelRate: T.power.channelRate,
    dynamoRate: T.pickups.dynamoRate,
    cellEnergy: T.pickups.cellEnergy,
    linearPerMu: T.impulse.linearPerMu,
    selfEfficiency: T.impulse.selfEfficiency,
    remoteEfficiency: T.impulse.efficiency,
    maxSavingPct: Math.round(T.windup.maxSaving * 100),
    floorPct: Math.round((1 - T.windup.maxSaving) * 100),
    timeConstant: T.windup.timeConstant,
    interruptLossPct: Math.round(T.charge.interruptLoss * 100),
    interruptThreshold: T.charge.interruptThreshold,
    jumpKE: r1(kineticEnergy(1, MOVEMENT.jumpSpeed)),
    jumpCost760: r1(self(0, 0, 0, -760)),
    dj600Apex: r1(self(0, 0, 0, -600)),
    dj600Falling: r1(self(400, 0, 0, -1000)),
    dj650Apex: r1(self(0, 0, 0, -650)),
    impulse650Falling: r1(self(400, 0, 0, -650)),
    rocket1500: r1(self(0, 0, 0, -1500)),
    rocketWhileRising: r1(self(-760, 0, 0, -760)),
    launch3000: r1(self(0, 0, 0, -3000)),
    airDash850: r1(self(0, 330, 520, 0)),
    pricePer100px: r2((kineticEnergy(1, Math.sqrt(2 * PHYSICS.gravity * 100)) / 100) * 100),
    split32: r1(Array.from({ length: 32 }, (_, i) => self(-25 * i, 0, 0, -25)).reduce((a, b) => a + b, 0)),
    whole800: r1(self(0, 0, 0, -800)),
    windup05: r2(windupFactor(T, 0.5)),
    windup1: r2(windupFactor(T, 1)),
    windup15: r2(windupFactor(T, 1.5)),
    windup2: r2(windupFactor(T, 2)),
    windup4: r2(windupFactor(T, 4)),
    windup10: r2(windupFactor(T, 10)),
    strikeAfterWindup: r1(40 * windupFactor(T, 1.5)),
    seconds250: r1(overcapSeconds),
    overcapPaid: Math.round(250 * windupFactor(T, overcapSeconds)),
    absorbPct: Math.round(T.absorb.efficiency * 100),
    boltEnergy: r1(boltEnergy),
    guardRaise: T.guard.activateStamina,
    dashStamina: MOVEMENT.dashStamina,
    guardHold: T.guard.holdStaminaPerSec,
    shotKE: r1(quoteProjectile(T, 1200, 0.2).kineticEnergy),
    shotCost: r1(quoteProjectile(T, 1200, 0.2).energy),
    reflectFresh: r1(redirectCost(T, 0.1, boltEnergy, boltEnergy, 1).stamina),
    reflectLazy: r1(redirectCost(T, 1, boltEnergy, boltEnergy, 1).stamina),
    amp15: r1(redirectCost(T, 0.1, boltEnergy, boltEnergy, 1.5).energy),
    speedFor25: Math.round(speedForEnergy(T, 25)),
    preventPerHp: T.prevent.energyPerHp,
    slugEnergy: r1(kineticEnergy(6, 1150)),
  };
}

export const DOC_NUMBERS: Record<string, number> = compute();

export function fillNumbers(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in DOC_NUMBERS ? String(DOC_NUMBERS[k]) : m));
}
