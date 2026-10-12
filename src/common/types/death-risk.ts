export type DeathRiskRuleId =
  | 'r1'
  | 'r2'
  | 'r3'
  | 'r4'
  | 'r5'
  | 'r6'
  | 'r7'
  | 'r8'
  | 'r9'
  | 'r10'
  | 'r11'
  | 'r12'
  | 'r13'
  | 'r14';

export type DeathRiskVector = { x: number; y: number; z: number };
type DeathRiskLineStatus = 'clear' | 'blocked' | 'unknown';
type DeathRiskEvaluationStatus = 'matched' | 'clear' | 'unavailable' | 'not-applicable';

export type DeathRiskEvidence = {
  code: string;
  tick: number;
  endTick?: number;
  actorId?: string;
  targetId?: string;
  position?: DeathRiskVector;
  values: Record<string, number | string | boolean | null>;
  /** Stable references to decoded frames, events, map proofs, or validated weapon profiles. */
  sources: string[];
};

export type DeathRiskAdvice = {
  code:
    | 'wait-for-movement-recovery'
    | 'wait-for-landing-recovery'
    | 'allow-burst-recovery'
    | 'correct-target-relative-spray'
    | 'isolate-enemy-lines'
    | 'stop-at-earlier-cover'
    | 'change-repeek-timing-or-angle'
    | 'return-to-verified-cover'
    | 'ready-weapon-before-peeking'
    | 'reload-behind-cover'
    | 'check-magazine-before-contact'
    | 'sequence-flash-and-peek'
    | 'wait-out-blindness-in-cover'
    | 'synchronize-with-teammate';
  values: Record<string, number | string | boolean | null>;
};

export type DeathRiskFinding = {
  id: string;
  ruleId: DeathRiskRuleId;
  relatedRuleIds: DeathRiskRuleId[];
  startTick: number;
  endTick: number;
  priority: number;
  subtype?: string;
  targetIds: string[];
  evidence: DeathRiskEvidence[];
  advice: DeathRiskAdvice;
};

type DeathRiskEvaluation = {
  ruleId: DeathRiskRuleId;
  status: DeathRiskEvaluationStatus;
  reasons: string[];
  findingIds: string[];
};

export type DeathRiskReport = {
  version: 1;
  ruleRevision: string;
  status: 'evaluated' | 'partial' | 'unavailable';
  findings: DeathRiskFinding[];
  /** One primary finding followed by at most two independent secondary findings. */
  selectedFindingIds: string[];
  evaluations: DeathRiskEvaluation[];
};

export type DeathRiskWeaponState = {
  entityId: string;
  name: string;
  kind: 'gun' | 'knife' | 'grenade' | 'bomb' | 'other';
  magazine: number | null;
  reloading: boolean | null;
  /** Includes owner attack lockout and weapon deployment; null is unknown, never ready. */
  ready: boolean | null;
  /** True only for a decoded deployment lockout; shot cooldown alone does not count. */
  deploying?: boolean | null;
  nextReadyTick?: number | null;
};

export type DeathRiskActorFrame = {
  id: string;
  alive: boolean;
  position: DeathRiskVector;
  eye: DeathRiskVector;
  yaw: number | null;
  weapon: DeathRiskWeaponState | null;
  onGround: boolean | null;
  /** Explicit flash-event interval, not a guessed screen opacity. */
  blind: { sourceId: string | null; startTick: number; endTick: number } | null;
};

type DeathRiskGunline = {
  observerId: string;
  targetId: string;
  status: DeathRiskLineStatus;
  reason?: string;
  /** Proof at the current target position, substituting the previous observer position. */
  previousObserverPosition?: {
    tick: number;
    status: DeathRiskLineStatus;
    source: string;
  };
};

export type DeathRiskFrame = {
  tick: number;
  actors: DeathRiskActorFrame[];
  lines: DeathRiskGunline[];
};

export type DeathRiskShot = {
  id: string;
  tick: number;
  actorId: string;
  weaponEntityId: string;
  weaponName: string;
};

