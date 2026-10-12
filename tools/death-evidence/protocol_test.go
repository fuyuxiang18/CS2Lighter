package main

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msgs2"
	st "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/sendtables"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestRequestMergesWindowsWithoutChargingOverlapTwice(t *testing.T) {
	r := request{Version: 1, DemoPath: "sample.dem", Windows: []window{{12, 15}, {1, 5}, {4, 11}, {20, 20}}}
	ticks, err := validateRequest(&r)
	if err != nil || len(ticks) != 16 || !reflect.DeepEqual(r.Windows, []window{{1, 15}, {20, 20}}) {
		t.Fatalf("ticks=%d windows=%v err=%v", len(ticks), r.Windows, err)
	}
}

func TestRequestRejectsInvalidAndUnboundedWindows(t *testing.T) {
	for _, windows := range [][]window{nil, {{-1, 0}}, {{9, 8}}, {{0, 4096}}, {{0, 2048}, {5000, 7047}}} {
		r := request{Version: 1, DemoPath: "sample.dem", Windows: windows}
		if _, err := validateRequest(&r); err == nil {
			t.Fatalf("accepted %v", windows)
		}
	}
	r := request{Version: 1, DemoPath: "sample.dem", Windows: []window{{0, 4095}}}
	if ticks, err := validateRequest(&r); err != nil || len(ticks) != 4096 {
		t.Fatalf("boundary rejected: %v", err)
	}
}

func TestRequestRejectsInvalidPlayerIdentifiers(t *testing.T) {
	for _, player := range []string{"0", "abc00000000000000", "+7656119000000000"} {
		r := request{Version: 1, DemoPath: "sample.dem", Windows: []window{{1, 1}}, Players: []string{player}}
		if _, err := validateRequest(&r); err == nil {
			t.Fatalf("accepted %s", player)
		}
	}
}

func TestMissingValuesAndPrecisionArePreserved(t *testing.T) {
	if number(nil) != nil || vec([]any{0, nil, 0}) != nil || vec([3]float32{0, float32(math.NaN()), 0}) != nil {
		t.Fatal("missing/nonfinite became coordinates")
	}
	if n := number(float32(0)); n == nil || *n != 0 {
		t.Fatal("genuine zero discarded")
	}
	const resource = uint64(1002260247908348853)
	if normalize(resource) != "1002260247908348853" || number(resource) != nil {
		t.Fatal("resource handle lost precision")
	}
	if _, err := json.Marshal(normalize([3]float32{0, float32(math.Inf(1)), 1})); err != nil {
		t.Fatal(err)
	}
}

func TestFireBulletsOptionalFieldsStayNull(t *testing.T) {
	zero := float32(0)
	message := &msgs2.CMsgTEFireBullets{Inaccuracy: &zero}
	raw, err := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["inaccuracy"] != float64(0) || fields["spread"] != nil || fields["player"] != nil || fields["angles"] != nil {
		t.Fatalf("wire presence lost: %s", raw)
	}
	if _, ok := fields["spread"]; !ok {
		t.Fatal("missing optional field not represented")
	}
}

func TestWorldUpdatesIgnoreIdenticalValuesButRetainStateChanges(t *testing.T) {
	name := "CBodyComponent.m_skeletonInstance.m_angRotation"
	tr := &tracked{category: "world", last: map[string]*clockPoint{}, cache: &dynamicRecord{Fields: map[string]field{name: {Present: true, Value: normalize([3]float32{0, 90, 0})}}}}
	clock := &clockPoint{Frame: 10, Tick: 20}
	recordUpdate(tr, name, st.PropertyValue{Any: [3]float32{0, 90, 0}}, clock)
	if tr.dirty || tr.last[name] != clock {
		t.Fatal("identical world values caused an upsert or lost the observed clock")
	}
	recordUpdate(tr, name, st.PropertyValue{Any: [3]float32{0, 91, 0}}, clock)
	if !tr.dirty {
		t.Fatal("door rotation change was suppressed")
	}
	tr.dirty = false
	recordUpdate(tr, name, st.PropertyValue{Any: nil}, clock)
	if !tr.dirty {
		t.Fatal("property presence loss was suppressed")
	}
	tr.category, tr.dirty = "player", false
	recordUpdate(tr, name, st.PropertyValue{Any: [3]float32{0, 90, 0}}, clock)
	if !tr.dirty {
		t.Fatal("player update clocks must remain observable")
	}
}

