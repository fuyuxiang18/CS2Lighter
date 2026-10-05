import React, { useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { AiConfiguration } from 'csdm/common/types/ai';
import {
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  MAX_AI_MAX_OUTPUT_TOKENS,
  isAiMaxOutputTokens,
} from 'csdm/common/ai-token-limit';
import { Select } from 'csdm/ui/components/inputs/select';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import { ReviewButton } from 'csdm/ui/habits/review-button';
import { SettingsView } from '../settings-view';

export function AiSettings() {
  const { t, i18n } = useLingui();
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [savedBaseUrl, setSavedBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [tokenLimitDraft, setTokenLimitDraft] = useState(String(DEFAULT_AI_MAX_OUTPUT_TOKENS));
  const [tokenLimitError, setTokenLimitError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const maximumTokenLimit = new Intl.NumberFormat(i18n.locale).format(MAX_AI_MAX_OUTPUT_TOKENS);
  const defaultTokenLimit = new Intl.NumberFormat(i18n.locale).format(DEFAULT_AI_MAX_OUTPUT_TOKENS);
  useEffect(() => {
    let canceled = false;
    void window.csdm
      .getAiConfiguration()
      .then((result) => {
        if (canceled) return;
        if (result.ok) {
          setConfiguration(result.value);
          setSavedBaseUrl(result.value.baseUrl);
          setTokenLimitDraft(String(result.value.maxOutputTokens));
        } else setMessage(t`AI settings could not be read. Check local storage permissions.`);
      })
      .catch(() => {
        if (!canceled) setMessage(t`AI settings could not be read. Check local storage permissions.`);
      });
    return () => {
      canceled = true;
    };
  }, [t]);
  const save = async () => {
    if (!configuration || busy) return;
    const tokenText = tokenLimitDraft.trim();
    const maxOutputTokens = Number(tokenText);
    if (!/^\d+$/.test(tokenText) || !isAiMaxOutputTokens(maxOutputTokens)) {
      setTokenLimitError(true);
      setMessage('');
      return;
    }
    setTokenLimitError(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await window.csdm.saveAiConfiguration({
        ...configuration,
        maxOutputTokens,
        ...(apiKey ? { apiKey } : {}),
        clearApiKey,
      });
      if (result.ok) {
        setConfiguration(result.value);
        setSavedBaseUrl(result.value.baseUrl);
        setTokenLimitDraft(String(result.value.maxOutputTokens));
        setApiKey('');
        setClearApiKey(false);
        setMessage(t`Saved. Generate a review from My playing style or a match in the Match notebook.`);
        window.dispatchEvent(new Event('ai-configuration-updated'));
      } else {
        setMessage(
          result.error === 'secure-storage-unavailable'
            ? t`Encrypted storage is unavailable. The key was not saved.`
            : t`Could not save AI settings. Use an HTTPS API address, or a local loopback address, and enter a model name.`,
        );
      }
    } catch {
      setMessage(t`AI settings could not be saved. Please try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsView>
      <div className="flex min-w-0 flex-col gap-20 p-16">
        <h1 className="text-heading font-semibold">
          <Trans>AI reviews</Trans>
        </h1>
        <p className="text-gray-700">
          <Trans>
            Choose a cloud API or a local Ollama model. Reviews are generated only when you click, and saved on this
            device.
          </Trans>
        </p>
        {configuration && (
          <>
            <Select
              label={t`AI provider`}
              value={configuration.provider}
              isDisabled={busy}
              options={[
                { value: 'openai-compatible', label: t`OpenAI-compatible API` },
                { value: 'ollama', label: t`Local Ollama` },
              ]}
              onChange={(provider) => {
                setConfiguration({
                  ...configuration,
                  provider,
                  baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1',
                  model: '',
                  hasApiKey: false,
                });
                setApiKey('');
                setClearApiKey(true);
                setMessage('');
              }}
            />
            <TextInput
              label={t`API base URL`}
              value={configuration.baseUrl}
              isDisabled={busy}
              onChange={(event) => setConfiguration({ ...configuration, baseUrl: event.target.value })}
            />
            <TextInput
              label={t`Model name`}
              value={configuration.model}
              isDisabled={busy}
              placeholder={
                configuration.provider === 'ollama'
                  ? t`Exact name of an installed Ollama model`
                  : t`Model available from your API provider`
              }
              onChange={(event) => setConfiguration({ ...configuration, model: event.target.value })}
            />
            <TextInput
              label={t`Output token limit`}
              value={tokenLimitDraft}
              isDisabled={busy}
              onChange={(event) => {
                setTokenLimitDraft(event.target.value);
                setTokenLimitError(false);
                setMessage('');
              }}
            />
            {tokenLimitError && (
              <p role="alert" className="text-caption text-red-500">
                <Trans>
                  Enter a whole number from 1 to {maximumTokenLimit} tokens. Your settings have not been saved.
                </Trans>
              </p>
            )}
            <div className="flex flex-col gap-10">
              <p className="text-caption text-gray-700">
                <Trans>
                  Default: {defaultTokenLimit} tokens. This limit applies to personal, single-match and video AI
                  reviews.
                </Trans>
              </p>
              <p className="text-caption text-gray-700">
                <Trans>
                  This is a maximum output budget, not a required response length. Higher limits can take longer; your
                  provider or model may enforce a lower limit.
                </Trans>
              </p>
              <div className="self-start">
                <ReviewButton
                  disabled={busy}
                  onClick={() => {
                    setTokenLimitDraft(String(DEFAULT_AI_MAX_OUTPUT_TOKENS));
                    setTokenLimitError(false);
                    setMessage('');
                  }}
                >
                  <Trans>Reset token limit to default</Trans>
                </ReviewButton>
              </div>
            </div>
            <TextInput
              label={
                configuration.hasApiKey && !clearApiKey && configuration.baseUrl === savedBaseUrl
                  ? t`API key · already saved (leave blank to keep)`
                  : configuration.provider === 'ollama'
                    ? t`API key · optional for local models`
                    : t`API key`
              }
              type="password"
              value={apiKey}
              isDisabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-caption text-gray-600">
              <Trans>
                Keys use operating-system encryption. Changing the API address removes the previous key; enter the key
                for the new server. Keys are never included in reports.
              </Trans>
            </p>
            <div className="flex flex-wrap gap-12">
              <ReviewButton primary={true} disabled={busy || !configuration.model.trim()} onClick={() => void save()}>
                {busy ? <Trans>Saving…</Trans> : <Trans>Save AI settings</Trans>}
              </ReviewButton>
              {configuration.hasApiKey && (
                <ReviewButton
                  disabled={busy}
                  onClick={() => {
                    setClearApiKey(true);
                    setApiKey('');
                    setMessage(t`The saved key will be removed when you save these settings.`);
                  }}
                >
                  <Trans>Remove saved key</Trans>
                </ReviewButton>
              )}
            </div>
            <div className="rounded-12 border border-gray-300 bg-gray-100 p-20 text-gray-700">
              {configuration.provider === 'ollama' ? (
                <Trans>
                  Start Ollama before generating. Statistics reviews use text; video reviews need a vision-capable model
                  supporting image inputs and JSON responses. Local mode accepts only loopback addresses.
                </Trans>
              ) : (
                <Trans>
                  Your API service may charge for generation. Statistics reviews send numeric facts. Video reviews send
                  the exact preview images and round facts after you click Send; images may contain visible nicknames,
                  avatars or chat. Full demos and videos stay on this device.
                </Trans>
              )}
            </div>
          </>
        )}
        {message && (
          <p role="status" className="text-gray-800">
            {message}
          </p>
        )}
      </div>
    </SettingsView>
  );
}
