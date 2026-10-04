// Event ticks need not coincide with a stored position snapshot. Enter the viewer
// on the closest available snapshot so an evidence link never starts on an empty radar.
export function resolveEntryTick(
  value: string | null,
  startTick: number,
  freezeEndTick: number,
  endTick: number,
  positionTicks: number[],
) {
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) {
    return freezeEndTick;
  }
  const lastTick = Math.max(startTick, endTick);
  const target = Math.max(startTick, Math.min(lastTick, Math.round(Number(value))));
  let nearest: number | undefined;
  for (const tick of positionTicks) {
    if (tick < startTick || tick > lastTick) continue;
    if (
      nearest === undefined ||
      Math.abs(tick - target) < Math.abs(nearest - target) ||
      (Math.abs(tick - target) === Math.abs(nearest - target) && tick < nearest)
    ) {
      nearest = tick;
    }
  }
  return nearest ?? target;
}
