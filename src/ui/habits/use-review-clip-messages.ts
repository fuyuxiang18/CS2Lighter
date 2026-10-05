import { useLingui } from '@lingui/react/macro';
import type { ReviewClipIssue, ReviewClipStatus } from 'csdm/common/types/review-clip';

export function useReviewClipMessages() {
  const { t } = useLingui();
  const statuses: Record<ReviewClipStatus, string> = {
    missing: t`Not recorded`,
    queued: t`Waiting to record`,
    preparing: t`Preparing CS2`,
    recording: t`Recording the selected perspectives…`,
    encoding: t`Editing and saving the video…`,
    ready: t`Saved locally`,
    failed: t`Recording failed`,
    canceled: t`Recording canceled`,
  };
  const issues: Partial<Record<ReviewClipIssue, string>> = {
    'unsupported-platform': t`Clip recording currently requires Windows.`,
    'cs2-missing': t`Choose your CS2 installation in Playback settings.`,
    'hlae-missing': t`Install HLAE in Video settings to record the game.`,
    'ffmpeg-missing': t`Install FFmpeg in Video settings to save MP4 clips.`,
    'steam-not-running': t`Start Steam, then check again.`,
    'game-running': t`Close CS2 before recording. Your running game will not be stopped automatically.`,
    'game-files-conflict': t`An unfinished replay setup was found in the game folder. Finish or restore that setup before recording.`,
    'queue-busy': t`Another video is being recorded. Wait for it to finish.`,
    'demo-missing': t`The original demo is missing. Restore it to its imported folder.`,
    'demo-changed': t`The demo changed since import. Import the new file before recording.`,
    'invalid-request': t`This event has no valid recording range. Choose another event.`,
    'incompatible-path': t`Recording requires a writable path without special characters. Check the app and game locations.`,
    'insufficient-space': t`There is not enough free space for the recording.`,
    'recording-failed': t`CS2 recording failed. Check game compatibility and HLAE, then retry.`,
    'output-missing': t`No playable video was produced. Check CS2 and recording tools, then retry.`,
    interrupted: t`Recording was interrupted. You can retry this clip.`,
    'update-maintenance': t`An update is being installed. Retry after the app restarts.`,
  };
  return {
    statuses,
    issueText: (issue: ReviewClipIssue) => issues[issue] ?? t`Recording failed. Check the recording setup and retry.`,
  };
}

export function isReviewRecordingActive(status: ReviewClipStatus) {
  return ['queued', 'preparing', 'recording', 'encoding'].includes(status);
}
