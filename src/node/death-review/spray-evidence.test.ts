import { describe, expect, it } from 'vite-plus/test';
import { buildSprayEvidence, normalizeSprayYaw, type SprayEvidenceInput, type SprayBodyBox } from './spray-evidence';

const body: SprayBodyBox = { min: { x: 984, y: -16, z: 48 }, max: { x: 1016, y: 16, z: 80 } };
function fixture(pitches = [0, 0, -0.5, -1, -2, -3, -4, -5]): SprayEvidenceInput {
  const shots = pitches.map((pitch, index) => ({
    id: `s${index}`,
    tick: 1000 + index * 6,
    serverTick: 6400 + index * 6,
    roundNumber: 1,
    shooterSteamId: 'owner',
    weaponEntityId: 'ak-entity',
    itemDefinitionIndex: 7,
    origin: { x: 0, y: 0, z: 64 },
    angles: { pitch, yaw: 0 },
    recoilIndex: index,
    attackTimeSeconds: 100 + (index * 6) / 64,
  }));
  return {
    tickRate: 64,
    shots,
    engagements: [
      {
        id: 'e1',
        shotIds: shots.map((s) => s.id),
        confirmedDamage: [{ shotId: 's0', targetSteamId: 'opponent' }],
        targetSwitchObserved: false,
      },
    ],
    targetFrames: shots.map((shot) => ({
      shotId: shot.id,
      shotTick: shot.tick,
      targetSteamId: 'opponent',
      bodyBoxes: [structuredClone(body)],
      timing: { kind: 'exact-shot-time', attackTimeSeconds: shot.attackTimeSeconds },
      frameCoverage: 'complete',
      poseAndMotionCoverage: 'complete',
      targetLife: 'alive',
      targetRelation: 'enemy',
      visibility: 'clear',
      shooterBlinded: false,
      throughSmoke: false,
    })),
  };
}
function diagnoses(input: SprayEvidenceInput) {
  return buildSprayEvidence(input).segments.flatMap((s) => s.diagnoses);
}

