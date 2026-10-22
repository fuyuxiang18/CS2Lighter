export type DeathMechanicsReason =
  | 'shot-state-incomplete'
  | 'weapon-profile-unverified'
  | 'shot-accuracy-missing'
  | 'no-material-accuracy-loss'
  | 'accuracy-component-unverified'
  | 'target-exchange-unverified'
  | 'target-body-clock-unverified';

export type DeathMechanicsMeasurement = {
  shotId: string;
  tick: number;
  weaponName: string;
  profileSource: string | null;
  /** Native dimensionless spread-plane radii, NOT radians, degrees or hit probability. */
  inaccuracy: number | null;
  spread: number | null;
  stationaryInaccuracy: number | null;
  /** Maximum horizontal speed in the enclosed shot interval, in Source units/second. */
  speed: number | null;
  /** Decoded server clock bounds, not demo ticks and not an exact sub-tick timestamp. */
  firstServerTick: number | null;
  lastServerTick: number | null;
  component: 'movement' | 'landing' | 'recovery' | null;
  /** Shot-time components are explicitly transmitted, never inferred from frame-end speed. */
  measurementSource?: 'fire-bullets-extra' | 'bullet-damage';
  movementInaccuracy?: number;
  airborneInaccuracy?: number;
  reasons: DeathMechanicsReason[];
};

export type DeathMechanicsEvidence = {
  measurements: DeathMechanicsMeasurement[];
  reasons: DeathMechanicsReason[];
};
