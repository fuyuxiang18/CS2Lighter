import type { DeathRiskReport } from 'csdm/common/types/death-risk';

/** The original event tags are filters and context, not the operation-risk engine. */
export const DEATH_BACKGROUND_CODES = [
  'opening_death',
  'early_round_death',
  'headshot_death',
  'numerical_advantage',
  'last_alive',
  'traded_death',
  'enemy_flash',
  'teammate_flash',
  'self_flash',
  'self_utility_damage',
  'fire_damage_before_death',
  'he_damage_before_death',
  'airborne_death',
  'inspecting_weapon',
  'through_smoke_death',
  'penetration_death',
  'crouched_death',
  'scoped_death',
  'knife_in_hand',
  'grenade_in_hand',
  'bomb_in_hand',
  'no_armor',
  'helmetless_headshot',
  'retained_utility',
  'planting_death',
  'defusing_death',
  'bomb_carrier_death',
  'kit_carrier_death',
  'postplant_t_death',
  'postplant_ct_death',
] as const;

export function deathRiskPresentation(report: DeathRiskReport | undefined) {
  if (!report) return { status: 'not-analyzed' as const, findings: [] };
  const findings = report.selectedFindingIds
    .map((id) => report.findings.find((finding) => finding.id === id))
    .filter((finding) => finding !== undefined)
    .slice(0, 3);
  if (findings.length > 0) return { status: 'risks' as const, findings };
  if (report.evaluations.length > 0 && report.evaluations.every((evaluation) => evaluation.status === 'not-applicable'))
    return { status: 'not-applicable' as const, findings };
  if (report.evaluations.some((evaluation) => evaluation.status === 'clear'))
    return { status: report.status === 'evaluated' ? ('clear' as const) : ('partial-clear' as const), findings };
  return { status: 'insufficient' as const, findings };
}
