import { describe, expect, it } from 'vite-plus/test';
import { describeSprayMotion } from './spray-motion';
import type { SprayRawTrajectoryPoint } from './spray-provider';
import type { SprayEvidenceSegment } from './spray-evidence';

function input(pitch: number[], yaw = pitch.map(() => 0)) {
  const points: SprayRawTrajectoryPoint[] = pitch.map((p, i) => ({
    id: `shot-${i}`,
    tick: 100 + i * 6,
    frame: 200 + i * 6,
    serverTick: 500 + i * 6,
    steamId: '76561198000000001',
    playerEntityId: '5:2',
    playerHandle: 32773,
    direction: { pitch: p, yaw: yaw[i] },
    origin: { x: 0, y: 0, z: 64 },
    recoilIndex: i,
    itemDefinitionIndex: 7,
    identityVerified: true,
  }));
  const segments: SprayEvidenceSegment[] = [
    {
      id: 'burst',
      shooterSteamId: '76561198000000001',
      roundNumber: 1,
      weaponEntityId: '12345',
      itemDefinitionIndex: 7,
      shotIds: points.map((point) => point.id),
      diagnoses: [],
    },
  ];
  return { points, segments };
}
describe('factual firing direction patterns', () => {
  it('reports pitch sign correctly without a target or claiming that a shot missed', () => {
    const { points, segments } = input([2, 1.4, 0.8, 0.2, -0.4, -1, -1.6, -2.2]);
    expect(describeSprayMotion(points, segments)).toMatchObject([{ code: 'firing_rise', degrees: 4.2 }]);
    points.forEach((point) => {
      point.direction!.pitch *= -1;
    });
    expect(describeSprayMotion(points, segments)).toMatchObject([{ code: 'firing_fall', degrees: 4.2 }]);
  });
  it('does not turn a small trace jitter or a quick viewpoint change into sustained drift', () => {
    for (const pitch of [
      [0, 0.1, -0.1, 0, 0.1, -0.1, 0, 0.1],
      [0, 0, 0, 0, -25, -25, -25, -25],
    ]) {
      const { points, segments } = input(pitch);
      expect(describeSprayMotion(points, segments)).toEqual([]);
    }
  });
  it('counts substantial horizontal reversals and unwraps the 180-degree boundary', () => {
    const { points, segments } = input(Array(8).fill(0), [179, -177, 177, -177, 177, -177, 177, -177]);
    expect(describeSprayMotion(points, segments)).toMatchObject([
      { code: 'firing_lateral_swings', degrees: 6, turns: 6 },
    ]);
  });
  it('rejects incomplete identity and ambiguous same-tick trajectories', () => {
    const { points, segments } = input([0, -1, -2, -3, -4, -5, -6, -7]);
    points[2].identityVerified = false;
    expect(describeSprayMotion(points, segments)).toEqual([]);
    points[2].identityVerified = true;
    points[2].tick = points[1].tick;
    expect(describeSprayMotion(points, segments)).toEqual([]);
  });
});
