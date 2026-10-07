import React from 'react';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { FfmpegLocation } from './ffmpeg/ffmpeg-location';
import { HlaeLocation } from './hlae/hlae-location';
import { HlaeParameters } from 'csdm/ui/match/video/hlae/hlae-parameters';
import { Software } from 'csdm/ui/match/video/software';
import { HlaeInstallButton } from 'csdm/ui/match/video/hlae/hlae-install-button';
import { HlaeUpdateButton } from 'csdm/ui/match/video/hlae/hlae-update-button';
import { useInstalledHlaeVersion } from 'csdm/ui/match/video/hlae/use-installed-hlae-version';
import { FfmpegInstallButton } from 'csdm/ui/match/video/ffmpeg/ffmpeg-install-button';
import { FfmpegUpdateButton } from 'csdm/ui/match/video/ffmpeg/ffmpeg-update-button';
import { useInstalledFfmpegVersion } from 'csdm/ui/match/video/ffmpeg/use-installed-ffmpeg-version';

export function VideoSettings() {
  const hlaeVersion = useInstalledHlaeVersion();
  const ffmpegVersion = useInstalledFfmpegVersion();
  return (
    <SettingsView>
      <div className="flex flex-col gap-y-12">
        {window.csdm.isWindows && (
          <div>
            <Software name="HLAE" websiteLink="https://github.com/advancedfx/advancedfx" version={hlaeVersion}>
              <HlaeInstallButton />
              <HlaeUpdateButton />
            </Software>
            <div className="flex flex-col gap-y-8">
              <HlaeLocation />
              <HlaeParameters />
            </div>
          </div>
        )}
        <div>
          <Software name="FFmpeg" websiteLink="https://ffmpeg.org" version={ffmpegVersion}>
            <FfmpegInstallButton />
            <FfmpegUpdateButton />
          </Software>
          <FfmpegLocation />
        </div>
      </div>
    </SettingsView>
  );
}
