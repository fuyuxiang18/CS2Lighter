import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { ReviewPreview } from 'csdm/common/types/review-preview';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useMaps } from 'csdm/ui/maps/use-maps';
import { useGetMapRadarSrc } from 'csdm/ui/maps/use-get-map-radar-src';
import { RadarLevel } from 'csdm/ui/maps/radar-level';
import { getScaledCoordinateX } from 'csdm/ui/maps/get-scaled-coordinate-x';
import { getScaledCoordinateY } from 'csdm/ui/maps/get-scaled-coordinate-y';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { ReviewButton } from './review-button';
import { buildReviewPreviewFrames, reviewPreviewFrameAt } from './review-preview-frames';

export function DeathReviewPreview({ record }: { record: DeathReviewRecord }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const maps = useMaps();
  const radar = useGetMapRadarSrc();
  const [data, setData] = useState<ReviewPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [{ tick, playing }, setPlayback] = useState({ tick: record.startTick, playing: false });
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [level, setLevel] = useState<RadarLevel | 'auto'>('auto');
  const map = maps.find((candidate) => candidate.name === record.mapName && candidate.game === Game.CS2);
  const frames = useMemo(() => buildReviewPreviewFrames(data?.positions ?? []), [data]);
  const frame = data ? reviewPreviewFrameAt(frames, tick, data.tickrate) : undefined;
  const focal = frame?.players.find((player) => player.playerSteamId === record.steamId);
  const visibleLevel =
    level === 'auto'
      ? map?.lowerRadarFilePath && focal && focal.z < map.thresholdZ
        ? RadarLevel.Lower
        : RadarLevel.Upper
      : level;
  const radarSrc = radar(record.mapName, Game.CS2, visibleLevel);

  useEffect(() => {
    let disposed = false;
    void client
      .send({
        name: RendererClientMessageName.FetchReviewPreview,
        payload: {
          checksum: record.checksum,
          roundNumber: record.roundNumber,
          startTick: record.startTick,
          endTick: record.endTick,
        },
      })
      .then((value) => {
        if (disposed) return;
        setData(value);
        setPlayback({ tick: value.positions[0]?.tick ?? value.startTick, playing: false });
      })
      .catch((error) => {
        logger.error(error);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [client, record.checksum, record.roundNumber, record.startTick, record.endTick, retry]);

  useEffect(() => {
    if (!playing || !data) return;
    let last = performance.now();
    let animation = 0;
    const animate = (now: number) => {
      const delta = Math.min(0.25, (now - last) / 1000) * data.tickrate * speed;
      last = now;
      setPlayback((current) => {
        const next = current.tick + delta;
        return next >= data.endTick
          ? { tick: loop ? data.startTick : data.endTick, playing: loop }
          : { tick: next, playing: current.playing };
      });
      animation = window.requestAnimationFrame(animate);
    };
    animation = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animation);
  }, [playing, data, speed, loop]);

  const jump = (next: number) => {
    setPlayback({ tick: next, playing: false });
  };
  const offset = ((tick - record.eventTick) / record.tickrate).toFixed(1);
  const events = record.timeline.filter((event) => event.kind !== 'shot' && event.kind !== 'utility').slice(0, 24);
  const query = new URLSearchParams({ player: record.steamId, tick: String(Math.floor(tick)) });

  return (
    <section className="flex min-w-0 flex-col gap-12 rounded-8 border border-gray-300 bg-gray-75 p-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h3 className="text-body-strong">
          <Trans>Instant 2D replay</Trans>
        </h3>
        <Link
          className="text-body text-accent"
          to={`${buildMatch2dViewerRoundPath(record.checksum, record.roundNumber)}?${query}`}
        >
          <Trans>Open full round</Trans>
        </Link>
      </div>
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-12">
          <span>
            <Trans>Could not load saved positions.</Trans>
          </span>
          <ReviewButton
            onClick={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            <Trans>Retry</Trans>
          </ReviewButton>
        </div>
      ) : !data ? (
        <p role="status">
          <Trans>Loading saved positions…</Trans>
        </p>
      ) : data.positions.length === 0 ? (
        <p>
          <Trans>No saved positions in this clip.</Trans>
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-16 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-12">
            {map && radarSrc ? (
              <svg
                viewBox={`0 0 ${map.radarSize} ${map.radarSize}`}
                className="aspect-square w-full rounded-8 bg-gray-100"
                role="img"
                aria-label={t`Recorded player positions and facing directions`}
              >
                <image href={radarSrc} width={map.radarSize} height={map.radarSize} />
                {frame?.players
                  .filter(
                    (player) =>
                      player.isAlive &&
                      Number.isFinite(player.x) &&
                      Number.isFinite(player.y) &&
                      (!map.lowerRadarFilePath ||
                        (player.z < map.thresholdZ ? RadarLevel.Lower : RadarLevel.Upper) === visibleLevel),
                  )
                  .map((player) => {
                    const x = getScaledCoordinateX(map, map.radarSize, player.x);
                    const y = getScaledCoordinateY(map, map.radarSize, player.y);
                    const angle = (-player.yaw * Math.PI) / 180;
                    const own = player.playerSteamId === record.steamId;
                    return (
                      <g
                        key={`${player.playerSteamId}:${player.playerName}`}
                        className={
                          own ? 'text-accent' : player.side === TeamNumber.CT ? 'text-blue-500' : 'text-orange-500'
                        }
                      >
                        {own && <circle cx={x} cy={y} r={15} fill="none" stroke="white" strokeWidth={3} />}
                        <circle cx={x} cy={y} r={9} fill="currentColor" stroke="white" strokeWidth={2} />
                        <line
                          x1={x}
                          y1={y}
                          x2={x + 24 * Math.cos(angle)}
                          y2={y + 24 * Math.sin(angle)}
                          stroke="currentColor"
                          strokeWidth={4}
                        />
                        <title>
                          {own ? t`You` : player.playerName} · {player.health} HP
                        </title>
                      </g>
                    );
                  })}
              </svg>
            ) : (
              <p>
                <Trans>Map radar is unavailable.</Trans>
              </p>
            )}
            <input
              type="range"
              aria-label={t`Review clip time`}
              className="w-full accent-accent"
              min={data.startTick}
              max={data.endTick}
              step={1}
              value={Math.floor(tick)}
              onChange={(event) => jump(Number(event.target.value))}
            />
            <div className="flex flex-wrap items-center gap-8">
              <ReviewButton
                primary={true}
                onClick={() => {
                  setPlayback({ tick: tick >= data.endTick ? data.startTick : tick, playing: !playing });
                }}
              >
                {playing ? <Trans>Pause</Trans> : <Trans>Play</Trans>}
              </ReviewButton>
              <ReviewButton pressed={loop} onClick={() => setLoop(!loop)}>
                <Trans>Loop clip</Trans>
              </ReviewButton>
              <ReviewButton onClick={() => setSpeed(speed === 1 ? 0.5 : speed === 0.5 ? 2 : 1)}>{speed}×</ReviewButton>
              <span className="text-caption tabular-nums">{offset} s</span>
            </div>
            {map?.lowerRadarFilePath && (
              <div className="flex flex-wrap gap-8">
                <ReviewButton pressed={level === 'auto'} onClick={() => setLevel('auto')}>
                  <Trans>Follow your floor</Trans>
                </ReviewButton>
                <ReviewButton pressed={level === RadarLevel.Upper} onClick={() => setLevel(RadarLevel.Upper)}>
                  <Trans>Upper floor</Trans>
                </ReviewButton>
                <ReviewButton pressed={level === RadarLevel.Lower} onClick={() => setLevel(RadarLevel.Lower)}>
                  <Trans>Lower floor</Trans>
                </ReviewButton>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-12">
            <div className="flex flex-wrap gap-12 text-caption">
              <span className="text-accent">
                <Trans>You</Trans>
              </span>
              <span className="text-blue-500">CT</span>
              <span className="text-orange-500">T</span>
            </div>
            <ReviewButton onClick={() => jump(record.eventTick)}>
              <Trans>Jump to death</Trans>
            </ReviewButton>
            {events.map((event) => {
              const seconds = event.seconds.toFixed(1);
              const labels = {
                death: t`Death`,
                kill: t`Kill`,
                'damage-taken': t`Damage taken`,
                'damage-dealt': t`Damage dealt`,
                blind: t`Blinded`,
                plant: t`Plant`,
                defuse: t`Defuse`,
                shot: t`Shot`,
                utility: t`Grenade`,
              };
              return (
                <button
                  type="button"
                  key={event.id}
                  className="flex items-center justify-between gap-8 rounded-8 bg-gray-100 p-12 text-left text-body hover:text-accent"
                  onClick={() => jump(Math.max(data.startTick, Math.min(data.endTick, event.tick)))}
                >
                  <span>
                    {labels[event.kind]}
                    {event.value === undefined ? '' : ` · ${Number(event.value.toFixed(1))}`}
                  </span>
                  <span className="text-caption tabular-nums">{seconds} s</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
