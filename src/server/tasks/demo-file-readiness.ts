type Observation = {
  fingerprint: string;
  stableSince: number;
};

export type DemoImportRecord = {
  fingerprint: string;
  checksum?: string;
  failed: boolean;
  reason?: string;
  message?: string;
};

export function shouldSkipDemoImport(
  record: DemoImportRecord | undefined,
  fingerprint: string,
  knownChecksums: Set<string>,
) {
  return (
    record?.fingerprint === fingerprint &&
    (record.failed || (record.checksum !== undefined && knownChecksums.has(record.checksum)))
  );
}

export function getDemoFileFingerprint(stats: { size: number; mtimeMs: number }) {
  return `${stats.size}:${stats.mtimeMs}`;
}

/** Requires two observations, even for old files discovered in the initial scan. */
export class DemoFileReadiness {
  private observations = new Map<string, Observation>();

  public isReady(filePath: string, fingerprint: string, now: number, stableForMs: number) {
    const observation = this.observations.get(filePath);
    if (observation?.fingerprint !== fingerprint) {
      this.observations.set(filePath, { fingerprint, stableSince: now });
      return false;
    }

    return now - observation.stableSince >= stableForMs;
  }

  public removeMissingFiles(filePaths: Set<string>) {
    for (const filePath of this.observations.keys()) {
      if (!filePaths.has(filePath)) {
        this.observations.delete(filePath);
      }
    }
  }

  public clear() {
    this.observations.clear();
  }
}
