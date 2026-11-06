package main

import "testing"

func TestWindowClassCoverageUsesSeparateScanStop(t *testing.T) {
	x := extractor{
		request:          request{Windows: []window{{StartTick: 10, EndTick: 20}, {StartTick: 30, EndTick: 40}}},
		supportedClasses: map[string]int{"CBasePropDoor": 1}, unsupportedClasses: map[string]int{},
	}
	x.captureWindowClasses(20, false)
	if len(x.windowClasses) != 0 {
		t.Fatal("captured before the single-window stopping point")
	}
	x.captureWindowClasses(21, false)
	x.unsupportedClasses["CFutureWall"] = 1
	x.captureWindowClasses(41, false)
	if len(x.windowClasses) != 2 {
		t.Fatalf("unexpected snapshots: %d", len(x.windowClasses))
	}
	if len(x.windowClasses[0].UnsupportedClasses) != 0 {
		t.Fatal("a future unknown class contaminated an earlier window")
	}
	if x.windowClasses[1].UnsupportedClasses["CFutureWall"] != 1 {
		t.Fatal("later coverage missing")
	}
	x.captureWindowClasses(50, true)
	if len(x.windowClasses) != 2 {
		t.Fatal("duplicate snapshots")
	}
}

func TestMissingTailGetsClassCoverageAtEndOfDemo(t *testing.T) {
	x := extractor{request: request{Windows: []window{{StartTick: 10, EndTick: 20}}}, supportedClasses: map[string]int{}, unsupportedClasses: map[string]int{}}
	x.captureWindowClasses(15, true)
	if len(x.windowClasses) != 1 || x.windowClasses[0].EndTick != 20 {
		t.Fatal("missing EOF coverage")
	}
}

func TestOverlappingWindowsKeepOriginalStopsAndLocalDuplicates(t *testing.T) {
	x := extractor{request: request{Windows: []window{{StartTick: 10, EndTick: 40}}},
		requestedWindows: []window{{StartTick: 10, EndTick: 20}, {StartTick: 15, EndTick: 40}},
		supportedClasses: map[string]int{}, unsupportedClasses: map[string]int{}, duplicateTicksByTick: map[int]int{19: 2, 21: 3, 35: 1},
	}
	x.captureWindowClasses(21, false)
	x.captureWindowClasses(41, false)
	if len(x.windowClasses) != 2 || x.windowClasses[0].DuplicateTicks != 2 || x.windowClasses[1].DuplicateTicks != 6 {
		t.Fatalf("overlapping window coverage changed: %#v", x.windowClasses)
	}
}

func TestDynamicPropertySetDropsDisappearedArrayElements(t *testing.T) {
	tr := &tracked{attached: map[string]bool{"rotation": true, "angleChanges.0000": true}}
	setDynamicNames(tr, []string{"rotation", "angleChanges.0000"})
	tr.dirty = false
	setDynamicNames(tr, []string{"rotation"})
	if !tr.dirty || len(tr.dynamicNames) != 1 || tr.dynamicNames[0] != "rotation" {
		t.Fatal("a removed array field survived into a later extraction window")
	}
	tr.dirty = false
	setDynamicNames(tr, []string{"rotation", "angleChanges.0000"})
	if !tr.dirty || len(tr.dynamicNames) != 2 {
		t.Fatal("a returning field was hidden by subscription history")
	}
}