/** A version-verified weapon model evaluated at the actual shot state. No generic speed thresholds. */
export type DeathRiskPrecisionSample = {
  shotId: string;
  kind: 'movement' | 'landing' | 'recovery';
  profileSource: string;
  profileVerified: boolean;
  /** Other changing accuracy components were excluded across the shot clock interval. */
  componentVerified: boolean;
  measurementResolutionDegrees: number;
  /** Must be the segment's first shot for movement or recovery. */
  segmentFirstShot: boolean;
  baselineHalfAngleDegrees: number;
  actualHalfAngleDegrees: number;
  targetHalfAngleDegrees: number | null;
  targetId: string;
  targetGeometryVerified: boolean;
  /** A uniquely linked damage exchange may establish distance without claiming body hitboxes. */
  targetAssociationVerified?: boolean;
  distance: number;
  stableAfterTick: number | null;
  movementSpeed?: number;
  landingTick?: number;
  precedingShotTick?: number;
};

/** Target-relative directions; producer must certify firing-centre and target association. */
export type DeathRiskAimSample = {
  shotId: string;
  targetId: string;
  burstId: string;
  verified: boolean;
  source: string;
  relativePitch: number;
  relativeYaw: number;
  bodyPitchMin: number;
  bodyPitchMax: number;
  bodyYawMin: number;
  bodyYawMax: number;
  /** Verified cadence for this weapon/mode, not a global inter-shot interval. */
  maximumGapTicks: number;
};

export type DeathRiskEvent =
  | {
      id: string;
      kind: 'damage';
      tick: number;
      actorId: string;
      targetId: string;
      amount: number;
      weaponKind?: 'gun' | 'grenade' | 'knife' | 'other';
    }
  | {
      id: string;
      kind: 'kill';
      tick: number;
      actorId: string;
      targetId: string;
      weaponKind?: 'gun' | 'grenade' | 'knife' | 'other';
    };

type DeathRiskCoverProof = {
  actorId: string;
  tick: number;
  position: DeathRiskVector;
  /** Route is traversable at this tick and the destination blocks every listed enemy line. */
  verified: boolean;
  enemyIds: string[];
  travelTicks: number;
  source: string;
};

type DeathRiskSupportProof = {
  teammateId: string;
  targetId: string;
  startTick: number;
  endTick: number;
  /** Earliest POSSIBLE support, certified over all usable firing positions/routes in this window. */
  earliestPossibleSupportTick: number | null;
  verified: boolean;
  source: string;
  /** Optional witnessed previous coordinated position; never a straight-line distance estimate. */
  previousSupport?: { tick: number; subjectPosition: DeathRiskVector; source: string };
};

/** A witnessed formation change; it makes no claim about all possible routes or future support. */
export type DeathRiskSupportTransition = {
  id: string;
  targetId: string;
  startTick: number;
  endTick: number;
  entryPosition: DeathRiskVector;
  positionBeforeEntry: DeathRiskVector;
  previousSupport: {
    tick: number;
    targetId: string;
    subjectPosition: DeathRiskVector;
    teammateIds: string[];
  };
  blockedTeammateIds: string[];
  displacementFromSharedPosition: number;
  eventIds: string[];
  sources: string[];
};

export type DeathRiskInput = {
  version: 1;
  /** False for unsupported warmups, revives, bot takeovers, or incomplete 5v5 identities. */
  eligible?: boolean;
  subjectId: string;
  enemyIds: string[];
  teammateIds: string[];
  startTick: number;
  deathTick: number;
  tickrate: number;
  frames: DeathRiskFrame[];
  shots: DeathRiskShot[];
  events: DeathRiskEvent[];
  precision: DeathRiskPrecisionSample[];
  aim: DeathRiskAimSample[];
  cover: DeathRiskCoverProof[];
  support: DeathRiskSupportProof[];
  supportTransitions?: { observations: DeathRiskSupportTransition[]; reasons: string[] };
  /** Unknown coverage must not be interpreted as a negative observation. */
  coverage: {
    events: boolean;
    shots: boolean;
    weaponState: boolean;
    flash: boolean;
    precision: boolean;
    aim: boolean;
    /** Support and utility changes were checked throughout repeek windows. */
    repeekInterventions: boolean;
  };
  /** Intervals where a verified friendly intervention changes an ongoing angle. */
  interventions: { startTick: number; endTick: number; enemyId: string; source: string }[];
};
