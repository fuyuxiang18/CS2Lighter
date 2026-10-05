import React from 'react';
import { Trans } from '@lingui/react/macro';
import type { VideoAiFrame, VideoAiReport } from 'csdm/common/types/ai';

export function VideoAiReportContent({
  report,
  frames,
  onFrame,
}: {
  report: VideoAiReport;
  frames: VideoAiFrame[];
  onFrame: (frame: VideoAiFrame) => void;
}) {
  const links = (ids: string[]) => (
    <div className="flex flex-wrap gap-8">
      {ids.map((id) => {
        const frame = frames.find((item) => item.id === id);
        if (!frame) return null;
        const seconds = frame.videoSeconds.toFixed(2);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onFrame(frame)}
            className="rounded-4 border border-accent-muted px-8 py-4 text-caption text-accent hover:bg-accent-soft"
          >
            {id} · <Trans>{seconds}s</Trans>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-20 text-body">
      <p className="rounded-8 bg-gray-200 p-12 text-caption text-gray-700">
        <Trans>
          Model interpretation, not a verdict. Check the cited frames and keep only advice that fits the information
          available in the match.
        </Trans>
      </p>
      <div className="flex flex-col gap-8">
        <p className="wrap-break-word">{report.content.summary.text}</p>
        {links(report.content.summary.frameIds)}
      </div>
      <div className="flex flex-col gap-8">
        <h4 className="font-semibold">
          <Trans>Choices in this encounter</Trans>
        </h4>
        <p className="wrap-break-word">{report.content.style.text}</p>
        {links(report.content.style.frameIds)}
      </div>
      <div className="flex flex-col gap-12">
        <h4 className="font-semibold">
          <Trans>Observe → interpret → try an alternative</Trans>
        </h4>
        {report.content.timeline.map((point, index) => (
          <article key={index} className="flex flex-col gap-10 rounded-8 border border-gray-300 p-16">
            <p className="text-caption font-semibold text-accent">
              {point.information === 'player-visible' ? (
                <Trans>Player-visible evidence</Trans>
              ) : point.information === 'opponent-hindsight' ? (
                <Trans>Opponent view · Hindsight only</Trans>
              ) : (
                <Trans>Information uncertain</Trans>
              )}
            </p>
            {links(point.frameIds)}
            <p className="wrap-break-word">
              <strong>
                <Trans>Observation</Trans>:{' '}
              </strong>
              {point.observation}
            </p>
            <p className="wrap-break-word">
              <strong>
                <Trans>Interpretation</Trans>:{' '}
              </strong>
              {point.inference}
            </p>
            <p className="wrap-break-word">
              <strong>
                <Trans>Alternative action</Trans>:{' '}
              </strong>
              {point.alternative}
            </p>
            <p className="text-caption wrap-break-word text-gray-700">
              <Trans>Uncertainty</Trans>: {point.uncertainty}
            </p>
          </article>
        ))}
      </div>
      <div className="flex flex-col gap-12">
        <h4 className="font-semibold">
          <Trans>One comparable situation to practice</Trans>
        </h4>
        {report.content.practice.map((practice, index) => (
          <div key={index} className="flex flex-col gap-8 rounded-8 bg-gray-200 p-16">
            <p className="wrap-break-word">{practice.action}</p>
            <p className="text-caption wrap-break-word text-gray-700">
              <Trans>Next-match check</Trans>: {practice.check}
            </p>
            {links(practice.frameIds)}
          </div>
        ))}
      </div>
      <details className="text-caption text-gray-700">
        <summary className="cursor-pointer">
          <Trans>What remains uncertain</Trans>
        </summary>
        <ul className="mt-10 flex list-inside list-disc flex-col gap-8">
          {report.content.limitations.map((item, index) => (
            <li key={index} className="wrap-break-word">
              {item}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
