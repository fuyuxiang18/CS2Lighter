export type EvidenceVector = [number, number, number];
type EvidenceWindow = { startTick: number; endTick: number };
export type EvidenceRequest = {
  version: 1;
  demoPath: string;
  windows: EvidenceWindow[];
  players?: string[];
};

export type WireField = {
  present: boolean;
  value: unknown;
  lastUpdate: { frame: number; tick: number; serverTick: number | null } | null;
};
export type EvidenceEntity = {
  id: string;
  className: string;
  origin: EvidenceVector | null;
  fields: Record<string, WireField>;
};
export type EvidencePlayer = {
  id: string;
  steamId: string | null;
  origin: EvidenceVector | null;
  eyes: EvidenceVector | null;
  yaw: number | null;
  pitch: number | null;
  velocity: EvidenceVector | null;
  team: number | null;
  health: number | null;
  lifeState: number | null;
  hull: { mins: EvidenceVector | null; maxs: EvidenceVector | null };
  /** The subprocess can send deltas; the Node reader expands them before delivering a frame. */
  fieldsComplete: boolean;
  fields: Record<string, WireField>;
  activeWeapon?: {
    id: string;
    className: string;
    fieldsComplete: boolean;
    fields: Record<string, WireField>;
  } | null;
};
export type EvidenceSmoke = EvidenceEntity & {
  frameDataBase64: string | null;
  declaredSize: number | null;
  update: number | null;
};
export type EvidenceFrame = {
  type: 'frame';
  frame: number;
  tick: number;
  serverTick: number | null;
  players: EvidencePlayer[];
  world: { complete: boolean; upserts: EvidenceEntity[]; removed: string[] };
  smokes: { complete: boolean; upserts: EvidenceSmoke[]; removed: string[] };
};
export type EvidenceShot = {
  type: 'shot';
  frame: number;
  tick: number;
  serverTick: number | null;
  playerHandle: number | null;
  playerSlot: number | null;
  playerEntityId: string | null;
  steamId: string | null;
  raw: Record<string, unknown>;
};
export type EvidenceHeader = {
  type: 'header';
  version: 1;
  parserVersion: string;
  playerFieldsMode: 'delta';
  mapName: string;
  tickRate: number;
  windows: EvidenceWindow[];
  requestedTicks: number;
  patch: number | null;
  buildNum: number | null;
  sourceBytes: number;
};
export type EvidenceEnd = {
  type: 'end';
  status: 'ok' | 'error';
  emittedTicks: number;
  missingTicks: number[];
  duplicateTicks: number;
  frames: number;
  shots: number;
  outputBytes?: number;
  capabilities?: string[];
  supportedClasses?: Record<string, number>;
  unsupportedClasses?: Record<string, number>;
  error?: string;
};
export type EvidenceMessage =
  | EvidenceHeader
  | EvidenceFrame
  | EvidenceShot
  | EvidenceEnd
  | { type: 'progress'; frame: number; tick: number; requestedTicks: number; emittedTicks: number };

/** A missing property is never converted to a plausible zero. */
export function evidenceNumber(field: WireField | undefined): number | null {
  return field?.present === true && typeof field.value === 'number' && Number.isFinite(field.value)
    ? field.value
    : null;
}

export function evidenceVector(field: WireField | undefined): EvidenceVector | null {
  const value = field?.value;
  return field?.present === true &&
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
    ? (value as EvidenceVector)
    : null;
}
