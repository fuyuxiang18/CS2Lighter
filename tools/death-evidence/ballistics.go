package main

import (
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msg"
	st "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/sendtables"
)

// Preserve actual optional values, including false and zero, without a protobuf
// getter silently inventing values for fields absent from the recording.
func ballisticFields(data map[string]*msg.CSVCMsg_GameEventKeyT) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		"distance", "damage_dir_x", "damage_dir_y", "damage_dir_z", "num_penetrations", "no_scope", "in_air",
		"shoot_ang_x", "shoot_ang_y", "shoot_ang_z", "aim_punch_x", "aim_punch_y", "aim_punch_z",
		"attack_tick_count", "attack_tick_frac", "render_tick_count", "render_tick_frac",
		"inaccuracy_total", "inaccuracy_move", "inaccuracy_air", "recoil_index", "type",
	} {
		value := data[key]
		if value == nil {
			continue
		}
		// An ambiguous wire value is missing evidence, never a preferred type.
		present := 0
		var decoded any
		if value.ValFloat != nil {
			present++
			decoded = *value.ValFloat
		}
		if value.ValLong != nil {
			present++
			decoded = *value.ValLong
		}
		if value.ValShort != nil {
			present++
			decoded = *value.ValShort
		}
		if value.ValByte != nil {
			present++
			decoded = *value.ValByte
		}
		if value.ValBool != nil {
			present++
			decoded = *value.ValBool
		}
		if present == 1 && value.ValString == nil && value.ValUint64 == nil {
			result[key] = normalize(decoded)
		}
	}
	return result
}

func exclusiveEventLong(value *msg.CSVCMsg_GameEventKeyT) *int32 {
	if value == nil || value.ValLong == nil || value.ValFloat != nil || value.ValShort != nil || value.ValByte != nil || value.ValBool != nil || value.ValString != nil || value.ValUint64 != nil { return nil }
	return value.ValLong
}

func (x *extractor) ballisticPawn(data map[string]*msg.CSVCMsg_GameEventKeyT, role string) (st.Entity, *string) {
	value := data[role+"_pawn"]
	encoded := exclusiveEventLong(value)
	if encoded == nil {
		return nil, nil
	}
	handle := uint64(uint32(*encoded))
	var found st.Entity
	for _, player := range x.p.GameState().Participants().All() {
		if player.Entity == nil {
			continue
		}
		current := number(raw(player.Entity, "m_hPlayerPawn"))
		if current == nil || uint64(*current) != handle {
			continue
		}
		pawn := player.PlayerPawnEntity()
		if !matchesHandle(pawn, handle) {
			continue
		}
		if found != nil {
			return nil, nil
		}
		found = pawn
	}
	if found == nil {
		return nil, nil
	}
	return found, x.playerSteamID(found)
}

func (x *extractor) bulletDamage(event events.GenericGameEvent) {
	if event.Name != "bullet_damage" {
		return
	}
	clock := x.clock()
	if !x.wanted[clock.Tick] {
		return
	}
	x.emitHeader()
	if !x.headerSent {
		return
	}
	attacker, attackerSteamID := x.ballisticPawn(event.Data, "attacker")
	victim, victimSteamID := x.ballisticPawn(event.Data, "victim")
	if len(x.selected) > 0 && attackerSteamID != nil && !x.selected[*attackerSteamID] {
		return
	}
	var attackerID, victimID, weaponID *string
	var item *float64
	if attacker != nil {
		id := entityID(attacker)
		attackerID = &id
		if weapon := x.activeWeapon(attacker); weapon != nil {
			weaponID = &weapon.ID
			field := weapon.Fields["m_AttributeManager.m_Item.m_iItemDefinitionIndex"]
			if field.Present {
				item = number(field.Value)
			}
		}
	}
	if victim != nil {
		id := entityID(victim)
		victimID = &id
	}
	x.bulletDamages++
	x.send(map[string]any{
		"type": "bullet-damage", "tick": clock.Tick, "frame": clock.Frame, "serverTick": clock.ServerTick,
		"attackerEntityId": attackerID, "attackerSteamId": attackerSteamID,
		"victimEntityId": victimID, "victimSteamId": victimSteamID,
		"weaponEntityId": weaponID, "itemDefinitionIndex": item, "raw": ballisticFields(event.Data),
	})
}
