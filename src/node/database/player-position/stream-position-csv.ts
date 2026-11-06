import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/** Parse one complete RFC 4180 record. An unfinished quoted field requests the next physical line. */
function parseRecord(record: string): string[] | undefined {
  const values: string[] = [];
  let start = 0;
  while (start <= record.length) {
    if (record[start] !== '"') {
      const comma = record.indexOf(',', start);
      const end = comma === -1 ? record.length : comma;
      const quote = record.indexOf('"', start);
      if (quote !== -1 && quote < end) throw new Error('Unexpected quote in position CSV');
      const valueEnd = comma === -1 && record[end - 1] === '\r' ? end - 1 : end;
      values.push(record.slice(start, valueEnd));
      if (comma === -1) return values;
      start = comma + 1;
      continue;
    }
    let segmentStart = start + 1;
    let escaped: string | undefined;
    while (true) {
      const quote = record.indexOf('"', segmentStart);
      if (quote === -1) return undefined;
      if (record[quote + 1] === '"') {
        escaped = (escaped ?? '') + record.slice(segmentStart, quote) + '"';
        segmentStart = quote + 2;
        continue;
      }
      values.push((escaped ?? '') + record.slice(segmentStart, quote));
      const next = quote + 1;
      if (next === record.length || (next === record.length - 1 && record[next] === '\r')) return values;
      if (record[next] !== ',') throw new Error('Unexpected data after quoted position CSV field');
      start = next + 1;
      break;
    }
  }
  return values;
}

/** The analyzer's CSV contract, with quoted commas, escaped quotes, UTF-8 and multiline names preserved. */
export async function streamPositionCsv(
  filePath: string,
  consume: (columns: string[], recordBytes: number) => void | Promise<void>,
  chunkSize = 64 * 1024,
) {
  const source = createReadStream(filePath, { highWaterMark: chunkSize });
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let pendingRecord = '';
  function readLine(line: string): void | Promise<void> {
    const record = pendingRecord + line;
    if (record === '' || record === '\r') return;
    const recordBytes = Buffer.byteLength(record);
    if (recordBytes > 4 * 1024 * 1024) throw new Error('Position CSV record exceeds its size limit');
    const values = parseRecord(record);
    if (values === undefined) {
      pendingRecord = record + '\n';
      return;
    }
    pendingRecord = '';
    return consume(values, recordBytes);
  }
  try {
    for await (const chunk of source) {
      buffer += decoder.write(chunk);
      let start = 0;
      let end: number;
      while ((end = buffer.indexOf('\n', start)) !== -1) {
        const pending = readLine(buffer.slice(start, end));
        if (pending !== undefined) await pending;
        start = end + 1;
      }
      buffer = buffer.slice(start);
      if (Buffer.byteLength(buffer) + Buffer.byteLength(pendingRecord) > 4 * 1024 * 1024)
        throw new Error('Position CSV record exceeds its size limit');
    }
    buffer += decoder.end();
    if (buffer !== '' || pendingRecord !== '') await readLine(buffer);
    if (pendingRecord !== '') throw new Error('Unterminated quoted position CSV field');
  } finally {
    source.destroy();
  }
}
