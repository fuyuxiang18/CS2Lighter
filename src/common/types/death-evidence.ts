import type { DeathRiskInput, DeathRiskReport } from './death-risk';
import type { DeathMechanicsEvidence } from './death-mechanics';

export type DeathEvidenceKey = { checksum: string; steamId: string; deathId: string };

export type DeathEvidenceReport = DeathEvidenceKey & {
  version: 1;
  matchRevision?: string;
  generatedAt: string;
  /** Absent in the original 0.7.3 cache; absence is not a negative risk assessment. */
  risk?: DeathRiskReport;
  /** Compact, verified inputs allow rule-only changes to reuse the extracted evidence. */
  riskFacts?: DeathRiskInput;
  /** Measured shot values remain available even when attribution cannot be established. */
  mechanics?: DeathMechanicsEvidence;
  startTick: number;
  endTick: number;
  deathTick: number;
  tickrate: number;
  coverage: { requestedTicks: number; decodedTicks: number; missingTicks: number; shots: number };
  geometry: {
    status: 'available' | 'unavailable';
    mapName: string;
    match: 'installed-build-matched' | 'unverified';
    reasons: string[];
  };
  exposures: {
    startTick: number;
    endTick: number;
    enemyIds: string[];
    minimumAngleDegrees: number;
    samples: number;
  }[];
  gunlines: {
    tick: number;
    enemySteamId: string;
    distance: number;
    facingOffset: number | null;
    status: 'clear' | 'blocked' | 'unknown';
    reason: string;
  }[];
  gunlineAnalysis?: {
    basis: 'environment-eye-reference';
    status: 'evaluated' | 'partial' | 'unavailable';
    reasons: string[];
  };
  spray: {
    status: 'blocked' | 'partial' | 'evaluated';
    reasons: string[];
    points: {
      id: string;
      tick: number;
      pitch: number;
      yaw: number;
      recoilIndex: number | null;
      itemDefinitionIndex: number | null;
      burstId?: string | null;
      target: {
        steamId: string;
        relativePitch: number;
        relativeYaw: number;
        bodyPitchMin: number;
        bodyPitchMax: number;
        bodyYawMin: number;
        bodyYawMax: number;
      } | null;
    }[];
    findings: {
      code: 'spray_center_rising' | 'spray_center_falling' | 'spray_center_lateral_crossings';
      targetSteamId: string;
      eventTick: number;
      shotIds: string[];
      peakOutsideDegrees: number;
      changeDegrees: number;
      crossingCount: number;
    }[];
    motion?: {
      code: 'firing_rise' | 'firing_fall' | 'firing_lateral_swings';
      burstId: string;
      shotIds: string[];
      startTick: number;
      endTick: number;
      degrees: number;
      turns: number;
    }[];
  };
};

export type DeathEvidenceState = DeathEvidenceKey & {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'canceled' | 'error';
  phase: 'prepare' | 'decode' | 'map' | 'evaluate';
  completedTicks: number;
  totalTicks: number;
  error: string | null;
  report: DeathEvidenceReport | null;
};

export type InspectDeathEvidence = DeathEvidenceKey & { action: 'read' | 'analyze' | 'refresh' | 'cancel' };
