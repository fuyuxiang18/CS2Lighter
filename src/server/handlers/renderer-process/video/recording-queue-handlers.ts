import type { AddToRecordingQueue, ControlRecordingQueue } from 'csdm/common/types/recording-queue';
import { recordingQueue } from 'csdm/node/video/review-clips/recording-queue';
export const getRecordingQueueHandler = () => recordingQueue.get();
export const addToRecordingQueueHandler = (request: AddToRecordingQueue) => recordingQueue.add(request);
export const controlRecordingQueueHandler = (request: ControlRecordingQueue) => recordingQueue.control(request);
