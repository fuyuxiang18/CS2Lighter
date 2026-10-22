package main

import (
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/constants"
)

func identityController(id int, handle any, steamID uint64) *common.Player {
	return &common.Player{
		Entity:    propertyEntity{id: id, serial: 1, values: map[string]any{"m_hPlayerPawn": handle}},
		SteamID64: steamID,
	}
}

func TestPawnIdentityRequiresOneControllerWithTheExactHandle(t *testing.T) {
	pawn := propertyEntity{id: 517, serial: 123}
	handle := uint64(pawn.serial<<constants.MaxEdictBitsSource2 | pawn.id)
	selected := identityController(1, handle, 76561190000000001)
	others := []*common.Player{
		nil,
		{},
		identityController(2, nil, 76561190000000002),
		identityController(3, handle+1, 76561190000000003),
		identityController(4, handle+(1<<constants.MaxEdictBitsSource2), 76561190000000004),
		identityController(5, float64(handle), 76561190000000005),
	}
	if uniquePawnController(pawn, others) != nil || uniquePawnController(nil, []*common.Player{selected}) != nil {
		t.Fatal("missing, stale or malformed pawn handles were associated with an identity")
	}
	if found := uniquePawnController(pawn, append(others, selected)); found != selected {
		t.Fatal("unambiguous controller was lost among unrelated participants")
	}
}

func TestPawnIdentityRejectsEveryAmbiguousControllerBeforeSteamIDValidation(t *testing.T) {
	pawn := propertyEntity{id: 517, serial: 123}
	handle := uint64(pawn.serial<<constants.MaxEdictBitsSource2 | pawn.id)
	selected := identityController(1, handle, 76561190000000001)
	for _, test := range []struct {
		name    string
		steamID uint64
	}{
		{"different identity", 76561190000000002},
		{"same identity", selected.SteamID64},
		{"missing identity", 0},
		{"invalid identity", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			other := identityController(2, handle, test.steamID)
			for _, participants := range [][]*common.Player{{selected, other}, {other, selected}} {
				if uniquePawnController(pawn, participants) != nil {
					t.Fatal("ambiguous pawn ownership depended on participant order or identity validity")
				}
			}
		})
	}
}