func TestWorldFieldsKeepGeometryAndExcludeUnrelatedServices(t *testing.T) {
	for _, name := range []string{"CBodyComponent.m_animationController.m_hGraphDefinitionAG2", "m_Collision.m_vecMaxs", "m_eDoorState", "m_closedPosition", "m_bClientSideRagdoll", "m_bUseAnimGraph", "m_bAnimGraphUpdateEnabled", "m_bDisabled", "m_iHealth", "m_hOwnerEntity", "m_nRenderMode"} {
		if !worldField(name) {
			t.Fatalf("geometry state was excluded: %s", name)
		}
	}
	for _, name := range []string{"m_pCameraServices.m_audio.localSound.0000", "m_pActionTrackingServices.m_iNumRoundKills", "m_flSimulationTime", "m_iAccount"} {
		if worldField(name) {
			t.Fatalf("unrelated state was included: %s", name)
		}
	}
}

type propertyEntity struct {
	st.Entity
	values map[string]any
	id     int
	serial int
}

func (e propertyEntity) ID() int        { return e.id }
func (e propertyEntity) SerialNum() int { return e.serial }

func (e propertyEntity) PropertyValue(name string) (st.PropertyValue, bool) {
	v, ok := e.values[name]
	return st.PropertyValue{S2: true, Any: v}, ok
}

func TestOriginRequiresCompleteNetworkCoordinates(t *testing.T) {
	e := propertyEntity{values: map[string]any{}}
	if origin(e) != nil {
		t.Fatal("absent origin became zero")
	}
	prefix := "CBodyComponent.m_skeletonInstance.m_vecOrigin."
	for _, axis := range []string{"X", "Y", "Z"} {
		e.values[prefix+"m_cell"+axis] = uint64(32)
		e.values[prefix+"m_vec"+axis] = float32(0)
	}
	if pos := origin(e); pos == nil || *pos != (vector{0, 0, 0}) {
		t.Fatal("genuine zero origin missing")
	}
	delete(e.values, prefix+"m_cellY")
	if origin(e) != nil {
		t.Fatal("partial origin filled with zero")
	}
}

func TestEyeAndVelocityFullPathsDoNotCollide(t *testing.T) {
	e := propertyEntity{values: map[string]any{"m_vecViewOffset.m_vecX": float32(0), "m_vecViewOffset.m_vecY": float32(0), "m_vecViewOffset.m_vecZ": float32(64), "m_vecVelocity.m_vecX": float32(200), "m_vecVelocity.m_vecY": float32(0), "m_vecVelocity.m_vecZ": float32(-50)}}
	if *components(e, "m_vecViewOffset") != (vector{0, 0, 64}) || *components(e, "m_vecVelocity") != (vector{200, 0, -50}) {
		t.Fatal("full paths collided")
	}
}

func TestEntityHandleRequiresIndexAndSerial(t *testing.T) {
	e := propertyEntity{id: 517, serial: 123}
	handle := uint64(123<<14 | 517)
	if !matchesHandle(e, handle) || matchesHandle(e, handle+(1<<14)) || matchesHandle(e, handle+1) || matchesHandle(nil, handle) {
		t.Fatal("stale/recycled handle matched")
	}
}

func TestWorldDeltasRetainUnchangedAndReportRemoval(t *testing.T) {
	type entity struct {
		ID     string
		Health int
	}
	previous := map[string]string{}
	key := func(e entity) string { return e.ID }
	first := differences([]entity{{"1:2", 100}}, previous, key, true)
	second := differences([]entity{{"1:2", 100}}, previous, key, false)
	third := differences([]entity{{"1:3", 50}}, previous, key, false)
	if !first.Complete || len(first.Upserts) != 1 || len(second.Upserts) != 0 || len(second.Removed) != 0 || !reflect.DeepEqual(third.Removed, []string{"1:2"}) || len(third.Upserts) != 1 {
		t.Fatalf("invalid deltas: %v %v %v", first, second, third)
	}
}

