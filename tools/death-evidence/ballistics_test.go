package main

import (
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msg"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestBallisticsMissingAndZero(t *testing.T) {
	fields := ballisticFields(map[string]*msg.CSVCMsg_GameEventKeyT{
		"inaccuracy_move":   {ValFloat: proto.Float32(0)},
		"in_air":            {ValBool: proto.Bool(false)},
		"attack_tick_count": {ValLong: proto.Int32(100)},
		"inaccuracy_total":  {},
		"attacker_name":     {ValString: proto.String("must not export")},
		"distance":          {ValFloat: proto.Float32(10), ValLong: proto.Int32(10)},
	})
	if len(fields) != 3 || fields["inaccuracy_move"] != float32(0) || fields["in_air"] != false || fields["attack_tick_count"] != int32(100) {
		t.Fatalf("unexpected ballistic fields: %#v", fields)
	}
}

func TestBallisticIdentityRejectsAmbiguousWireValues(t *testing.T) {
	if exclusiveEventLong(nil) != nil || exclusiveEventLong(&msg.CSVCMsg_GameEventKeyT{ValLong: proto.Int32(12), ValFloat: proto.Float32(12)}) != nil {
		t.Fatal("ambiguous identity was accepted")
	}
	value := exclusiveEventLong(&msg.CSVCMsg_GameEventKeyT{ValLong: proto.Int32(12)})
	if value == nil || *value != 12 { t.Fatal("explicit identity lost") }
}
