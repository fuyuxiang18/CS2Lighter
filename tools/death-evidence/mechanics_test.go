package main

import "testing"

func TestGameTickSignedTypedef(t *testing.T) {
	for _, tc := range []struct {
		raw  any
		typ  string
		want *int64
	}{
		{uint32(17846), "GameTick_t", ptrTick(8923)},
		{uint32(1), "GameTick_t", ptrTick(-1)},
		{uint64(0), "GameTick_t", ptrTick(0)},
		{int32(8923), "int32", ptrTick(8923)},
		{uint32(17846), "", nil},
		{uint32(17846), "ambiguous", nil},
		{int32(8923), "GameTick_t", nil},
		{uint64(1 << 32), "GameTick_t", nil},
	} {
		got := decodeGameTick(tc.raw, tc.typ)
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Fatalf("decodeGameTick(%v, %q) = %v, want %v", tc.raw, tc.typ, got, tc.want)
		}
	}
}

func ptrTick(v int64) *int64 { return &v }

func TestMechanicsFieldsPreserveMissing(t *testing.T) {
	for _, name := range []string{"m_fFlags", "m_MoveType", "m_ArmorValue", "m_bIsDefusing", "m_pWeaponServices.m_flNextAttack"} {
		found := false
		for _, declared := range playerFields {
			found = found || declared == name
		}
		if !found {
			t.Fatalf("mechanics player field %s is not requested", name)
		}
	}
}
