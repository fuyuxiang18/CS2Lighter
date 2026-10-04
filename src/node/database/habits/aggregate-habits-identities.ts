import type { HabitsIdentityCandidate } from 'csdm/common/types/habits';

export function aggregateHabitsIdentities(
  nickname: string,
  rows: { steamId: string; checksum: string; date: Date }[],
): HabitsIdentityCandidate[] {
  const candidates = new Map<string, { candidate: HabitsIdentityCandidate; checksums: Set<string> }>();
  for (const row of rows) {
    if (!/^\d{17}$/.test(row.steamId)) {
      continue;
    }
    let item = candidates.get(row.steamId);
    if (!item) {
      item = {
        candidate: { steamId: row.steamId, nickname, matchCount: 0, lastSeen: row.date.toISOString() },
        checksums: new Set(),
      };
      candidates.set(row.steamId, item);
    }
    if (row.date.toISOString() > item.candidate.lastSeen) {
      item.candidate.lastSeen = row.date.toISOString();
    }
    item.checksums.add(row.checksum);
    item.candidate.matchCount = item.checksums.size;
  }
  return Array.from(candidates.values(), ({ candidate }) => candidate).sort(
    (a, b) => b.matchCount - a.matchCount || a.steamId.localeCompare(b.steamId),
  );
}
