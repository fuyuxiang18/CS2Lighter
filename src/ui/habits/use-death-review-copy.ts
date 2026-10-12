import { useLingui } from '@lingui/react/macro';
import type { DeathKind, DeathRuleCategory, DeathSignal, DeathTimelineEvent } from 'csdm/common/types/death-review';

export function useDeathReviewCopy() {
  const { t } = useLingui();
  const rules: Record<string, { title: string; action?: string }> = {
    opening_death: {
      title: t`Opening death`,
      action: t`Replay first contact with your nearest teammate's position in view. Plan who takes contact and who follows before the next opening.`,
    },
    early_round_death: {
      title: t`Died early in the round`,
      action: t`Compare your arrival with the opponent's timing. Rehearse the opening route with one planned stopping point before contact.`,
    },
    damage_before_death: {
      title: t`Took damage before the final hit`,
      action: t`Find the first damage event. Decide where you could break contact or ask for support before taking the next hit.`,
    },
    low_health_before_hit: {
      title: t`Low health before the final hit`,
      action: t`Check how your health changed the next fight. Practice a covered route that still lets you trade or support the objective.`,
    },
    very_fast_damage_sequence: {
      title: t`Rapid damage sequence`,
      action: t`Step through the first and final hits. Check how much of your body was exposed when contact began, then rehearse a smaller exposure.`,
    },
    headshot_death: {
      title: t`Killed by a headshot`,
      action: t`Check your movement and cover at first contact. Compare the same position from the opponent's view before changing your peek.`,
    },
    high_speed_final_shot: {
      title: t`High movement speed at the final shot`,
      action: t`Replay the last shot and your movement. Practice stopping before firing at the same range, then compare the next recorded attempt.`,
    },
    first_shot_high_speed: {
      title: t`High movement speed at the first shot`,
      action: t`Replay the start of this shooting sequence. Practice arriving, stopping, and firing as separate steps at the same distance.`,
    },
    firing_while_blind: {
      title: t`Fired during a recorded blind interval`,
      action: t`Check what you knew about the enemy's position before the flash. Rehearse holding cover or retreating while a teammate takes contact.`,
    },
    no_return_fire: {
      title: t`No recorded return fire`,
      action: t`Check when you first had a chance to shoot and what you were holding. Rehearse reaching this angle ready to fire or ready to retreat.`,
    },
    spray_without_damage: {
      title: t`Long shot sequence without gun damage`,
      action: t`Watch the target and aim direction through the shot sequence. Practice a shorter burst followed by a reset at this distance.`,
    },
    burst_without_damage: {
      title: t`Short shot sequence without gun damage`,
      action: t`Replay the first shot and target movement. Practice the same peek with a deliberate stop and one controlled burst.`,
    },
    shooting_direction_change: {
      title: t`Large direction change between shots`,
      action: t`Check whether you switched targets or corrected your aim. Practice clearing one threat at a time before moving to the next.`,
    },
    damaged_other_enemy: {
      title: t`Damaged another enemy before dying`,
      action: t`Compare the enemy you damaged with the player who killed you. Plan cover or teammate support for the second threat.`,
    },
    high_damage_to_killer: {
      title: t`High damage dealt to your killer`,
      action: t`Check the finishing shots and remaining cover. Rehearse finishing one target or calling the damage so a teammate can complete the exchange.`,
    },
    death_after_kill: {
      title: t`Died shortly after a kill`,
      action: t`Pause at your kill. Practice one immediate reposition or retreat that changes the opponent's next shot.`,
    },
    same_enemy_chain: {
      title: t`Killer had just killed a teammate`,
      action: t`Check your position when your teammate died. Rehearse reaching the same target with a coordinated timing instead of separate entries.`,
    },
    traded_death: {
      title: t`Your death was traded`,
      action: t`Check the spacing and timing around the trade. Keep a repeatable setup that also advances the round objective.`,
    },
    untraded_death: {
      title: t`No trade within the trade window`,
      action: t`Check the closest teammate's route and sightline. Agree on a follow-up position before attempting the same fight again.`,
    },
    numerical_advantage: {
      title: t`Died with a player-count advantage`,
      action: t`Pause before contact and name what the fight could gain. Practice holding the objective with shared angles when another duel adds little.`,
    },
    last_alive: {
      title: t`Last teammate alive`,
      action: t`List the time, bomb state, and last enemy information. Practice choosing one isolated fight or a safe exit from that starting point.`,
    },
    enemy_flash: {
      title: t`Enemy flash active at death`,
      action: t`Check the flash cue and nearest cover. Rehearse turning away or stepping behind cover while your teammate holds contact.`,
    },
    teammate_flash: {
      title: t`Teammate flash active at death`,
      action: t`Compare the flash call with your exposure. Agree on a clear pop timing and turn-away cue before repeating the entry.`,
    },
    self_flash: {
      title: t`Your own flash active at death`,
      action: t`Check the bounce and pop position from your view. Practice the throw with your turn and peek included.`,
    },
    utility_throw_before_death: {
      title: t`Threw utility shortly before dying`,
      action: t`Check the gap between the throw and the next threat. Rehearse throwing from cover while a teammate protects the exposed angle.`,
    },
    self_utility_damage: {
      title: t`Recent damage from your own utility`,
      action: t`Check the grenade path and your retreat. Practice the same throw with a route that leaves the blast or fire area.`,
    },
    fire_damage_before_death: {
      title: t`Recent fire damage`,
      action: t`Check when the fire appeared and where you could leave it. Rehearse the exit before committing to the position.`,
    },
    he_damage_before_death: {
      title: t`Recent HE grenade damage`,
      action: t`Check your position when the grenade arrived. Compare nearby cover and spacing before repeating the hold.`,
    },
    flashed_enemy_before_death: {
      title: t`You blinded an enemy before dying`,
      action: t`Compare the blinded enemy with your killer and the flash timing. Practice using the flash with a teammate ready to cover the other threat.`,
    },
    airborne_death: {
      title: t`Airborne at death`,
      action: t`Check whether this was a jump for information, movement, or a fight. Rehearse landing behind cover before committing to a shot.`,
    },
    inspecting_weapon: {
      title: t`Inspecting weapon at death`,
      action: t`Check what you expected beyond the next corner. Keep your weapon ready through uncleared areas on the next route.`,
    },
    through_smoke_death: {
      title: t`Killed through smoke`,
      action: t`Check what revealed your position before the smoke shot. Practice crossing on a different line or timing with cover from a teammate.`,
    },
    penetration_death: {
      title: t`Killed through penetrated cover`,
      action: t`Identify the surface between you and the killer. Rehearse a second position that changes the shot line after your location is revealed.`,
    },
    multi_attacker_damage: {
      title: t`Recent damage from multiple enemies`,
      action: t`Replay each damage source. Practice using cover or a smoke to reduce the threats you must handle at once.`,
    },
    crouched_death: {
      title: t`Crouched near the death event`,
      action: t`Check how crouching affected your exposure and ability to leave. Compare a standing or repositioning option in the same spot.`,
    },
    scoped_death: {
      title: t`Scoped near the death event`,
      action: t`Check the angle you held and the threat outside it. Rehearse unscoping or changing position when that threat becomes likely.`,
    },
    rear_bearing: {
      title: t`Killer behind your recorded aim direction`,
      action: t`Check when the rear route became open. Agree on who watches it and rehearse a position that reduces the turn needed.`,
    },
    distant_nearest_teammate: {
      title: t`Large distance to the nearest living teammate`,
      action: t`Compare your route with the nearest teammate at contact. Plan a meeting point or a supported timing before repeating the entry.`,
    },
    knife_in_hand: {
      title: t`Knife held near the death event`,
      action: t`Mark the last safe point on the route. Practice drawing your weapon there before entering the next uncleared area.`,
    },
    grenade_in_hand: {
      title: t`Grenade held near the death event`,
      action: t`Check whether cover or a teammate protected the setup. Practice preparing this grenade from a protected position.`,
    },
    bomb_in_hand: {
      title: t`Bomb held near the death event`,
      action: t`Check the route to the plant and who covered it. Rehearse drawing the bomb only once the planting position is protected.`,
    },
    no_armor: {
      title: t`No armor near the death event`,
      action: t`Check the team's buy plan and the fight distance. Choose a route and trade setup suited to this equipment on the next low buy.`,
    },
    helmetless_headshot: {
      title: t`Headshot with no helmet in the snapshot`,
      action: t`Compare your buy with the team's plan and expected opposing weapons. Set the next purchase before choosing the fight.`,
    },
    retained_utility: {
      title: t`Remaining grenades near the death event`,
      action: t`Pick one remaining grenade and find a useful moment before contact. Practice that throw as part of the route.`,
    },
    planting_death: {
      title: t`Planting near the death event`,
      action: t`Check the plant position and uncovered approach. Rehearse the plant with a teammate covering the active threat.`,
    },
    defusing_death: {
      title: t`Defusing near the death event`,
      action: t`Compare the remaining time with the known threats. Practice the tap, cover, and teammate timing from this bomb position.`,
    },
    bomb_carrier_death: {
      title: t`Carrying the bomb near the death event`,
      action: t`Check where the bomb would fall and how teammates could recover it. Rehearse a route that keeps the objective reachable.`,
    },
    kit_carrier_death: {
      title: t`Carrying a defuse kit near the death event`,
      action: t`Check the kit's location and the retake plan. Agree on who carries it and which route keeps it available for the defuse.`,
    },
    postplant_t_death: {
      title: t`T-side death after the plant`,
      action: t`Check whether the clock or bomb could force the opponent to act. Practice a covered post-plant position with a tradeable angle.`,
    },
    postplant_ct_death: {
      title: t`CT-side death after the plant`,
      action: t`Check time, kit availability, and teammate routes before contact. Rehearse the retake order with one shared target at a time.`,
    },
    simultaneous_visible_enemies: { title: t`Enemies visible at the same time` },
    multiple_visible_angles: { title: t`Simultaneous visible firing angles` },
    wide_peek_exposure: { title: t`Exposure during a wide peek` },
    repeek_same_angle: { title: t`Repeeking the same angle` },
    cover_distance_disadvantage: { title: t`Distance from shared cover` },
    crosshair_placement: { title: t`Crosshair placement` },
    first_shot_inaccuracy: { title: t`First-shot inaccuracy` },
    counter_strafe_timing: { title: t`Counter-strafe timing` },
    recoil_compensation: { title: t`Recoil compensation` },
    mouse_oscillation: { title: t`Mouse corrections` },
    reload_exposure: { title: t`Exposure while reloading` },
    empty_magazine: { title: t`Empty magazine` },
    weapon_switch_lockout: { title: t`Weapon switching delay` },
    missed_trade_opportunity: { title: t`Missed trade opportunity` },
    incorrect_information_read: { title: t`Use of team information` },
    unnecessary_rotation: { title: t`Rotation decision` },
  };
  const categories: Record<DeathRuleCategory, string> = {
    mechanics: t`Shooting`,
    exposure: t`Exposure`,
    utility: t`Utility`,
    trading: t`Teamplay`,
    objectives: t`Objectives`,
    resources: t`Equipment`,
    context: t`Death context`,
  };
  const kinds: Record<DeathKind, string> = {
    enemy: t`Enemy kill`,
    team: t`Team kill`,
    self: t`Self-inflicted death`,
    world: t`World damage`,
    unknown: t`Unknown cause`,
  };
  const signals: Record<DeathSignal, string> = {
    shots: t`Shot events`,
    positions: t`Position snapshots`,
    visibility: t`Visibility checks`,
    input: t`Movement and mouse input`,
    'weapon-state': t`Weapon state`,
    communication: t`Team communication`,
  };
  const events: Record<DeathTimelineEvent['kind'], string> = {
    death: t`Death`,
    kill: t`Kill`,
    'damage-taken': t`Damage taken`,
    'damage-dealt': t`Damage dealt`,
    shot: t`Shot fired`,
    blind: t`Flash blindness`,
    utility: t`Utility thrown`,
    plant: t`Bomb planted`,
    defuse: t`Bomb defused`,
  };
  const measures: Record<string, string> = {
    elapsed: t`Time between events`,
    window: t`Evidence window`,
    damage: t`Health damage`,
    health: t`Health`,
    speed: t`Movement speed`,
    shots: t`Shots`,
    angle: t`Angle`,
    attackers: t`Enemy damage sources`,
    teammates: t`Living teammates`,
    enemies: t`Living enemies`,
    remaining: t`Blind time remaining`,
    objects: t`Penetrated surfaces`,
    distance: t`Distance`,
    grenades: t`Grenades`,
    armor: t`Armor`,
  };
  return { rules, categories, kinds, signals, events, measures };
}
