import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { AiConfiguration, AiErrorCode, AiReportScope, AiReportState } from 'csdm/common/types/ai';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useLocale } from 'csdm/ui/settings/ui/use-locale';
import { AiReportContent } from './ai-report-content';
import { ReviewButton } from './review-button';

type Props = {
  scope: Omit<AiReportScope, 'locale'>;
  onConfigure: () => void;
};

export function AiReviewPanel({ scope, onConfigure }: Props) {
  const locale = useLocale();
  const { kind, steamId, checksum, mapName, side, source } = scope;
  const localizedScope = useMemo<AiReportScope>(
    () => ({ kind, steamId, checksum, mapName, side, source, locale: locale === 'zh-CN' ? 'zh-CN' : 'en' }),
    [kind, steamId, checksum, mapName, side, source, locale],
  );
  return <ReviewPanel key={JSON.stringify(localizedScope)} scope={localizedScope} onConfigure={onConfigure} />;
}

function ReviewPanel({ scope, onConfigure }: { scope: AiReportScope; onConfigure: () => void }) {
  const { t } = useLingui();
  const formatDate = useFormatDate();
  const [state, setState] = useState<AiReportState | null>(null);
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [error, setError] = useState<AiErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refreshed, setRefreshed] = useState(0);
  const [fromCache, setFromCache] = useState(true);
  const requestNumber = useRef(0);

  const refresh = useCallback(() => {
    requestNumber.current++;
    setError(null);
    setLoading(true);
    setGenerating(false);
    setFromCache(true);
    setState(null);
    setRefreshed((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('ai-configuration-updated', refresh);
    return () => window.removeEventListener('ai-configuration-updated', refresh);
  }, [refresh]);

  useEffect(() => {
    const request = ++requestNumber.current;
    let cancelled = false;

    const load = async () => {
      try {
        const [configResult, reportResult] = await Promise.all([
          window.csdm.getAiConfiguration(),
          window.csdm.getAiReport(scope),
        ]);
        if (cancelled || request !== requestNumber.current) return;
        if (configResult.ok) setConfiguration(configResult.value);
        else {
          setConfiguration(null);
          setError(configResult.error);
        }
        if (reportResult.ok) setState(reportResult.value);
        else setError(reportResult.error);
      } catch {
        if (!cancelled && request === requestNumber.current) setError('request-failed');
      } finally {
        if (!cancelled && request === requestNumber.current) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [scope, refreshed]);

  const generate = async () => {
    if (generating || loading) return;
    const request = ++requestNumber.current;
    setGenerating(true);
    setError(null);
    try {
      const result = await window.csdm.generateAiReport(scope, Boolean(state?.report));
      if (request !== requestNumber.current) return;
      if (result.ok) {
        setState(result.value);
        setFromCache(false);
      } else {
        setError(result.error);
      }
    } catch {
      if (request === requestNumber.current) setError('request-failed');
    } finally {
      if (request === requestNumber.current) setGenerating(false);
    }
  };

  const errorMessages: Record<AiErrorCode, string> = {
    'invalid-configuration': t`Set an AI provider, server address and model before generating a review.`,
    'secure-storage-unavailable': t`Encrypted key storage is unavailable on this device. Check the AI settings.`,
    'key-unavailable': t`The API key is missing or could not be read. Save it in the AI settings.`,
    'invalid-scope': t`This player or match is not available for an AI review.`,
    'no-data': t`No usable rounds match this selection. Import demos or change the filters first.`,
    'request-failed': t`The AI request failed. Check the server address, model and credentials, then try again.`,
    'request-timeout': t`The model did not respond in time. Try again or choose a faster model.`,
    'invalid-response': t`The model returned a report that could not be verified. It was not saved. Try another model or retry.`,
    'storage-failed': t`The report could not be saved locally. Check available disk space and try again.`,
    busy: t`Another AI review is being generated. Wait for it to finish, then refresh this panel.`,
  };
  const report = state?.report;
  const preview = state?.preview;
  const configured = Boolean(configuration?.model.trim());
  const target = configuration?.provider === 'ollama' ? t`Ollama` : t`OpenAI-compatible API`;
  const serverHost = configuration ? new URL(configuration.baseUrl).hostname : '';
  const model = configuration?.model ?? '';
  const matchCount = preview?.matchCount ?? 0;
  const roundCount = preview?.roundCount ?? 0;
  const evidenceCount = preview?.evidenceCount ?? 0;
  const availableMatchCount = preview?.availableMatchCount ?? 0;
  const canGenerate = !loading && !generating && configured && roundCount > 0;

  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
      <header className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <h2 className="text-subtitle font-semibold">
            {scope.kind === 'match' ? <Trans>AI match review</Trans> : <Trans>AI personal review</Trans>}
          </h2>
          <p className="text-body text-gray-700">
            <Trans>Turn your recorded situations into a small set of actions to verify in the next match.</Trans>
          </p>
        </div>
        <ReviewButton onClick={onConfigure}>
          <Trans>AI settings</Trans>
        </ReviewButton>
      </header>

      <div className="flex flex-col gap-10 rounded-8 bg-gray-200 p-16 text-body">
        <p className="font-semibold">
          <Trans>Statistics and sampled rounds only · No POV images sent</Trans>
        </p>
        <p className="text-caption text-gray-700">
          <Trans>
            Generation sends aggregate numbers and sampled round events to your configured AI server. Demo files,
            videos, account IDs and player names are not sent. The model cannot judge pre-aim or mouse control from this
            input.
          </Trans>
        </p>
        {configured && (
          <p className="text-caption wrap-break-word text-gray-800">
            <Trans>
              Generation target: {target} · {serverHost} · {model}
            </Trans>
          </p>
        )}
        {preview && (
          <p className="text-caption text-gray-800">
            <Plural value={matchCount} one="# match" other="# matches" /> ·{' '}
            <Plural value={roundCount} one="# round" other="# rounds" /> ·{' '}
            <Plural value={evidenceCount} one="# sampled evidence round" other="# sampled evidence rounds" />
            {availableMatchCount > matchCount && (
              <span className="ml-8 text-gray-700">
                <Trans>Selected from {availableMatchCount} matching matches.</Trans>
              </span>
            )}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-8 border border-red-400 p-12 text-body text-red-500">
          {errorMessages[error]}
        </p>
      )}

      {loading ? (
        <p role="status" className="text-body text-gray-700">
          <Trans>Checking the local report cache…</Trans>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-12">
          <ReviewButton primary={true} disabled={!canGenerate} onClick={() => void generate()}>
            {generating ? (
              <Trans>Generating review…</Trans>
            ) : report ? (
              <Trans>Regenerate review</Trans>
            ) : (
              <Trans>Generate review</Trans>
            )}
          </ReviewButton>
          <ReviewButton disabled={generating} onClick={refresh}>
            <Trans>Refresh local report</Trans>
          </ReviewButton>
          {!configured && (
            <p className="text-caption text-gray-700">
              <Trans>Choose a provider and model in AI settings to start.</Trans>
            </p>
          )}
          {configured && !report && roundCount > 0 && (
            <p className="text-caption text-gray-700">
              <Trans>No report is cached for this sample and model. Generation starts only when you click.</Trans>
            </p>
          )}
        </div>
      )}

      {generating && (
        <p role="status" className="text-caption text-gray-700">
          <Trans>
            Waiting for the model, then checking its evidence references. This may take a while on a local model.
          </Trans>
        </p>
      )}

      {report && (
        <>
          <div className="flex flex-wrap gap-8 border-t border-gray-300 pt-16 text-caption text-gray-700">
            <span>{fromCache ? <Trans>Saved report</Trans> : <Trans>Newly generated · Saved locally</Trans>}</span>
            <span>· {formatDate(report.generatedAt)}</span>
            <span className="wrap-break-word">· {report.model}</span>
            <span>· {report.provider === 'ollama' ? t`Ollama` : t`OpenAI-compatible API`}</span>
          </div>
          <AiReportContent report={report} />
        </>
      )}
    </section>
  );
}
