import { describe, expect, it } from 'vite-plus/test';
import { resolveEntryTick } from './resolve-entry-tick';

describe('evidence links into the 2D viewer', () => {
  it('keeps the usual freeze-end entry when the URL has no usable tick', () => {
    for (const value of [null, '', ' ', 'invalid', 'Infinity']) {
      expect(resolveEntryTick(value, 100, 120, 200, [100, 125])).toBe(120);
    }
  });

  it('chooses a recorded snapshot, preferring the earlier one for a tie', () => {
    expect(resolveEntryTick('145', 100, 120, 200, [150, 140, 90, 220])).toBe(140);
    expect(resolveEntryTick('146', 100, 120, 200, [140, 150])).toBe(150);
  });

  it('does not seek outside the selected round', () => {
    expect(resolveEntryTick('-50', 100, 120, 200, [99, 104, 195, 205])).toBe(104);
    expect(resolveEntryTick('999', 100, 120, 200, [99, 104, 195, 205])).toBe(195);
    expect(resolveEntryTick('999', 100, 120, 200, [])).toBe(200);
  });
});
