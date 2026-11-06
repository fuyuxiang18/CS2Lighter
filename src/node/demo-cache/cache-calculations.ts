import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';

// Keep the legacy schema-3 calculations at revision 1. Increment only the affected
// calculation when its inputs/formula change; neither revision depends on appVersion.
export const CACHE_CALCULATIONS = { habits: 1, metrics: 1 } as const;

export function planCacheCalculations(saved: DemoDataCache | undefined, sourceRevision: string) {
  const sameSource = saved?.revision === sourceRevision;
  const revisions = saved?.calculations ?? { habits: 1, metrics: 1 };
  return {
    habits: !sameSource || revisions.habits !== CACHE_CALCULATIONS.habits,
    metrics: !sameSource || revisions.metrics !== CACHE_CALCULATIONS.metrics,
  };
}

export function isDemoCacheCurrent(saved: DemoDataCache | undefined, sourceRevision: string) {
  const plan = planCacheCalculations(saved, sourceRevision);
  return !plan.habits && !plan.metrics;
}
