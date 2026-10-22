package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/golang/snappy"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msgs2"
	"google.golang.org/protobuf/proto"
)

type animationTestBits struct {
	bytes  []byte
	offset int
}

func (w *animationTestBits) write(value uint32, n int) {
	for i := 0; i < n; i++ {
		if w.offset/8 >= len(w.bytes) {
			w.bytes = append(w.bytes, 0)
		}
		w.bytes[w.offset/8] |= byte((value>>uint(i))&1) << uint(w.offset%8)
		w.offset++
	}
}
func (w *animationTestBits) text(value string) {
	for _, b := range []byte(value) {
		w.write(uint32(b), 8)
	}
	w.write(0, 8)
}
func animationTestTable(key string, value []byte) []byte {
	w := animationTestBits{}
	w.write(1, 1)
	w.write(1, 1)
	w.write(0, 1)
	w.text(key)
	if value == nil {
		w.write(0, 1)
	} else {
		w.write(1, 1)
		w.write(uint32(len(value)), 17)
		for _, b := range value {
			w.write(uint32(b), 8)
		}
	}
	return w.bytes
}
func TestAnimationTablePreservesHistoryAndCompressedBytes(t *testing.T) {
	w := animationTestBits{}
	w.write(1, 1)
	w.write(1, 1)
	w.write(0, 1)
	w.text("CNmSampleTask")
	w.write(0, 1)
	w.write(1, 1)
	w.write(1, 1)
	w.write(1, 1)
	w.write(0, 5)
	w.write(3, 5)
	w.text("BlendTask")
	w.write(1, 1)
	w.write(1, 1)
	payload := snappy.Encode(nil, []byte{0, 1, 2, 255})
	w.write(uint32(len(payload)), 17)
	for _, b := range payload {
		w.write(uint32(b), 8)
	}
	items, err := decodeAnimationTable(w.bytes, 2, &animationTable{flags: 1})
	if err != nil || len(items) != 2 || items[0].key != "CNmSampleTask" || items[1].key != "CNmBlendTask" || !bytes.Equal(items[1].data, []byte{0, 1, 2, 255}) {
		t.Fatalf("items=%v err=%v", items, err)
	}
}
func TestAnimationTableRejectsTruncationAndLimits(t *testing.T) {
	valid := animationTestTable("clip", []byte{1, 2, 3})
	for _, data := range [][]byte{nil, valid[:len(valid)-1], make([]byte, maxAnimationBytes+1)} {
		if _, err := decodeAnimationTable(data, 1, &animationTable{}); err == nil {
			t.Fatal("invalid string table accepted")
		}
	}
	if _, err := decodeAnimationTable(valid, maxAnimationEntries+1, &animationTable{}); err == nil {
		t.Fatal("unbounded entry count accepted")
	}
}
func TestAnimationCollectionRequiresExplicitOptIn(t *testing.T) {
	for _, input := range []string{
		`{"version":1,"demoPath":"sample.dem","windows":[{"startTick":100,"endTick":101}]}`,
		`{"version":1,"demoPath":"sample.dem","windows":[{"startTick":100,"endTick":101}],"includeAnimation":false}`,
	} {
		req, err := readRequest(strings.NewReader(input))
		if err != nil || req.IncludeAnimation {
			t.Fatalf("unexpected default: %+v %v", req, err)
		}
		var output bytes.Buffer
		x := extractor{request: req, output: emitter{out: &output}, wanted: map[int]bool{100: true}}
		x.animationCreate(&msgs2.CSVCMsg_CreateStringTable{Name: proto.String("AnimTaskTypes"), NumEntries: proto.Int32(1), StringData: animationTestTable("CNmSampleTask", nil)})
		x.animationUpdate(&msgs2.CSVCMsg_UpdateStringTable{TableId: proto.Int32(0), StringData: []byte{3}})
		x.animationClear(nil)
		x.emitAnimationContext(clockPoint{Tick: 100})
		if len(x.animation.tables) != 0 || x.animation.revision != 0 || len(x.animation.errors) != 0 || output.Len() != 0 || x.animationRecipe(nil) != nil {
			t.Fatal("disabled animation collected state")
		}
		if !reflect.DeepEqual(x.requestedPlayerFields(), playerFields) {
			t.Fatal("disabled animation expanded player fields")
		}
	}
	req, err := readRequest(strings.NewReader(`{"version":1,"demoPath":"sample.dem","windows":[{"startTick":100,"endTick":101}],"includeAnimation":true}`))
	if err != nil || !req.IncludeAnimation {
		t.Fatal("explicit animation request lost")
	}
	x := extractor{request: req}
	if len(x.requestedPlayerFields()) <= len(playerFields) {
		t.Fatal("opt-in omitted animation fields")
	}
	for _, value := range []string{`1`, `"true"`, `{}`} {
		if _, err := readRequest(strings.NewReader(`{"version":1,"demoPath":"sample.dem","windows":[{"startTick":100,"endTick":101}],"includeAnimation":` + value + `}`)); err == nil {
			t.Fatal("non-boolean animation request accepted")
		}
	}
}
func TestAnimationContextUsesAllTableIDsAndOnlyWindowEmission(t *testing.T) {
	var output bytes.Buffer
	x := extractor{request: request{IncludeAnimation: true}, output: emitter{out: &output}, wanted: map[int]bool{100: true, 101: true}}
	x.animationCreate(&msgs2.CSVCMsg_CreateStringTable{Name: proto.String("unrelated")})
	x.animationCreate(&msgs2.CSVCMsg_CreateStringTable{Name: proto.String("AnimTaskTypes"), NumEntries: proto.Int32(1), StringData: animationTestTable("CNmSampleTask", nil)})
	x.emitAnimationContext(clockPoint{Tick: 99})
	if output.Len() != 0 {
		t.Fatal("animation context leaked outside window")
	}
	x.emitAnimationContext(clockPoint{Frame: 1, Tick: 100})
	x.emitAnimationContext(clockPoint{Frame: 2, Tick: 101})
	if strings.Count(output.String(), "\n") != 1 {
		t.Fatal("unchanged context repeated")
	}
	x.animationUpdate(&msgs2.CSVCMsg_UpdateStringTable{TableId: proto.Int32(1), StringData: animationTestTable("CNmBlendTask", nil)})
	x.emitAnimationContext(clockPoint{Frame: 3, Tick: 101})
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatal("updated context missing")
	}
	var first, last animationContext
	if json.Unmarshal([]byte(lines[0]), &first) != nil || json.Unmarshal([]byte(lines[1]), &last) != nil {
		t.Fatal("invalid context JSON")
	}
	if first.TaskTypes[0].Name != "CNmSampleTask" || last.TaskTypes[0].Name != "CNmBlendTask" || first.ContextID >= last.ContextID || last.Tick != 101 {
		t.Fatalf("wrong update clocks/IDs: %+v %+v", first, last)
	}
}
func TestAnimationErrorsCannotReuseTruncatedUpdateAsValid(t *testing.T) {
	x := extractor{request: request{IncludeAnimation: true}}
	x.animationCreate(&msgs2.CSVCMsg_CreateStringTable{Name: proto.String("AnimTaskTypes"), NumEntries: proto.Int32(1), StringData: animationTestTable("CNmSampleTask", nil)})
	x.animationUpdate(&msgs2.CSVCMsg_UpdateStringTable{TableId: proto.Int32(0), NumChangedEntries: proto.Int32(1), StringData: []byte{3}})
	if len(x.animation.errors) != 1 || x.animation.tables[0].items[0].key != "CNmSampleTask" {
		t.Fatal("partial update was trusted")
	}
	x.animationClear(nil)
	if len(x.animation.tables) != 0 || len(x.animation.errors) != 0 {
		t.Fatal("cleared context retained stale state")
	}
}
func TestAnimationByteVectorUsesDeclaredArrayLength(t *testing.T) {
	encoded := animationByteVector([]any{uint64(0), uint64(4), uint64(255), uint64(0)})
	if encoded == nil || *encoded != base64.StdEncoding.EncodeToString([]byte{0, 4, 255, 0}) {
		t.Fatal("zero bytes or array length changed")
	}
	for _, value := range []any{nil, []any{}, []any{uint64(1), nil}, []any{uint64(256)}, make([]byte, 4097)} {
		if animationByteVector(value) != nil {
			t.Fatal("invalid dynamic recipe accepted")
		}
	}
}

func TestAnimationActiveSlotRequiresDeclaredBoundedArray(t *testing.T) {
	slots := make([]any, 32)
	for index := range slots {
		slots[index] = []any{[]byte{1}}
	}
	for _, value := range []any{uint64(0), uint64(31)} {
		if animationActiveSlot(value, slots) == nil {
			t.Fatal("valid declared slot rejected")
		}
	}
	for _, value := range []any{nil, int32(-1), uint64(32), uint64(1023), float64(1.5)} {
		if animationActiveSlot(value, slots) != nil {
			t.Fatal("invalid active slot accepted")
		}
	}
	for _, value := range []any{nil, []any{}, make([]any, 33), slots[:1], []any{slots[0], nil}, []byte{1, 2}} {
		if animationActiveSlot(uint64(1), value) != nil {
			t.Fatal("slot outside the declared array accepted")
		}
	}
}