describe('spray firing-centre evidence', () => {
  it('identifies rising centres after initial alignment using native negative-up pitch', () => {
    const result = buildSprayEvidence(fixture());
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].diagnoses).toEqual([
      expect.objectContaining({
        code: 'spray_center_rising',
        crossingCount: 0,
        targetSteamId: 'opponent',
        shotIds: ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'],
      }),
    ]);
    expect(result.points[7].target?.verticalOutsideDegrees).toBeLessThan(-4);
    expect(result.points[7].direction).toEqual({ pitch: -5, yaw: 0 });
  });

  it('identifies downward centres with positive-down pitch', () => {
    expect(diagnoses(fixture([0, 0, 0.5, 1, 2, 3, 4, 5]))[0].code).toBe('spray_center_falling');
  });

  it('identifies repeated complete left/right envelope crossings, not mouse movement', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    [0, 0, -3, 3, -3, 3, -3, 3].forEach((yaw, index) => {
      input.shots[index].angles.yaw = yaw;
    });
    expect(diagnoses(input)).toEqual([
      expect.objectContaining({ code: 'spray_center_lateral_crossings', crossingCount: 5 }),
    ]);
  });

  it('does not treat small corrections inside the body envelope as crossings', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    input.shots.forEach((s, i) => {
      s.angles.yaw = i % 2 ? 0.4 : -0.4;
    });
    expect(diagnoses(input)).toEqual([]);
  });

  it('does not call a stationary firing centre rising when only the target moved down', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    input.targetFrames.forEach((f, i) => {
      const offset = i < 2 ? 0 : -i * 20;
      f.bodyBoxes[0].min.z += offset;
      f.bodyBoxes[0].max.z += offset;
    });
    expect(buildSprayEvidence(input).points[7].target?.verticalOutsideDegrees).toBeLessThan(-5);
    expect(diagnoses(input)).toEqual([]);
  });

  it('does not call a stationary firing centre an alternating correction when only the target zigzags', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    input.targetFrames.forEach((f, i) => {
      const offset = i < 2 ? 0 : i % 2 ? 100 : -100;
      f.bodyBoxes[0].min.y += offset;
      f.bodyBoxes[0].max.y += offset;
    });
    expect(diagnoses(input)).toEqual([]);
  });

  it('rejects dead, unknown and friendly targets', () => {
    const input = fixture();
    input.targetFrames[4].targetLife = 'dead';
    expect(diagnoses(input)).toEqual([]);
    input.targetFrames[4].targetLife = 'unknown';
    expect(diagnoses(input)).toEqual([]);
    input.targetFrames[4].targetLife = 'alive';
    input.targetFrames[4].targetRelation = 'teammate';
    expect(diagnoses(input)).toEqual([]);
  });

  it('does not merge ambiguous engagement identifiers', () => {
    const input = fixture();
    input.engagements.push({ ...structuredClone(input.engagements[0]), shotIds: ['not-in-this-segment'] });
    expect(diagnoses(input)).toEqual([]);
  });

  it('preserves raw centre directions without target/geometry and never adds recoil again', () => {
    const input = fixture();
    input.targetFrames = [];
    const result = buildSprayEvidence(input);
    expect(result.points).toHaveLength(8);
    expect(result.points[7].direction?.pitch).toBe(-5);
    expect(result.points.every((p) => p.unavailableReason === 'missing-target-frame')).toBe(true);
    expect(diagnoses(input)).toEqual([]);
  });

  it('does not use spread/inaccuracy as actual impact coordinates or change the centre', () => {
    const input = fixture();
    input.shots.forEach((s) => {
      s.inaccuracy = 0.5;
      s.spread = 0.5;
    });
    expect(buildSprayEvidence(input).points).toEqual(buildSprayEvidence(fixture()).points);
  });

  it('tracks a moving target using its own per-shot bounds', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    input.shots.forEach((s, i) => {
      const y = i * 50;
      s.angles.yaw = (Math.atan2(y, 1000) * 180) / Math.PI;
      input.targetFrames[i].bodyBoxes = [{ min: { x: 984, y: y - 16, z: 48 }, max: { x: 1016, y: y + 16, z: 80 } }];
    });
    expect(diagnoses(input)).toEqual([]);
    expect(buildSprayEvidence(input).points.every((p) => p.target?.horizontalOutsideDegrees === 0)).toBe(true);
  });

  it('unwraps yaw around a target at plus/minus 180 degrees', () => {
    const input = fixture([0, 0, 0, 0, 0, 0, 0, 0]);
    input.shots.forEach((s, i) => {
      s.angles.yaw = i % 2 ? -179.8 : 179.8;
    });
    input.targetFrames.forEach((f) => {
      f.bodyBoxes = [{ min: { x: -1016, y: -16, z: 48 }, max: { x: -984, y: 16, z: 80 } }];
    });
    expect(diagnoses(input)).toEqual([]);
    expect(buildSprayEvidence(input).points.every((p) => Math.abs(p.target?.relativeYaw ?? 999) < 0.21)).toBe(true);
    expect(normalizeSprayYaw(180)).toBe(-180);
    expect(normalizeSprayYaw(-180)).toBe(-180);
    expect(normalizeSprayYaw(540)).toBe(-180);
  });

  it('requires departure after initial centres intersected the target envelope', () => {
    expect(diagnoses(fixture([-6, -6, -6, -6, -6, -6, -6, -6]))).toEqual([]);
  });

  it('requires eight shots and three final centres outside the envelope', () => {
    expect(diagnoses(fixture([0, 0, -1, -2, -3, -4, -5]))).toEqual([]);
    expect(diagnoses(fixture([0, 0, 0, 0, 0, 0, -4, -5]))).toEqual([]);
  });

  it.each(['weapon', 'round', 'gap', 'recoil'] as const)('does not join a burst across %s changes', (change) => {
    const input = fixture();
    input.shots.slice(4).forEach((s) => {
      if (change === 'weapon') {
        s.weaponEntityId = 'different-ak';
      }
      if (change === 'round') {
        s.roundNumber = 2;
      }
      if (change === 'gap') {
        s.tick += 128;
      }
      if (change === 'recoil') {
        s.recoilIndex = (s.recoilIndex ?? 0) - 4;
      }
    });
    expect(buildSprayEvidence(input).segments).toHaveLength(2);
    expect(diagnoses(input)).toEqual([]);
  });

  it('reorders input by actual tick and gets identical evidence', () => {
    const input = fixture();
    input.shots.reverse();
    input.targetFrames.reverse();
    expect(buildSprayEvidence(input)).toEqual(buildSprayEvidence(fixture()));
  });

  it('rejects duplicate event ids without dropping the supplied events', () => {
    const input = fixture();
    input.shots[4].id = 's0';
    const result = buildSprayEvidence(input);
    expect(result.points).toHaveLength(8);
    expect(result.points.filter((p) => p.unavailableReason === 'duplicate-shot-id')).toHaveLength(2);
    expect(diagnoses(input)).toEqual([]);
  });

  it('does not invent order for different events at the same tick', () => {
    const input = fixture();
    input.shots[4].tick = input.shots[3].tick;
    expect(buildSprayEvidence(input).points.filter((p) => p.unavailableReason === 'ambiguous-same-tick')).toHaveLength(
      2,
    );
    expect(diagnoses(input)).toEqual([]);
  });

  it.each(['unknown', 'observed', 'multiple-damaged-targets', 'no-damage', 'unrelated-shot'] as const)(
    'rejects target evidence: %s',
    (scenario) => {
      const input = fixture();
      if (scenario === 'unknown') {
        input.engagements[0].targetSwitchObserved = null;
      }
      if (scenario === 'observed') {
        input.engagements[0].targetSwitchObserved = true;
      }
      if (scenario === 'multiple-damaged-targets') {
        input.engagements[0].confirmedDamage.push({ shotId: 's2', targetSteamId: 'another-opponent' });
      }
      if (scenario === 'no-damage') {
        input.engagements[0].confirmedDamage = [];
      }
      if (scenario === 'unrelated-shot') {
        input.engagements[0].confirmedDamage[0].shotId = 'unknown';
      }
      expect(diagnoses(input)).toEqual([]);
    },
  );

  it('does not use damage from an earlier disconnected burst as target confirmation', () => {
    const input = fixture([0, 0, 0, -0.5, -1, -2, -3, -4, -5]);
    input.shots.slice(1).forEach((s) => {
      s.tick += 256;
    });
    input.targetFrames.forEach((f, i) => {
      f.shotTick = input.shots[i].tick;
    });
    expect(diagnoses(input)).toEqual([]);
  });

  it.each(['frameCoverage', 'poseAndMotionCoverage', 'visibility', 'shooterBlinded', 'throughSmoke'] as const)(
    'requires the complete %s gate',
    (gate) => {
      const input = fixture();
      const f = input.targetFrames[3];
      if (gate === 'frameCoverage') {
        f.frameCoverage = 'missing';
      }
      if (gate === 'poseAndMotionCoverage') {
        f.poseAndMotionCoverage = 'unknown';
      }
      if (gate === 'visibility') {
        f.visibility = 'unknown';
      }
      if (gate === 'shooterBlinded') {
        f.shooterBlinded = true;
      }
      if (gate === 'throughSmoke') {
        f.throughSmoke = true;
      }
      expect(diagnoses(input)).toEqual([]);
    },
  );

  it('does not equate unknown flash or smoke with absence', () => {
    for (const key of ['shooterBlinded', 'throughSmoke'] as const) {
      const input = fixture();
      input.targetFrames.forEach((f) => {
        f[key] = null;
      });
      expect(diagnoses(input)).toEqual([]);
    }
  });

  it.each(['missing', 'mismatch', 'wrong-tick'] as const)('rejects exact timing when %s', (scenario) => {
    const input = fixture();
    if (scenario === 'missing') {
      delete input.shots[3].attackTimeSeconds;
    }
    if (scenario === 'mismatch') {
      input.targetFrames[3].timing = { kind: 'exact-shot-time', attackTimeSeconds: 0 };
    }
    if (scenario === 'wrong-tick') {
      input.targetFrames[3].shotTick--;
    }
    expect(diagnoses(input)).toEqual([]);
  });

  it('accepts a fully covered verified server-clock and unlag envelope', () => {
    const input = fixture();
    input.maximumUnlagSeconds = 1;
    input.targetFrames.forEach((f, i) => {
      const time = (input.shots[i].serverTick ?? 0) / input.tickRate;
      f.timing = {
        kind: 'conservative-lag-envelope',
        earliestPossibleTargetTime: time - 1.1,
        latestPossibleTargetTime: time,
        coveredFrom: time - 1.1,
        coveredThrough: time,
      };
      delete input.shots[i].attackTimeSeconds;
    });
    expect(diagnoses(input)[0].code).toBe('spray_center_rising');
    delete input.maximumUnlagSeconds;
    expect(diagnoses(input)).toEqual([]);
    input.maximumUnlagSeconds = 1;
    delete input.shots[3].serverTick;
    expect(diagnoses(input)).toEqual([]);
  });

  it('rejects an envelope that omits part of the lag window or has unknown time', () => {
    const input = fixture();
    input.maximumUnlagSeconds = 1;
    input.targetFrames.forEach((f) => {
      f.timing = {
        kind: 'conservative-lag-envelope',
        earliestPossibleTargetTime: 99.99,
        latestPossibleTargetTime: 101,
        coveredFrom: 100,
        coveredThrough: 101,
      };
    });
    expect(diagnoses(input)).toEqual([]);
    input.targetFrames.forEach((f) => {
      f.timing = { kind: 'unverified' };
    });
    expect(diagnoses(input)).toEqual([]);
  });

  it('uses the enclosing union of all possible target poses, not one convenient box', () => {
    const input = fixture();
    input.targetFrames.forEach((f) => {
      f.bodyBoxes.push({ min: { x: 984, y: -16, z: 140 }, max: { x: 1016, y: 16, z: 180 } });
    });
    expect(diagnoses(input)).toEqual([]);
    expect(buildSprayEvidence(input).points[7].target?.verticalOutsideDegrees).toBe(0);
  });

  it.each(['nan', 'infinite', 'huge', 'degenerate', 'inside', 'vertical-axis', 'empty'] as const)(
    'refuses unsafe target geometry: %s',
    (scenario) => {
      const input = fixture();
      const f = input.targetFrames[3];
      if (scenario === 'nan') {
        f.bodyBoxes[0].min.x = NaN;
      }
      if (scenario === 'infinite') {
        f.bodyBoxes[0].max.z = Infinity;
      }
      if (scenario === 'huge') {
        f.bodyBoxes[0].max.z = 1e100;
      }
      if (scenario === 'degenerate') {
        f.bodyBoxes[0].max.x = f.bodyBoxes[0].min.x;
      }
      if (scenario === 'inside') {
        f.bodyBoxes = [{ min: { x: -10, y: -10, z: 0 }, max: { x: 10, y: 10, z: 100 } }];
      }
      if (scenario === 'vertical-axis') {
        f.bodyBoxes = [{ min: { x: -10, y: -10, z: 100 }, max: { x: 10, y: 10, z: 200 } }];
      }
      if (scenario === 'empty') {
        f.bodyBoxes = [];
      }
      expect(buildSprayEvidence(input).points[3].unavailableReason).toBe('incomplete-geometry');
      expect(diagnoses(input)).toEqual([]);
    },
  );

  it.each(['nan-angle', 'huge-angle', 'invalid-origin', 'fractional-tick', 'bad-rate'] as const)(
    'retains a basic point without diagnosing invalid raw data: %s',
    (scenario) => {
      const input = fixture();
      if (scenario === 'nan-angle') {
        input.shots[3].angles.yaw = NaN;
      }
      if (scenario === 'huge-angle') {
        input.shots[3].angles.yaw = 1e100;
      }
      if (scenario === 'invalid-origin') {
        input.shots[3].origin.x = Infinity;
      }
      if (scenario === 'fractional-tick') {
        input.shots[3].tick += 0.1;
      }
      if (scenario === 'bad-rate') {
        input.tickRate = NaN;
      }
      expect(buildSprayEvidence(input).points).toHaveLength(8);
      expect(diagnoses(input)).toEqual([]);
    },
  );

  it('does not run spray rules on pistols, shotgun pellets, unknown weapons or missing recoil', () => {
    for (const item of [4, 25, 999]) {
      const input = fixture();
      input.shots.forEach((s) => {
        s.itemDefinitionIndex = item;
      });
      expect(diagnoses(input)).toEqual([]);
    }
    const input = fixture();
    input.shots.forEach((s) => {
      s.recoilIndex = null;
    });
    expect(diagnoses(input)).toEqual([]);
  });
});
