import type { DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import { normalizeSprayYaw, type SprayEvidenceSegment } from './spray-evidence';
import type { SprayRawTrajectoryPoint } from './spray-provider';

/** Describes recorded firing directions, not target tracking, bullet impacts or mouse motion. */
export function describeSprayMotion(
  points: SprayRawTrajectoryPoint[],
  segments: SprayEvidenceSegment[],
): NonNullable<DeathEvidenceReport['spray']['motion']> {
  const result: NonNullable<DeathEvidenceReport['spray']['motion']> = [];
  for (const segment of segments) {
    const samples = segment.shotIds.map((id) => points.find((point) => point.id === id));
    if (samples.length < 8 || samples.some((point) => !point?.identityVerified || !point.direction)) continue;
    const verified = samples as (SprayRawTrajectoryPoint & { direction: { pitch: number; yaw: number } })[];
    if (verified.some((point, index) => index > 0 && point.tick <= verified[index - 1].tick)) continue;
    const pitch = verified.map((point) => point.direction.pitch);
    const yaw = [verified[0].direction.yaw];
    for (let i = 1; i < verified.length; i++)
      yaw.push(yaw[i - 1] + normalizeSprayYaw(verified[i].direction.yaw - verified[i - 1].direction.yaw));
    if (![...pitch, ...yaw].every(Number.isFinite)) continue;
    const changes = pitch.slice(1).map((value, index) => value - pitch[index]);
    // Large viewpoint changes belong in the trace but are not grouped as sustained spray motion.
    if (
      changes.some((value) => Math.abs(value) > 15) ||
      yaw.slice(1).some((value, index) => Math.abs(value - yaw[index]) > 30)
    )
      continue;
    const net = pitch.at(-1)! - pitch[0];
    const base = {
      burstId: segment.id,
      shotIds: segment.shotIds,
      startTick: verified[0].tick,
      endTick: verified.at(-1)!.tick,
    };
    if (Math.abs(net) >= 3 && changes.filter((value) => Math.sign(net) * value >= 0.1).length / changes.length >= 0.75)
      result.push({ ...base, code: net < 0 ? 'firing_rise' : 'firing_fall', degrees: Math.abs(net), turns: 0 });

    // Count direction changes only after a two-degree excursion from the previous extreme.
    let direction = 0,
      extreme = yaw[0],
      anchor = yaw[0],
      turns = 0;
    for (const value of yaw.slice(1)) {
      if (direction === 0) {
        if (Math.abs(value - anchor) >= 2) {
          direction = Math.sign(value - anchor);
          extreme = value;
        }
      } else if ((value - extreme) * direction >= 0) extreme = value;
      else if ((extreme - value) * direction >= 2) {
        turns++;
        direction *= -1;
        extreme = value;
        anchor = value;
      }
    }
    const span = Math.max(...yaw) - Math.min(...yaw);
    if (turns >= 3 && span >= 6) result.push({ ...base, code: 'firing_lateral_swings', degrees: span, turns });
  }
  return result;
}
