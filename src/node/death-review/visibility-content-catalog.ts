/**
 * Steam depot file hashes from fixed GameTracking-CS2 snapshots, not demo hashes.
 * Only closed, completely verified release cohorts can authorize production use.
 * The active 14191 protocol may gain new same-protocol resources and is not certified.
 * See docs/research/map-content-data.md for source URLs and reproduction details.
 */
const maps: Record<string, { size: number; sha1: string }> = {
  de_ancient: { size: 405482447, sha1: '23345406e58342cea5140e6cfa15e96907d362cc' },
  de_dust2: { size: 262476433, sha1: '7dc529cd65d843a2b8a98c297e79b9923dd70a5d' },
  de_inferno: { size: 453401552, sha1: 'ffba75060715b1f315209c28df94646781fe3365' },
  de_mirage: { size: 176187297, sha1: '0def8c7402b1ecf6d387f6e559d210b5a1856b32' },
  de_nuke: { size: 246935525, sha1: 'a188f671b2feb154a38bddab5df3e33a0b57a6a0' },
};

const closedCohorts: Record<number, readonly string[]> = {
  14190: ['4758919807587010422'],
};

export function getVisibilityContentExpectation(demoPatch: number, mapName: string) {
  const manifestIds = Object.hasOwn(closedCohorts, demoPatch) ? closedCohorts[demoPatch] : undefined,
    map = Object.hasOwn(maps, mapName) ? maps[mapName] : undefined;
  return manifestIds && map ? { ...map, manifestIds } : null;
}