func TestPlayerFieldDeltasResetAtGapsAndEntityReplacements(t *testing.T) {
	previous := map[string]map[string]string{}
	values := map[string]field{"health": {Present: true, Value: 100}}
	first, full := fieldDifferences(values, previous, "1:2", false)
	if !full || len(first) != 1 {
		t.Fatal("new entity did not receive complete fields")
	}
	next, full := fieldDifferences(values, previous, "1:2", false)
	if full || len(next) != 0 {
		t.Fatal("unchanged field repeated")
	}
	values["health"] = field{Present: false, Value: nil}
	missing, full := fieldDifferences(values, previous, "1:2", false)
	if full || len(missing) != 1 || missing["health"].Present {
		t.Fatal("property disappearance not sent")
	}
	gap, full := fieldDifferences(values, previous, "1:2", true)
	if !full || len(gap) != 1 {
		t.Fatal("window gap did not reset")
	}
	replacement, full := fieldDifferences(values, previous, "1:3", false)
	if !full || len(replacement) != 1 {
		t.Fatal("entity serial replacement inherited state")
	}
	clock := clockPoint{Tick: 10}
	values["health"] = field{Present: false, Value: nil, LastUpdate: &clock}
	changed, _ := fieldDifferences(values, previous, "1:3", false)
	if len(changed) != 1 {
		t.Fatal("wire timestamp change discarded")
	}
}

type shortWriter struct{}

func (shortWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }

func TestEmitterEnforcesCapsAndWriteFailures(t *testing.T) {
	var buffer bytes.Buffer
	e := emitter{out: &buffer}
	if err := e.send(map[string]any{"ok": true}); err != nil || !strings.HasSuffix(buffer.String(), "\n") {
		t.Fatal("invalid NDJSON write")
	}
	if err := (&emitter{out: shortWriter{}}).send(map[string]any{}); err != io.ErrShortWrite {
		t.Fatalf("short write: %v", err)
	}
	if err := e.send(strings.Repeat("x", 2<<20)); err == nil {
		t.Fatal("oversized line accepted")
	}
	e.bytes = maxOutputBytes - 1
	if err := e.send(map[string]any{}); err == nil {
		t.Fatal("output cap ignored")
	}
}

func TestEarlyValidationFailureEmitsFinalError(t *testing.T) {
	var buffer bytes.Buffer
	if err := run(request{}, &buffer); err == nil {
		t.Fatal("invalid request succeeded")
	}
	var end map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buffer.Bytes()), &end); err != nil {
		t.Fatal(err)
	}
	if end["type"] != "end" || end["status"] != "error" || end["emittedTicks"] != float64(0) {
		t.Fatalf("bad error: %v", end)
	}
}

func TestRequestInputIsBoundedAndSingleJSON(t *testing.T) {
	for _, input := range []string{`{} {}`, `{"unexpected":true}`, strings.Repeat(" ", 1<<20) + "{}", `not json`} {
		if _, err := readRequest(strings.NewReader(input)); err == nil {
			t.Fatal("invalid JSON input accepted")
		}
	}
	if _, err := readRequest(strings.NewReader(`{"version":1,"demoPath":"sample.dem","windows":[{"startTick":1,"endTick":2}]}  `)); err != nil {
		t.Fatal(err)
	}
}

func TestRepeatedTickKeepsItsFinalChangedState(t *testing.T) {
	var out bytes.Buffer
	x := extractor{output: emitter{out: &out}, visited: map[int]bool{}, playerPrevious: map[string]map[string]string{}, weaponPrevious: map[string]map[string]string{}, playerWeapon: map[string]string{}, worldPrevious: map[string]string{}, smokePrevious: map[string]string{}}
	makeSnapshot := func(frame, tick, health int) *frameSnapshot {
		return &frameSnapshot{clock: clockPoint{Frame: frame, Tick: tick}, players: []playerRecord{{ID: "1:2", Fields: map[string]field{"health": {Present: true, Value: health}}}}, world: []dynamicRecord{}, smokes: []smokeRecord{}}
	}
	x.queueSnapshot(makeSnapshot(1, 10, 100))
	x.queueSnapshot(makeSnapshot(2, 10, 0))
	if out.Len() != 0 {
		t.Fatal("tick emitted before its final state was known")
	}
	x.queueSnapshot(makeSnapshot(3, 12, 50))
	x.flushFrame()
	decoder := json.NewDecoder(&out)
	var first, second struct {
		Frame   int            `json:"frame"`
		Tick    int            `json:"tick"`
		Players []playerRecord `json:"players"`
	}
	if err := decoder.Decode(&first); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&second); err != nil {
		t.Fatal(err)
	}
	if first.Frame != 2 || first.Tick != 10 || first.Players[0].Fields["health"].Value != float64(0) {
		t.Fatal("duplicate discarded a later death-state change")
	}
	if second.Tick != 12 || !second.Players[0].FieldsComplete || x.frames != 2 || x.duplicateTicks != 1 {
		t.Fatal("gap reset/count mismatch")
	}
}
