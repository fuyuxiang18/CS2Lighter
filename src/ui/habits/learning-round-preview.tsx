import React, { useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { PlayerPosition } from 'csdm/common/types/player-position';
import type { Match } from 'csdm/common/types/match';
import type { Round } from 'csdm/common/types/round';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useMaps } from 'csdm/ui/maps/use-maps';
import { useGetMapRadarSrc } from 'csdm/ui/maps/use-get-map-radar-src';
import { getScaledCoordinateX } from 'csdm/ui/maps/get-scaled-coordinate-x';
import { getScaledCoordinateY } from 'csdm/ui/maps/get-scaled-coordinate-y';
import { RadarLevel } from 'csdm/ui/maps/radar-level';

type Props = { match: Match; round: Round; steamId: string };

export function LearningRoundPreview({ match, round, steamId }: Props) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const maps = useMaps();
  const getRadarSrc = useGetMapRadarSrc();
  const [positions, setPositions] = useState<PlayerPosition[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client
      .send({
        name: RendererClientMessageName.Fetch2DViewerData,
        payload: { checksum: match.checksum, demoFilePath: match.demoFilePath, roundNumber: round.number },
      })
      .then((data) => {
        if (!cancelled) setPositions(data.playerPositions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, match.checksum, match.demoFilePath, round.number]);

  const samples = positions
    .filter(
      (position) =>
        position.playerSteamId === steamId &&
        position.isAlive &&
        position.tick >= round.freezetimeEndTick &&
        position.tick <= round.endTick,
    )
    .sort((a, b) => a.tick - b.tick);
  const currentIndex = Math.min(index, Math.max(samples.length - 1, 0));
  const current = samples[currentIndex];
  const map = maps.find((map) => map.name === match.mapName && map.game === match.game);
  const level = current && map?.lowerRadarFilePath && current.z < map.thresholdZ ? RadarLevel.Lower : RadarLevel.Upper;
  const radarSrc = getRadarSrc(match.mapName, match.game, level);
  const tickrate = match.tickrate > 0 ? match.tickrate : 64;
  const seconds = current ? ((current.tick - round.freezetimeEndTick) / tickrate).toFixed(1) : '0';

  if (loading)
    return (
      <p role="status" className="py-24">
        <Trans>Loading route and view direction…</Trans>
      </p>
    );
  if (failed)
    return (
      <p className="text-red-500">
        <Trans>Could not load this round's positions. Reopen the round to retry.</Trans>
      </p>
    );
  if (!current)
    return (
      <p className="text-gray-700">
        <Trans>
          No alive position samples for this player. Reanalyze with positions enabled, or watch the original demo in
          CS2.
        </Trans>
      </p>
    );
  if (!map || !radarSrc)
    return (
      <p className="text-gray-700">
        <Trans>No radar available for this map. Open the original demo to review the round.</Trans>
      </p>
    );

  const x = getScaledCoordinateX(map, map.radarSize, current.x);
  const y = getScaledCoordinateY(map, map.radarSize, current.y);
  const angle = (-current.yaw * Math.PI) / 180;
  const marker = map.radarSize / 100;
  const path: string[] = [];
  let previous: PlayerPosition | undefined;
  for (const point of samples.slice(0, currentIndex + 1)) {
    const pointLevel = map.lowerRadarFilePath && point.z < map.thresholdZ ? RadarLevel.Lower : RadarLevel.Upper;
    if (pointLevel !== level) {
      previous = undefined;
      continue;
    }
    const command = previous && point.tick - previous.tick <= tickrate ? 'L' : 'M';
    path.push(
      `${command}${getScaledCoordinateX(map, map.radarSize, point.x)},${getScaledCoordinateY(map, map.radarSize, point.y)}`,
    );
    previous = point;
  }

  return (
    <div className="flex flex-col gap-12">
      <svg
        className="aspect-square w-full rounded-8 bg-gray-100"
        viewBox={`0 0 ${map.radarSize} ${map.radarSize}`}
        role="img"
        aria-label={t`Player route and horizontal view direction`}
      >
        <image href={radarSrc} width={map.radarSize} height={map.radarSize} />
        <path d={path.join(' ')} className="fill-transparent stroke-blue-500" strokeWidth={marker / 2} />
        <circle cx={x} cy={y} r={marker} className="fill-orange-500 stroke-white" strokeWidth={marker / 4} />
        <line
          x1={x}
          y1={y}
          x2={x + Math.cos(angle) * marker * 5}
          y2={y + Math.sin(angle) * marker * 5}
          className="stroke-white"
          strokeWidth={marker / 3}
        />
      </svg>
      <label className="flex flex-col gap-8">
        <span>
          <Trans>{seconds}s after freeze time</Trans> · {current.activeWeaponName}
        </span>
        <input
          className="w-full accent-blue-500"
          type="range"
          min={0}
          max={Math.max(samples.length - 1, 0)}
          step={1}
          value={currentIndex}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-label={t`Scrub recorded positions`}
        />
      </label>
      <p className="text-caption text-gray-700">
        <Trans>
          Blue: route. White: horizontal view direction. Drag through recorded positions; use CS2 for the full
          first-person view.
        </Trans>
      </p>
      <div className="flex flex-wrap gap-8 text-caption">
        {current.isDucking && (
          <span className="rounded-4 bg-gray-200 px-8 py-4">
            <Trans>Crouching</Trans>
          </span>
        )}
        {current.isScoping && (
          <span className="rounded-4 bg-gray-200 px-8 py-4">
            <Trans>Scoped</Trans>
          </span>
        )}
        {current.isAirborne && (
          <span className="rounded-4 bg-gray-200 px-8 py-4">
            <Trans>Airborne</Trans>
          </span>
        )}
        {current.flashDurationRemaining > 0 && (
          <span className="rounded-4 bg-gray-200 px-8 py-4">
            <Trans>Flashed</Trans>
          </span>
        )}
      </div>
    </div>
  );
}
