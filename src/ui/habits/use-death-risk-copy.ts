import { useLingui } from '@lingui/react/macro';
import type { DeathRiskAdvice, DeathRiskRuleId } from 'csdm/common/types/death-risk';

export function useDeathRiskCopy() {
  const { t } = useLingui();
  const titles: Record<DeathRiskRuleId, string> = {
    r1: t`First shot before stopping`,
    r2: t`Firing too soon after landing`,
    r3: t`Firing again too soon`,
    r4: t`Spray control error`,
    r5: t`Multiple firing lines`,
    r6: t`Overexposed peek`,
    r7: t`Repeating the same fight`,
    r8: t`Exposed after a kill`,
    r9: t`Weapon drawn too late`,
    r10: t`Poor reload timing`,
    r11: t`Poor ammunition management`,
    r12: t`Forcing a fight while flashed`,
    r13: t`Forcing a fight while flashed`,
    r14: t`Fighting without support`,
  };
  const advice: Record<DeathRiskAdvice['code'], string> = {
    'wait-for-movement-recovery': t`At the marked first shot, your weapon was still losing accuracy to movement. Let the stop finish before firing at this distance; practice this weapon with the same stop-and-fire rhythm.`,
    'wait-for-landing-recovery': t`Let this weapon recover after landing before taking the shot. Compare the marked landing and firing times, then rehearse the landing behind cover.`,
    'allow-burst-recovery': t`Allow this weapon to recover between these bursts. Extend the recorded pause before repeating the same firing rhythm at this distance.`,
    'correct-target-relative-spray': t`Start correcting from the first marked shot that leaves the target. Rehearse this weapon at the same distance with a shorter burst, then extend it while keeping the later shots on target.`,
    'isolate-enemy-lines': t`Use cover to remove one of the marked enemy firing lines before extending the fight. Approach so that you handle one angle at a time.`,
    'stop-at-earlier-cover': t`Stop at the earlier marked position. Your next movement added an enemy firing line; shorten this peek before choosing whether to extend it.`,
    'change-repeek-timing-or-angle': t`The same opponent still controlled this line when you returned. Change the angle or coordinate a new timing with a teammate or utility before taking it again.`,
    'return-to-verified-cover': t`After the kill, return along the marked route to cover before taking the next fight. Rehearse the kill and the immediate retreat together.`,
    'ready-weapon-before-peeking': t`Complete the weapon switch before entering the marked firing line. Rehearse this route with your gun ready at the corner.`,
    'reload-behind-cover': t`Complete the reload behind cover before entering the marked firing line. Avoid combining the reload with this forward movement.`,
    'check-magazine-before-contact': t`Reload or finish switching to a loaded weapon before leaving cover. Check the magazine at the marked point in this route.`,
    'sequence-flash-and-peek': t`Adjust the order of your throw, turn, recovery and peek. Rehearse the full sequence so that your own flash has ended before you enter this fight.`,
    'wait-out-blindness-in-cover': t`Hold or return to cover while flashed. Resume the peek after the blind interval instead of adding this firing line while unable to see clearly.`,
    'synchronize-with-teammate': t`Coordinate contact with a teammate or change your route so they can establish a support line. Use the recorded support timing to avoid entering this fight alone.`,
  };
  const statuses = {
    matched: t`Risk found`,
    clear: t`Checked`,
    unavailable: t`Needs evidence`,
    'not-applicable': t`Not applicable here`,
  };
  const evidenceTitles: Record<string, string> = {
    observation: t`Recorded action`,
    'precision-at-shot': t`Accuracy at the shot`,
    'target-relative-spray': t`Shot sequence relative to the target`,
    'multiple-gunlines': t`Overlapping enemy firing lines`,
    'self-created-gunline': t`Your movement opened a firing line`,
    'earlier-position': t`Position before entering the firing line`,
    'reload-started-exposed': t`Reload started in an enemy firing line`,
    'incoming-hit': t`Opponent hit during this action`,
    'previous-exchange': t`First exchange on this line`,
    'same-line-reentry': t`Returned to the same controlled line`,
    'kill-before-exposure': t`Kill before the next exposure`,
    'reachable-cover': t`Verified cover reachable before the next hit`,
    'unsupported-contact': t`Contact without an available support line`,
    'support-arrival-bound': t`Earliest possible teammate support`,
    'shared-support-position': t`Earlier shared firing line`,
  };
  const measureLabels: Record<string, string> = {
    weapon: t`Weapon`,
    kind: t`Accuracy component`,
    distance: t`Fight distance`,
    baselineDegrees: t`Recovered accuracy half-angle`,
    actualDegrees: t`Shot accuracy half-angle`,
    targetDegrees: t`Target half-angle`,
    baselineRadiusUnits: t`Recovered spread radius at this distance`,
    actualRadiusUnits: t`Shot spread radius at this distance`,
    stableAfterTick: t`Accuracy recovered at`,
    movementSpeed: t`Movement speed`,
    landingTick: t`Landed at`,
    precedingShotTick: t`Previous shot at`,
    shotCount: t`Shots`,
    firstOutsideShot: t`First shot outside target`,
    direction: t`Deviation direction`,
    reversals: t`Horizontal reversals`,
    enemyCount: t`Enemy firing lines`,
    minimumAngle: t`Minimum angle between lines`,
    durationSeconds: t`Duration`,
    beforeEnemyCount: t`Firing lines before moving`,
    afterEnemyCount: t`Firing lines after moving`,
    movementUnits: t`Movement distance`,
    magazine: t`Magazine`,
    ready: t`Weapon ready`,
    blindSource: t`Flash source`,
    blindEndTick: t`Blind interval ends at`,
    damage: t`Health damage`,
    previousContactTick: t`Previous contact at`,
    enemyReady: t`Opponent weapon ready`,
    travelSeconds: t`Travel time to cover`,
    hitTick: t`Next hit at`,
    teammateCount: t`Living teammates`,
    earliestTick: t`Support can arrive after`,
    displacementUnits: t`Distance from the shared position`,
    previousTargetId: t`Earlier opponent`,
    supportingTeammateCount: t`Teammates sharing the earlier line`,
  };
  const reasons: Record<string, string> = {
    'missing-evidence': t`This rule needs more evidence.`,
    'invalid-input': t`The evidence timeline is incomplete.`,
    'weapon-precision-unverified': t`The weapon's accuracy at the firing instant has not been verified.`,
    'target-relative-aim-unverified': t`Target-relative firing directions are not available.`,
    'gunline-coverage-incomplete': t`Some enemy firing lines could not be checked.`,
    'self-movement-proof-missing': t`The new firing line could not be attributed to your movement.`,
    'weapon-or-entry-proof-missing': t`Weapon readiness or the moment of entering the firing line is missing.`,
    'blindness-or-entry-proof-missing': t`Blind timing or the moment of entering the firing line is missing.`,
    'repeek-context-incomplete': t`The repeat peek, opponent readiness or intervening support is incomplete.`,
    'escape-route-unverified': t`A usable retreat route has not been verified.`,
    'support-reachability-unverified': t`The earliest possible teammate support has not been verified.`,
    'support-transition-unverified': t`The change from a shared firing line to unsupported contact has not been verified.`,
    'unsupported-death-context': t`This death is outside the supported competitive fight context.`,
  };
  const valueLabels: Record<string, string> = {
    movement: t`Movement`,
    landing: t`Landing`,
    recovery: t`Previous shots`,
    above: t`Above the target`,
    below: t`Below the target`,
    lateral: t`Across the target`,
    self: t`Your own flash`,
    other: t`Other player`,
  };
  const formatValue = (key: string, value: number | string | boolean | null) => {
    if (value === null) return '—';
    if (typeof value === 'boolean') return value ? t`Yes` : t`No`;
    if (typeof value === 'string') return key === 'weapon' ? value : (valueLabels[value] ?? value);
    const number = Number(value.toFixed(3));
    if (/degrees|angle/i.test(key)) return `${number}°`;
    if (/seconds|duration/i.test(key)) return `${number} s`;
    if (/speed/i.test(key)) return `${number} u/s`;
    if (/distance|units/i.test(key)) return `${number} u`;
    return String(number);
  };
  return { titles, advice, statuses, evidenceTitles, measureLabels, reasons, formatValue };
}
