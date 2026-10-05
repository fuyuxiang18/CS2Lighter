import { ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { AiReportScope, AiResult, SaveAiConfiguration, AiVideoSource } from 'csdm/common/types/ai';
import { IPCChannel } from 'csdm/common/ipc-channel';
import { AiVault } from 'csdm/node/ai/ai-vault';
import { AiServiceError, getAiErrorCode } from 'csdm/node/ai/ai-error';
import { generateAiReport, getAiReportState } from 'csdm/node/ai/ai-report-service';
import { VideoAiReviews } from 'csdm/node/ai/video-ai-report-service';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { MainClientMessageName } from 'csdm/server/messages/main-client-message-name';
import type { WebSocketClient } from './web-socket/web-socket-client';
import { windowManager } from './window-manager';

let activeGenerations = 0;
export function hasAiReportInProgress() {
  return activeGenerations > 0;
}

export function registerAiReports(client: WebSocketClient) {
  const vault = new AiVault(path.join(getAppFolderPath(), 'ai-config.json'), safeStorage);
  const videoReviews = new VideoAiReviews();
  const prepare = (scope: AiReportScope) => {
    if (!client.isConnected) throw new AiServiceError('request-failed');
    return new Promise<Awaited<ReturnType<typeof client.send<'prepare-ai-report'>>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AiServiceError('request-timeout')), 120_000);
      void client
        .send({ name: MainClientMessageName.PrepareAiReport, payload: scope })
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  };
  const guard = async <T>(event: IpcMainInvokeEvent, action: () => Promise<T>): Promise<AiResult<T>> => {
    try {
      const window = windowManager.getMainWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new AiServiceError('invalid-scope');
      }
      return { ok: true, value: await action() };
    } catch (error) {
      return { ok: false, error: getAiErrorCode(error) };
    }
  };
  ipcMain.handle(IPCChannel.GetAiConfiguration, (event) => guard(event, () => vault.getConfiguration()));
  ipcMain.handle(IPCChannel.PrepareVideoAiReview, (event, source: AiVideoSource, locale: 'zh-CN' | 'en') =>
    guard(event, async () => {
      if (!client.isConnected) throw new AiServiceError('request-failed');
      activeGenerations++;
      try {
        const config = await vault.getConfiguration();
        const context = await new Promise<Awaited<ReturnType<typeof client.send<'prepare-video-ai-review'>>>>(
          (resolve, reject) => {
            const timer = setTimeout(() => reject(new AiServiceError('request-timeout')), 150_000);
            void client
              .send({ name: MainClientMessageName.PrepareVideoAiReview, payload: { source, locale } })
              .then(resolve, reject)
              .finally(() => clearTimeout(timer));
          },
        );
        return await videoReviews.prepare(context, config);
      } finally {
        activeGenerations--;
      }
    }),
  );
  ipcMain.handle(IPCChannel.GenerateVideoAiReview, (event, preparationId: string, regenerate = false) =>
    guard(event, async () => {
      activeGenerations++;
      try {
        const { config, apiKey } = await vault.getCredentials();
        return await videoReviews.generate(preparationId, config, apiKey, regenerate === true);
      } finally {
        activeGenerations--;
      }
    }),
  );
  ipcMain.handle(IPCChannel.SaveAiConfiguration, (event, input: SaveAiConfiguration) =>
    guard(event, () => vault.save(input)),
  );
  ipcMain.handle(IPCChannel.GetAiReport, (event, scope: AiReportScope) =>
    guard(event, async () => {
      const context = await prepare(scope);
      const config = await vault.getConfiguration();
      return config.model ? getAiReportState(context, config) : { preview: context.preview, report: null };
    }),
  );
  ipcMain.handle(IPCChannel.GenerateAiReport, (event, scope: AiReportScope, regenerate = false) =>
    guard(event, async () => {
      activeGenerations++;
      try {
        const { config, apiKey } = await vault.getCredentials();
        const context = await prepare(scope);
        return await generateAiReport(context, config, apiKey, regenerate === true);
      } finally {
        activeGenerations--;
      }
    }),
  );
}
