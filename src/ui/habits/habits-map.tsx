import React, { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Game } from 'csdm/common/types/counter-strike';
import type { HabitsCohort, HabitsPositionBin } from 'csdm/common/types/habits';
import { useMaps } from 'csdm/ui/maps/use-maps';
import { useGetMapRadarSrc } from 'csdm/ui/maps/use-get-map-radar-src';
import { RadarLevel } from 'csdm/ui/maps/radar-level';
import { getScaledCoordinateX } from 'csdm/ui/maps/get-scaled-coordinate-x';
import { getScaledCoordinateY } from 'csdm/ui/maps/get-scaled-coordinate-y';
import { Select } from 'csdm/ui/components/inputs/select';
import { HabitsEvidenceList } from './habits-evidence';

type Props = { cohort: HabitsCohort; gridSize: number; steamId: string; openingWindowSeconds: number };

export function HabitsMap({ cohort, gridSize, steamId, openingWindowSeconds }: Props) {
  const { t } = useLingui();
  const maps = useMaps();
  const getRadarSrc = useGetMapRadarSrc();
  const [mode, setMode] = useState<'all' | 'opening'>('all');
  const [level, setLevel] = useState<RadarLevel | 'unknown'>(RadarLevel.Upper);
  const [selectedBin, setSelectedBin] = useState<HabitsPositionBin | null>(null);
  const map = maps.find((map) => map.name === cohort.mapName && map.game === Game.CS2);
  const hasLevels = Boolean(map?.lowerRadarFilePath);
  const radarSrc = level === 'unknown' ? undefined : getRadarSrc(cohort.mapName, Game.CS2, level);
  const metric = (bin: HabitsPositionBin) => (mode === 'opening' ? bin.openingSeconds : bin.seconds);
  const bins = cohort.bins.filter(
    (bin) => metric(bin) > 0 && (!hasLevels || (level === 'unknown' ? bin.level === null : bin.level === level)),
  );
  const maximum = bins.reduce((maximum, bin) => Math.max(maximum, metric(bin)), 0);
  const topBins = bins.toSorted((a, b) => metric(b) - metric(a)).slice(0, 5);
  const observedSeconds = mode === 'opening' ? cohort.openingSeconds : cohort.observedSeconds;
  const selectedEvidence = (mode === 'opening' ? selectedBin?.openingEvidence : selectedBin?.evidence) ?? [];

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap gap-12">
        <Select
          value={mode}
          onChange={(value) => {
            setMode(value);
            setSelectedBin(null);
          }}
          options={[
            { value: 'all', label: t`Alive time` },
            { value: 'opening', label: t`First ${openingWindowSeconds} seconds` },
          ]}
        />
        {hasLevels && (
          <Select
            value={level}
            onChange={(value) => {
              setLevel(value);
              setSelectedBin(null);
            }}
            options={[
              { value: RadarLevel.Upper, label: t`Upper floor` },
              { value: RadarLevel.Lower, label: t`Lower floor` },
              ...(cohort.bins.some((bin) => bin.level === null)
                ? [{ value: 'unknown' as const, label: t`Unknown floor` }]
                : []),
            ]}
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-20 xl:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-8 border border-gray-300 bg-gray-100">
          {map && radarSrc ? (
            <svg
              className="aspect-square w-full"
              viewBox={`0 0 ${map.radarSize} ${map.radarSize}`}
              role="img"
              aria-label={t`Time spent by map area`}
            >
              <image href={radarSrc} width={map.radarSize} height={map.radarSize} />
              {bins.map((bin) => {
                const size = gridSize / map.scale;
                const seconds = metric(bin).toFixed(1);
                return (
                  <rect
                    key={`${bin.x}-${bin.y}-${bin.z}-${bin.level}`}
                    x={getScaledCoordinateX(map, map.radarSize, bin.x) - size / 2}
                    y={getScaledCoordinateY(map, map.radarSize, bin.y) - size / 2}
                    width={size}
                    height={size}
                    opacity={0.12 + (0.78 * metric(bin)) / maximum}
                    className="fill-orange-500"
                  >
                    <title>{t`${seconds} observed seconds`}</title>
                  </rect>
                );
              })}
              {selectedBin && (
                <circle
                  cx={getScaledCoordinateX(map, map.radarSize, selectedBin.x)}
                  cy={getScaledCoordinateY(map, map.radarSize, selectedBin.y)}
                  r={gridSize / map.scale}
                  className="fill-transparent stroke-white"
                  strokeWidth={3}
                />
              )}
            </svg>
          ) : (
            <p className="p-24 text-gray-700">
              <Trans>The radar for this map is unavailable. You can still review the evidence below.</Trans>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-12">
          <h3 className="text-body-strong">
            <Trans>Your most occupied areas</Trans>
          </h3>
          <p className="text-caption text-gray-700">
            <Trans>
              Color intensity represents observed alive time, not the number of recorded ticks. Select an area to see
              example rounds.
            </Trans>
          </p>
          {topBins.length === 0 && (
            <p>
              <Trans>No position samples for this floor and time window.</Trans>
            </p>
          )}
          {topBins.map((bin, index) => {
            const areaNumber = index + 1;
            const seconds = Math.round(metric(bin));
            const share = observedSeconds > 0 ? ((100 * metric(bin)) / observedSeconds).toFixed(1) : '0';
            const rounds = mode === 'opening' ? bin.openingRoundCount : bin.roundCount;
            return (
              <button
                key={`${bin.x}-${bin.y}-${bin.z}-${bin.level}`}
                className={`flex items-center justify-between gap-12 rounded-4 border p-12 text-left ${selectedBin === bin ? 'border-blue-500 bg-gray-100' : 'border-gray-300 hover:border-gray-600'}`}
                onClick={() => setSelectedBin(bin)}
              >
                <div>
                  <p className="text-body-strong">
                    <Trans>Area {areaNumber}</Trans>
                  </p>
                  <p className="text-caption text-gray-700">
                    <Trans>
                      {rounds} rounds · {seconds}s observed
                    </Trans>
                  </p>
                </div>
                <span className="text-subtitle text-orange-500">{share}%</span>
              </button>
            );
          })}
          <p className="text-caption text-gray-700">
            <Trans>
              Shares use this map/version group's observed time across all floors. Radar artwork uses the installed map
              assets.
            </Trans>
          </p>
        </div>
      </div>
      {selectedBin && (
        <div className="border-t border-gray-300 pt-16">
          <HabitsEvidenceList evidence={selectedEvidence} steamId={steamId} />
        </div>
      )}
    </div>
  );
}
