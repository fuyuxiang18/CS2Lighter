import { open } from 'node:fs/promises';

/**
 * Checks the Source 2 command framing without decoding entity data. A paused download can have a valid header,
 * so automatic imports also require a DEM_Stop command and complete payloads leading up to it.
 * This is a readiness check, not a replacement for the analyzer's validation of the payloads.
 */
export async function hasCompleteSource2Demo(filePath: string): Promise<boolean> {
  const file = await open(filePath, 'r');
  try {
    const { size: fileSize } = await file.stat();
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let bufferStart = 0;
    let bufferEnd = 0;

    async function readByte(): Promise<number | undefined> {
      if (position >= fileSize) {
        return undefined;
      }
      if (position < bufferStart || position >= bufferEnd) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        bufferStart = position;
        bufferEnd = position + bytesRead;
        if (bytesRead === 0) {
          return undefined;
        }
      }

      const value = buffer[position - bufferStart];
      position += 1;
      return value;
    }

    async function readVarInt(): Promise<number | undefined> {
      let value = 0;
      for (let index = 0; index < 5; index++) {
        const byte = await readByte();
        if (byte === undefined || (index === 4 && byte > 15)) {
          return undefined;
        }
        value += (byte & 127) * 2 ** (index * 7);
        if ((byte & 128) === 0) {
          return value;
        }
      }
      return undefined;
    }

    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    bufferEnd = bytesRead;
    if (bytesRead < 16 || buffer.toString('ascii', 0, 8) !== 'PBDEMS2\0') {
      return false;
    }
    position = 16;
    let firstCommand = true;
    while (position < fileSize) {
      const command = await readVarInt();
      const tick = await readVarInt();
      if (command === undefined || tick === undefined) {
        return false;
      }
      const commandType = command & ~64; // DEM_IsCompressed
      if (firstCommand && commandType !== 1) {
        return false;
      }
      firstCommand = false;
      if (commandType === 0) {
        return true;
      }
      const payloadSize = await readVarInt();
      if (payloadSize === undefined || payloadSize > fileSize - position) {
        return false;
      }
      position += payloadSize;
    }
    return false;
  } finally {
    await file.close();
  }
}
