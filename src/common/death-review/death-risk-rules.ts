import type { DeathRiskAdvice, DeathRiskRuleId } from 'csdm/common/types/death-risk';

export const DEATH_RISK_REVISION = '2026-10-12.1';

export const DEATH_RISK_RULES: { id: DeathRiskRuleId; priority: number; advice: DeathRiskAdvice['code'] }[] = [
  { id: 'r1', priority: 85, advice: 'wait-for-movement-recovery' },
  { id: 'r2', priority: 85, advice: 'wait-for-landing-recovery' },
  { id: 'r3', priority: 75, advice: 'allow-burst-recovery' },
  { id: 'r4', priority: 80, advice: 'correct-target-relative-spray' },
  { id: 'r5', priority: 65, advice: 'isolate-enemy-lines' },
  { id: 'r6', priority: 90, advice: 'stop-at-earlier-cover' },
  { id: 'r7', priority: 75, advice: 'change-repeek-timing-or-angle' },
  { id: 'r8', priority: 75, advice: 'return-to-verified-cover' },
  { id: 'r9', priority: 100, advice: 'ready-weapon-before-peeking' },
  { id: 'r10', priority: 100, advice: 'reload-behind-cover' },
  { id: 'r11', priority: 100, advice: 'check-magazine-before-contact' },
  { id: 'r12', priority: 95, advice: 'sequence-flash-and-peek' },
  { id: 'r13', priority: 95, advice: 'wait-out-blindness-in-cover' },
  { id: 'r14', priority: 70, advice: 'synchronize-with-teammate' },
];
