import React, { useEffect, useRef, useState } from 'react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type {
  AiConfiguration,
  AiErrorCode,
  AiVideoSource,
  VideoAiFrame,
  VideoAiReviewState,
} from 'csdm/common/types/ai';
import { useLocale } from 'csdm/ui/settings/ui/use-locale';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { ReviewButton } from './review-button';
import { useAiErrorMessage } from './use-ai-error-message';
import { VideoAiReportContent } from './video-ai-report-content';

type Props = { source: AiVideoSource; onConfigure: () => void; onSeek?: (seconds: number) => void };

export function VideoAiReviewPanel(props: Props) {
  const locale = useLocale() === 'zh-CN' ? 'zh-CN' : 'en';
  return <VideoReviewPanel key={JSON.stringify([props.source, locale])} {...props} locale={locale} />;
}

function VideoReviewPanel({ source, onConfigure, onSeek, locale }: Props & { locale: 'zh-CN' | 'en' }) {
  const { t } = useLingui();
  const errorMessage = useAiErrorMessage();
  const formatDate = useFormatDate();
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [state, setState] = useState<VideoAiReviewState | null>(null);
  const [error, setError] = useState<AiErrorCode | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'generate' | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<VideoAiFrame | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const requestNumber = useRef(0);

  useEffect(() => {
    let disposed = false;
    let configRequest = 0;
    const invalidate = () => {
      requestNumber.current++;
    };
    const refresh = () => {
      const currentConfigRequest = ++configRequest;
      invalidate();
      setConfiguration(null);
      setState(null);
      setSelectedFrame(null);
      setError(null);
      setBusy(null);
      void window.csdm
        .getAiConfiguration()
        .then((result) => {
          if (disposed || currentConfigRequest !== configRequest) return;
          if (result.ok) setConfiguration(result.value);
          else setError(result.error);
        })
        .catch(() => {
          if (!disposed && currentConfigRequest === configRequest) setError('request-failed');
        });
    };
    refresh();
    window.addEventListener('ai-configuration-updated', refresh);
    return () => {
      disposed = true;
      invalidate();
      window.removeEventListener('ai-configuration-updated', refresh);
    };
  }, []);

  const prepare = async () => {
    if (busy) return;
    const request = ++requestNumber.current;
    setBusy('prepare');
    setError(null);
    setState(null);
    setSelectedFrame(null);
    try {
      const result = await window.csdm.prepareVideoAiReview(source, locale);
      if (request !== requestNumber.current) return;
      if (result.ok) {
        setState(result.value);
        setSelectedFrame(result.value.frames[0] ?? null);
      } else setError(result.error);
    } catch {
      if (request === requestNumber.current) setError('request-failed');
    } finally {
      if (request === requestNumber.current) setBusy(null);
    }
  };
  const generate = async () => {
    if (busy || !state) return;
    const request = ++requestNumber.current;
    setBusy('generate');
    setError(null);
    try {
      const result = await window.csdm.generateVideoAiReview(state.preparationId, Boolean(state.report));
      if (request !== requestNumber.current) return;
      if (result.ok) setState(result.value);
      else setError(result.error);
    } catch {
      if (request === requestNumber.current) setError('request-failed');
    } finally {
      if (request === requestNumber.current) setBusy(null);
    }
  };
  const inspectFrame = (frame: VideoAiFrame) => {
    setSelectedFrame(frame);
    onSeek?.(frame.videoSeconds);
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const configured = Boolean(configuration?.model.trim());
  const target = configuration?.provider === 'ollama' ? t`Ollama` : t`OpenAI-compatible API`;
  const serverHost = configuration ? new URL(configuration.baseUrl).hostname : '';
  const model = configuration?.model ?? '';
  const frameCount = state?.frames.length ?? 0;
  const hasOpponent = state?.frames.some((frame) => frame.perspective === 'opponent');
  const report = state?.report;
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
      <header className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <h3 className="text-subtitle font-semibold">
            <Trans>AI video review</Trans>
          </h3>
          <p className="text-body text-gray-700">
            <Trans>Key moments, choices and alternative plays.</Trans>
          </p>
        </div>
        <ReviewButton onClick={onConfigure}>
          <Trans>AI settings</Trans>
        </ReviewButton>
      </header>
      {configured && (
        <p className="text-caption wrap-break-word text-gray-800">
          <Trans>
            Generation target: {target} · {serverHost} · {model}
          </Trans>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-12">
        <ReviewButton disabled={busy !== null} onClick={() => void prepare()}>
          {busy === 'prepare' ? <Trans>Preparing frame preview…</Trans> : <Trans>Preview frames for AI</Trans>}
        </ReviewButton>
        {!configured && (
          <p className="text-caption text-gray-700">
            <Trans>Choose a provider and model in AI settings to start.</Trans>
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-8 border border-red-400 p-12 text-body text-red-500">
          {errorMessage(error)}
        </p>
      )}
      {state && (
        <>
          <div className="flex flex-col gap-8 rounded-8 bg-gray-200 p-16 text-caption text-gray-800">
            <p className="font-semibold">
              <Plural value={frameCount} one="# exact image for this request" other="# exact images for this request" />
            </p>
            <p>
              <Trans>
                Send these preview images and round facts to the selected server. Images may contain nicknames, avatars
                or chat.
              </Trans>
            </p>
            <p>{hasOpponent ? <Trans>Player and opponent perspectives</Trans> : <Trans>Player perspective</Trans>}</p>
          </div>
          {selectedFrame && (
            <figure ref={previewRef} className="flex min-w-0 flex-col gap-8">
              <img className="w-full rounded-8" src={selectedFrame.dataUrl} alt={t`Selected preview frame`} />
              <figcaption className="text-caption text-gray-700">
                <FrameLabel frame={selectedFrame} />
              </figcaption>
            </figure>
          )}
          <div className="grid grid-cols-3 gap-10">
            {state.frames.map((frame) => (
              <button
                type="button"
                key={frame.id}
                aria-pressed={selectedFrame?.id === frame.id}
                onClick={() => inspectFrame(frame)}
                className={`flex min-w-0 flex-col gap-8 rounded-8 border p-8 text-left text-caption ${selectedFrame?.id === frame.id ? 'border-accent bg-accent-soft' : 'border-gray-300 hover:border-accent-muted'}`}
              >
                <img className="w-full rounded-4" src={frame.dataUrl} alt={t`Sampled video frame`} />
                <span className="wrap-break-word">
                  <FrameLabel frame={frame} />
                </span>
              </button>
            ))}
          </div>
          <details className="rounded-8 border border-gray-300 p-12 text-caption">
            <summary className="cursor-pointer font-medium">
              <Trans>Exact round facts and frame metadata sent with the images</Trans>
            </summary>
            <p className="mt-10 text-gray-700">
              <Trans>Up to six frames per view. Event totals cover the entire round.</Trans>
            </p>
            <pre className="mt-10 max-w-full overflow-auto wrap-break-word whitespace-pre-wrap text-gray-700">
              {JSON.stringify(state.payload, null, 2)}
            </pre>
          </details>
          <div className="flex flex-wrap items-center gap-12">
            <ReviewButton primary={true} disabled={!configured || busy !== null} onClick={() => void generate()}>
              {busy === 'generate' ? (
                <Trans>Reviewing the sampled frames…</Trans>
              ) : report ? (
                <Trans>Send frames and regenerate</Trans>
              ) : (
                <Trans>Send frames and review</Trans>
              )}
            </ReviewButton>
            <p className="text-caption text-gray-700">
              <Trans>One request to the configured vision model. Cloud image inputs may incur API charges.</Trans>
            </p>
          </div>
          {busy === 'generate' && (
            <p role="status" className="text-caption text-gray-700">
              <Trans>Analyzing the sampled frames…</Trans>
            </p>
          )}
          {report && (
            <>
              <p className="border-t border-gray-300 pt-16 text-caption text-gray-700">
                <Trans>Saved locally</Trans> · {formatDate(report.generatedAt)} · {report.model}
              </p>
              <VideoAiReportContent report={report} frames={state.frames} onFrame={inspectFrame} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function FrameLabel({ frame }: { frame: VideoAiFrame }) {
  const seconds = frame.videoSeconds.toFixed(2);
  const tick = frame.demoTick;
  return (
    <>
      {frame.id} · {frame.perspective === 'player' ? <Trans>Player POV</Trans> : <Trans>Opponent POV</Trans>} ·{' '}
      <Trans>
        {seconds}s · tick {tick}
      </Trans>
    </>
  );
}
