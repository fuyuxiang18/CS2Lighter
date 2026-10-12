package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/constants"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msgs2"
	st "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/sendtables"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var playerFields = []string{
	"m_iTeamNum", "m_iHealth", "m_lifeState", "m_angEyeAngles", "m_vecViewOffset.m_vecX", "m_vecViewOffset.m_vecY", "m_vecViewOffset.m_vecZ",
	"m_vecVelocity.m_vecX", "m_vecVelocity.m_vecY", "m_vecVelocity.m_vecZ", "m_Collision.m_vecMins", "m_Collision.m_vecMaxs",
	"m_pCameraServices.m_iFOV", "m_pCameraServices.m_iFOVStart", "m_pCameraServices.m_flFOVTime", "m_pCameraServices.m_flFOVRate", "m_bIsScoped",
	"m_pMovementServices.m_flDuckAmount", "m_pMovementServices.m_flDuckViewOffset", "m_pMovementServices.m_flBombPlantViewOffset",
	"m_pAimPunchServices.m_predictableBaseAngle", "m_pAimPunchServices.m_predictableBaseAngleVel", "m_pAimPunchServices.m_predictableBaseTick", "m_pAimPunchServices.m_predictableBaseTickInterpAmount", "m_pAimPunchServices.m_unpredictableBaseAngle", "m_pAimPunchServices.m_unpredictableBaseTick",
	"CBodyComponent.m_skeletonInstance.m_modelState.m_hModel", "CBodyComponent.m_skeletonInstance.m_flScale",
	"m_flFlashDuration", "m_flFlashMaxAlpha", "m_flFlashBangTime",
	"m_fFlags", "m_hGroundEntity", "m_MoveType", "m_nActualMoveType", "m_nWaterLevel",
	"m_ArmorValue", "m_pItemServices.m_bHasHelmet", "m_bIsDefusing", "m_bIsRescuing", "m_bIsGrabbingHostage",
	"m_pMovementServices.m_bDucking", "m_pMovementServices.m_bDucked", "m_pMovementServices.m_flFallVelocity",
	"m_flVelocityModifier", "m_flSimulationTime", "m_flOldSimulationTime", "m_nTickBase",
	"m_pWeaponServices.m_hActiveWeapon", "m_pWeaponServices.m_flNextAttack",
}
var weaponFields = []string{
	"m_AttributeManager.m_Item.m_iItemDefinitionIndex", "m_iClip1", "m_iClip2", "m_bInReload", "m_bReloadHeldSinceStart",
	"m_fLastShotTime", "m_nDeployTick", "m_nNextPrimaryAttackTick", "m_flNextPrimaryAttackTickRatio", "m_nNextSecondaryAttackTick", "m_flNextSecondaryAttackTickRatio",
	"m_flRecoilIndex", "m_iRecoilIndex", "m_fAccuracyPenalty", "m_flAttackHoldStartTime",
	"m_weaponMode", "m_bSilencerOn", "m_bBurstMode", "m_bFireOnEmpty", "m_fFireDuration",
	"m_bStartedArming", "m_bBombPlacedAnimation", "m_flArmedTime", "m_flPostponeFireReadyTime",
	"m_flTurningInaccuracy", "m_flTurningInaccuracyDelta", "m_flLastAccuracyUpdateTime", "m_fAccuracySmoothedForZoom",
}
var weaponGeometryFields = []string{
	"CBodyComponent.m_skeletonInstance.m_modelState.m_hModel", "CBodyComponent.m_skeletonInstance.m_angRotation", "CBodyComponent.m_skeletonInstance.m_flScale", "CBodyComponent.m_skeletonInstance.m_hParent",
	"m_Collision.m_vecMins", "m_Collision.m_vecMaxs", "m_Collision.m_nSolidType", "m_Collision.m_usSolidFlags",
	"m_hOwnerEntity", "m_hEffectEntity", "m_fEffects", "m_nRenderMode", "m_clrRender", "m_bDisabled",
}

type tracked struct {
	entity       st.Entity
	last         map[string]*clockPoint
	attached     map[string]bool
	included     map[string]bool
	category     string
	dynamicNames []string
	propertySet  string
	dirty        bool
	cache        *dynamicRecord
	revision     uint64
}
type frameSnapshot struct {
	clock   clockPoint
	players []playerRecord
	world   []dynamicRecord
	smokes  []smokeRecord
}
type extractor struct {
	p                  dem.Parser
	output             emitter
	request            request
	wanted             map[int]bool
	selected           map[string]bool
	active             map[string]*tracked
	serverTick         *int
	header             *msgs2.CDemoFileHeader
	headerSent         bool
	sourceBytes        int64
	visited            map[int]bool
	worldPrevious      map[string]string
	smokePrevious      map[string]string
	playerPrevious     map[string]map[string]string
	weaponPrevious     map[string]map[string]string
	playerWeapon       map[string]string
	lastFrameTick      *int
	pendingFrame       *frameSnapshot
	supportedClasses   map[string]int
	unsupportedClasses map[string]int
	frames             int
	shots              int
	duplicateTicks     int
	lastProgress       time.Time
	mechanicsTypes     map[string]string
}

func kind(class string) string {
	s := strings.ToLower(class)
	if s == "ccsplayerpawn" {
		return "player"
	}
	if strings.Contains(s, "smokegrenadeprojectile") {
		return "smoke"
	}
	for _, word := range []string{"door", "breakable", "propdynamic", "dynamicprop", "physics"} {
		if strings.Contains(s, word) {
			return "world"
		}
	}
	return "unsupported"
}
func entityID(e st.Entity) string { return fmt.Sprintf("%d:%d", e.ID(), e.SerialNum()) }
func matchesHandle(e st.Entity, handle uint64) bool {
	return e != nil && uint64(e.ID()) == handle&constants.EntityHandleIndexMaskSource2 && uint64(e.SerialNum()) == handle>>constants.MaxEdictBitsSource2
}
func geometryCandidate(e st.Entity) bool {
	for _, name := range []string{"CBodyComponent.m_skeletonInstance.m_modelState.m_hModel", "CBodyComponent.m_sceneNode.m_modelState.m_hModel", "m_Collision.m_nSolidType", "m_Collision.m_vecMins", "m_Collision.m_vecMaxs"} {
		if e.Property(name) != nil {
			return true
		}
	}
	return false
}

func worldField(name string) bool {
	if strings.HasPrefix(name, "CBodyComponent.") || strings.HasPrefix(name, "m_Collision.") {
		return true
	}
	switch name {
	case "m_iHealth", "m_iMaxHealth", "m_lifeState", "m_fFlags", "m_bDisabled", "m_bEnabled", "m_bStartDisabled", "m_bAwake", "m_MoveType", "m_MoveCollide", "m_hGroundEntity", "m_hMaster", "m_flDeathTime":
		return true
	}
	lower := strings.ToLower(name)
	for _, token := range []string{"render", "model", "body", "bone", "mesh", "anim", "ragdoll", "physics", "collision", "solid", "door", "break", "closed", "open", "scale", "angle", "origin", "transform", "parent", "owner", "effect", "fade", "velocity", "rotation", "material", "capsule"} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func recordUpdate(tr *tracked, name string, value st.PropertyValue, clock *clockPoint) {
	tr.last[name] = clock
	if tr.dirty {
		return
	}
	if tr.category == "world" || tr.category == "weapon" {
		if tr.category == "weapon" {
			geometry := false
			for _, fieldName := range weaponGeometryFields {
				geometry = geometry || name == fieldName
			}
			// Origin is also part of the world record. Ammo metadata only belongs
			// to the independent active-weapon stream.
			if !geometry && !strings.Contains(name, ".m_vecOrigin.") {
				return
			}
		}
		if tr.cache != nil {
			previous, exists := tr.cache.Fields[name]
			if exists && previous.Present == (value.Any != nil) && reflect.DeepEqual(previous.Value, normalize(value.Any)) {
				return
			}
		}
	}
	tr.dirty = true
}
func (x *extractor) clock() clockPoint {
	return clockPoint{Frame: x.p.CurrentFrame(), Tick: x.p.GameState().IngameTick(), ServerTick: x.serverTick}
}
func (x *extractor) send(v any) {
	if err := x.output.send(v); err != nil {
		panic(err)
	}
}
func (x *extractor) attach(tr *tracked, duringCreation bool) {
	var names []string
	if tr.category == "player" {
		names = playerFields
	} else if tr.category == "weapon" {
		names = append(append([]string{}, weaponFields...), weaponGeometryFields...)
		for _, node := range []string{"m_skeletonInstance", "m_sceneNode"} {
			for _, name := range []string{"m_cellX", "m_cellY", "m_cellZ", "m_vecX", "m_vecY", "m_vecZ"} {
				names = append(names, "CBodyComponent."+node+".m_vecOrigin."+name)
			}
		}
	} else {
		currentNames := []string{}
		for _, prop := range tr.entity.Properties() {
			if tr.category == "world" {
				included, known := tr.included[prop.Name()]
				if !known {
					included = worldField(prop.Name())
					tr.included[prop.Name()] = included
				}
				if !included {
					continue
				}
			}
			if !strings.HasPrefix(prop.Name(), "m_VoxelFrameData.") {
				names = append(names, prop.Name())
				if prop.Name() != "m_VoxelFrameData" {
					currentNames = append(currentNames, prop.Name())
				}
			}
		}
		propertySet := strings.Join(currentNames, "\x00")
		if propertySet != tr.propertySet {
			tr.dirty = true
			tr.propertySet = propertySet
		}
		for _, name := range currentNames {
			if !tr.attached[name] {
				tr.dynamicNames = append(tr.dynamicNames, name)
			}
		}
	}
	for _, name := range names {
		if tr.attached[name] {
			continue
		}
		prop := tr.entity.Property(name)
		if prop == nil {
			continue
		}
		tr.attached[name] = true
		initial := duringCreation
		prop.OnUpdate(func(value st.PropertyValue) {
			if initial {
				tr.dirty = true
				initial = false
				return
			}
			clock := x.clock()
			recordUpdate(tr, name, value, &clock)
		})
	}
}
func (x *extractor) fields(tr *tracked, names []string) map[string]field {
	result := map[string]field{}
	for _, name := range names {
		value, present := tr.entity.PropertyValue(name)
		result[name] = field{Present: present && value.Any != nil, Value: normalize(value.Any), LastUpdate: tr.last[name]}
		if name == "m_nNextPrimaryAttackTick" || name == "m_nNextSecondaryAttackTick" || name == "m_nDeployTick" {
			decoded := decodeGameTick(value.Any, x.mechanicsTypes[name])
			result["decoded."+name] = field{Present: present && decoded != nil, Value: decoded, LastUpdate: tr.last[name]}
		}
	}
	return result
}

// The pinned demoinfocs decoder falls back to unsigned varint for GameTick_t.
// Valve serializes that signed typedef as ZigZag. Only correct a field when the
// demo's own flattened serializer confirms its type; raw values are retained.
func decodeGameTick(value any, typeName string) *int64 {
	if typeName == "GameTick_t" {
		var u uint64
		switch v := value.(type) {
		case uint32:
			u = uint64(v)
		case uint64:
			u = v
		default:
			return nil
		}
		if u > 0xffffffff {
			return nil
		}
		n := int64(u>>1) ^ -int64(u&1)
		return &n
	}
	if typeName == "int32" {
		v, ok := value.(int32)
		if ok {
			n := int64(v)
			return &n
		}
	}
	return nil
}

func (x *extractor) mechanicsSchema(message *msgs2.CDemoSendTables) {
	size, count := binary.Uvarint(message.Data)
	if count <= 0 || size > 32<<20 || size > uint64(len(message.Data)-count) {
		return
	}
	var schema msgs2.CSVCMsg_FlattenedSerializer
	if proto.Unmarshal(message.Data[count:count+int(size)], &schema) != nil {
		return
	}
	x.mechanicsTypes = map[string]string{}
	for _, f := range schema.Fields {
		if f.VarNameSym == nil || f.VarTypeSym == nil || *f.VarNameSym < 0 || *f.VarTypeSym < 0 || int(*f.VarNameSym) >= len(schema.Symbols) || int(*f.VarTypeSym) >= len(schema.Symbols) {
			continue
		}
		name, typ := schema.Symbols[*f.VarNameSym], schema.Symbols[*f.VarTypeSym]
		if name != "m_nNextPrimaryAttackTick" && name != "m_nNextSecondaryAttackTick" && name != "m_nDeployTick" {
			continue
		}
		if previous, exists := x.mechanicsTypes[name]; exists && previous != typ {
			x.mechanicsTypes[name] = "ambiguous"
		} else {
			x.mechanicsTypes[name] = typ
		}
	}
}
func raw(e st.Entity, name string) any {
	value, present := e.PropertyValue(name)
	if !present {
		return nil
	}
	return value.Any
}
func origin(e st.Entity) *vector {
	// Position() in the parser returns a zero vector when network coordinates
	// are absent. Read the actual cell fields so missing is never a real origin.
	for _, node := range []string{"m_skeletonInstance", "m_sceneNode"} {
		prefix := "CBodyComponent." + node + ".m_vecOrigin."
		var result vector
		complete := true
		for i, axis := range []string{"X", "Y", "Z"} {
			cell, offset := number(raw(e, prefix+"m_cell"+axis)), number(raw(e, prefix+"m_vec"+axis))
			if cell == nil || offset == nil {
				complete = false
				break
			}
			result[i] = *cell*512 - 16384 + *offset
		}
		if complete {
			return &result
		}
	}
	return nil
}
func components(e st.Entity, prefix string) *vector {
	a, b, c := number(raw(e, prefix+".m_vecX")), number(raw(e, prefix+".m_vecY")), number(raw(e, prefix+".m_vecZ"))
	if a == nil || b == nil || c == nil {
		return nil
	}
	return &vector{*a, *b, *c}
}
func (x *extractor) playerSteamID(e st.Entity) *string {
	for _, player := range x.p.GameState().Participants().All() {
		if player.Entity == nil {
			continue
		}
		handle, ok := raw(player.Entity, "m_hPlayerPawn").(uint64)
		if !ok || !matchesHandle(e, handle) {
			continue
		}
		pawn := player.PlayerPawnEntity()
		if pawn != nil && entityID(pawn) == entityID(e) && player.SteamID64 > 0 {
			id := strconv.FormatUint(player.SteamID64, 10)
			if len(id) == 17 {
				return &id
			}
		}
	}
	return nil
}
func (x *extractor) player(tr *tracked) playerRecord {
	e := tr.entity
	pos := origin(e)
	offset := components(e, "m_vecViewOffset")
	var eyes *vector
	if pos != nil && offset != nil {
		eyes = &vector{pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]}
	}
	angle := vec(raw(e, "m_angEyeAngles"))
	var yaw, pitch *float64
	if angle != nil {
		yaw = &angle[1]
		pitch = &angle[0]
	}
	fields := x.fields(tr, playerFields)
	// Tick base is owned by the controller in Source 2. Keep it separate from
	// the server clock: it is not necessarily the packet's server tick.
	fields["controller.m_nTickBase"] = field{Present: false, Value: nil}
	for _, participant := range x.p.GameState().Participants().All() {
		if participant.Entity == nil {
			continue
		}
		handle, ok := raw(participant.Entity, "m_hPlayerPawn").(uint64)
		if ok && matchesHandle(e, handle) {
			v, present := participant.Entity.PropertyValue("m_nTickBase")
			fields["controller.m_nTickBase"] = field{Present: present && v.Any != nil, Value: normalize(v.Any), LastUpdate: nil}
			break
		}
	}
	return playerRecord{ID: entityID(e), SteamID: x.playerSteamID(e), Origin: pos, Eyes: eyes, Yaw: yaw, Pitch: pitch, Velocity: components(e, "m_vecVelocity"), Team: number(raw(e, "m_iTeamNum")), Health: number(raw(e, "m_iHealth")), LifeState: number(raw(e, "m_lifeState")), Hull: hull{Mins: vec(raw(e, "m_Collision.m_vecMins")), Maxs: vec(raw(e, "m_Collision.m_vecMaxs"))}, FieldsComplete: true, Fields: fields, ActiveWeapon: x.activeWeapon(e)}
}

func (x *extractor) activeWeapon(pawn st.Entity) *weaponRecord {
	handle, ok := raw(pawn, "m_pWeaponServices.m_hActiveWeapon").(uint64)
	if !ok {
		return nil
	}
	entity := x.p.GameState().EntityByHandle(handle)
	if !matchesHandle(entity, handle) {
		return nil
	}
	id := entityID(entity)
	tr := x.active[id]
	if tr == nil || tr.category != "weapon" {
		return nil
	}
	x.attach(tr, false)
	return &weaponRecord{ID: id, ClassName: entity.ServerClass().Name(), FieldsComplete: true, Fields: x.fields(tr, weaponFields)}
}

func fieldDifferences(fields map[string]field, previous map[string]map[string]string, id string, complete bool) (map[string]field, bool) {
	state, exists := previous[id]
	if !exists || complete {
		state = map[string]string{}
		previous[id] = state
		complete = true
	}
	result := map[string]field{}
	for name, value := range fields {
		encoded, err := json.Marshal(value)
		if err != nil {
			panic(err)
		}
		serialized := string(encoded)
		if complete || state[name] != serialized {
			result[name] = value
		}
		state[name] = serialized
	}
	return result, complete
}
func (x *extractor) dynamic(tr *tracked) dynamicRecord {
	if tr.cache != nil && !tr.dirty {
		return *tr.cache
	}
	tr.revision++
	names := tr.dynamicNames
	if tr.category == "weapon" {
		names = weaponGeometryFields
	}
	tr.cache = &dynamicRecord{ID: entityID(tr.entity), ClassName: tr.entity.ServerClass().Name(), Origin: origin(tr.entity), Fields: x.fields(tr, names), revision: tr.revision}
	tr.dirty = false
	return *tr.cache
}
func integer(v any) *int {
	n := number(v)
	if n == nil || *n != float64(int(*n)) {
		return nil
	}
	out := int(*n)
	return &out
}
func smokeBytes(e st.Entity) *string {
	value := raw(e, "m_VoxelFrameData")
	var bytes []byte
	switch values := value.(type) {
	case []byte:
		bytes = values
	case []any:
		if len(values) > 1<<20 {
			return nil
		}
		bytes = make([]byte, len(values))
		for i, value := range values {
			n := integer(value)
			if n == nil || *n < 0 || *n > 255 {
				return nil
			}
			bytes[i] = byte(*n)
		}
	default:
		return nil
	}
	encoded := base64.StdEncoding.EncodeToString(bytes)
	return &encoded
}
func differences[T any](records []T, previous map[string]string, id func(T) string, complete bool) delta[T] {
	result := delta[T]{Complete: complete, Upserts: []T{}, Removed: []string{}}
	current := map[string]bool{}
	for _, record := range records {
		key := id(record)
		current[key] = true
		var value string
		switch r := any(record).(type) {
		case dynamicRecord:
			value = strconv.FormatUint(r.revision, 10)
		case smokeRecord:
			value = strconv.FormatUint(r.revision, 10) + ":"
			if r.FrameDataBase64 != nil {
				value += *r.FrameDataBase64
			} else {
				value += "null"
			}
		default:
			b, err := json.Marshal(record)
			if err != nil {
				panic(err)
			}
			value = string(b)
		}
		if complete || previous[key] != value {
			result.Upserts = append(result.Upserts, record)
		}
		previous[key] = value
	}
	for key := range previous {
		if !current[key] {
			result.Removed = append(result.Removed, key)
			delete(previous, key)
		}
	}
	sort.Strings(result.Removed)
	return result
}
func (x *extractor) emitHeader() {
	if x.headerSent || x.header == nil || x.p.TickRate() <= 0 {
		return
	}
	x.headerSent = true
	x.send(map[string]any{"type": "header", "version": protocolVersion, "parserVersion": parserVersion, "mapName": x.header.GetMapName(), "patch": x.header.PatchVersion, "buildNum": x.header.BuildNum, "sourceBytes": x.sourceBytes, "tickRate": x.p.TickRate(), "windows": x.request.Windows, "requestedTicks": len(x.wanted), "playerFieldsMode": "delta"})
}
func (x *extractor) frame() {
	clock := x.clock()
	x.emitHeader()
	if !x.headerSent {
		return
	}
	if time.Since(x.lastProgress) > 500*time.Millisecond {
		x.send(map[string]any{"type": "progress", "frame": clock.Frame, "tick": clock.Tick, "requestedTicks": len(x.wanted), "emittedTicks": len(x.visited)})
		x.lastProgress = time.Now()
	}
	if x.pendingFrame != nil && x.pendingFrame.clock.Tick != clock.Tick {
		x.flushFrame()
	}
	if !x.wanted[clock.Tick] {
		return
	}
	players := []playerRecord{}
	world := []dynamicRecord{}
	smokes := []smokeRecord{}
	ids := make([]string, 0, len(x.active))
	for id := range x.active {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		tr := x.active[id]
		switch tr.category {
		case "player":
			x.attach(tr, false)
			player := x.player(tr)
			if len(x.selected) == 0 || (player.SteamID != nil && x.selected[*player.SteamID]) {
				players = append(players, player)
			}
		case "world":
			x.attach(tr, false)
			world = append(world, x.dynamic(tr))
		case "weapon":
			x.attach(tr, false)
			world = append(world, x.dynamic(tr))
		case "smoke":
			x.attach(tr, false)
			smokes = append(smokes, smokeRecord{dynamicRecord: x.dynamic(tr), FrameDataBase64: smokeBytes(tr.entity), DeclaredSize: integer(raw(tr.entity, "m_nVoxelFrameDataSize")), Update: integer(raw(tr.entity, "m_nVoxelUpdate"))})
		}
	}
	x.queueSnapshot(&frameSnapshot{clock: clock, players: players, world: world, smokes: smokes})
}

func (x *extractor) queueSnapshot(snapshot *frameSnapshot) {
	if x.pendingFrame != nil && x.pendingFrame.clock.Tick != snapshot.clock.Tick {
		x.flushFrame()
	}
	if x.lastFrameTick != nil && snapshot.clock.Tick <= *x.lastFrameTick {
		panic(errors.New("demo frames moved backward in time"))
	}
	if x.pendingFrame != nil {
		x.duplicateTicks++
	}
	x.pendingFrame = snapshot
}

func (x *extractor) flushFrame() {
	snapshot := x.pendingFrame
	if snapshot == nil {
		return
	}
	x.pendingFrame = nil
	clock := snapshot.clock
	complete := len(x.visited) == 0
	fieldsComplete := x.lastFrameTick == nil || clock.Tick != *x.lastFrameTick+1
	for i := range snapshot.players {
		player := &snapshot.players[i]
		player.Fields, player.FieldsComplete = fieldDifferences(player.Fields, x.playerPrevious, player.ID, fieldsComplete)
		if weapon := player.ActiveWeapon; weapon != nil {
			changedWeapon := x.playerWeapon[player.ID] != weapon.ID
			x.playerWeapon[player.ID] = weapon.ID
			weapon.Fields, weapon.FieldsComplete = fieldDifferences(weapon.Fields, x.weaponPrevious, player.ID+"/"+weapon.ID, fieldsComplete || changedWeapon)
		} else {
			delete(x.playerWeapon, player.ID)
		}
	}
	x.frames++
	x.visited[clock.Tick] = true
	x.lastFrameTick = &clock.Tick
	x.send(map[string]any{"type": "frame", "frame": clock.Frame, "tick": clock.Tick, "serverTick": clock.ServerTick, "players": snapshot.players, "world": differences(snapshot.world, x.worldPrevious, func(r dynamicRecord) string { return r.ID }, complete), "smokes": differences(snapshot.smokes, x.smokePrevious, func(r smokeRecord) string { return r.ID }, complete)})
}
func (x *extractor) shot(message *msgs2.CMsgTEFireBullets) {
	clock := x.clock()
	if !x.wanted[clock.Tick] {
		return
	}
	x.emitHeader()
	if !x.headerSent {
		return
	}
	var steamID *string
	var playerEntityID *string
	var slot *int
	if message.Player != nil {
		for _, player := range x.p.GameState().Participants().All() {
			if player.Entity == nil {
				continue
			}
			handle := raw(player.Entity, "m_hPlayerPawn")
			n := number(handle)
			if n == nil || uint64(*n) != uint64(*message.Player) {
				continue
			}
			pawn := player.PlayerPawnEntity()
			if !matchesHandle(pawn, uint64(*message.Player)) {
				continue
			}
			steamID = x.playerSteamID(pawn)
			id := entityID(pawn)
			playerEntityID = &id
			s := player.EntityID - 1
			if s >= 0 && s < 64 {
				slot = &s
			}
			break
		}
	}
	if len(x.selected) > 0 && steamID != nil && !x.selected[*steamID] {
		return
	}
	raw, err := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(message)
	if err != nil {
		panic(err)
	}
	x.emitHeader()
	x.shots++
	conVars := map[string]string{}
	for _, name := range []string{"weapon_accuracy_nospread", "weapon_accuracy_forcespread", "weapon_air_spread_scale", "weapon_recoil_scale", "sv_maxunlag"} {
		if value, found := x.p.GameState().Rules().ConVars()[name]; found && len(value) <= 64 {
			conVars[name] = value
		}
	}
	x.send(map[string]any{"type": "shot", "frame": clock.Frame, "tick": clock.Tick, "serverTick": clock.ServerTick, "playerHandle": message.Player, "playerEntityId": playerEntityID, "playerSlot": slot, "steamId": steamID, "raw": json.RawMessage(raw), "conVars": conVars})
}
func run(req request, writer io.Writer) (result error) {
	started := false
	defer func() {
		if !started && result != nil {
			writeRequestError(writer, result)
		}
	}()
	wanted, err := validateRequest(&req)
	if err != nil {
		return err
	}
	file, err := os.Open(req.DemoPath)
	if err != nil {
		return err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	if !stat.Mode().IsRegular() {
		return errors.New("demo is not a regular file")
	}
	p := dem.NewParser(file)
	defer p.Close()
	x := extractor{p: p, output: emitter{out: writer}, request: req, wanted: wanted, selected: map[string]bool{}, active: map[string]*tracked{}, sourceBytes: stat.Size(), visited: map[int]bool{}, worldPrevious: map[string]string{}, smokePrevious: map[string]string{}, playerPrevious: map[string]map[string]string{}, weaponPrevious: map[string]map[string]string{}, playerWeapon: map[string]string{}, supportedClasses: map[string]int{}, unsupportedClasses: map[string]int{}}
	started = true
	for _, id := range req.Players {
		x.selected[id] = true
	}
	defer func() {
		if failure := recover(); failure != nil {
			result = fmt.Errorf("evidence extraction failed: %v", failure)
		}
		missing := []int{}
		for tick := range wanted {
			if !x.visited[tick] {
				missing = append(missing, tick)
			}
		}
		sort.Ints(missing)
		status := "ok"
		var errorText *string
		if result != nil {
			status = "error"
			text := result.Error()
			errorText = &text
		}
		end := map[string]any{"type": "end", "status": status, "emittedTicks": len(x.visited), "missingTicks": missing, "duplicateTicks": x.duplicateTicks, "frames": x.frames, "shots": x.shots, "supportedClasses": x.supportedClasses, "unsupportedClasses": x.unsupportedClasses, "outputBytes": x.output.bytes, "capabilities": []string{"bounded-player-fields", "dynamic-entity-state", "environment-model-candidates", "raw-smoke-frame", "raw-fire-bullets"}, "error": errorText}
		end["mechanicsFieldTypes"] = x.mechanicsTypes
		if err := x.output.send(end); result == nil && err != nil {
			result = err
		}
	}()
	p.RegisterNetMessageHandler(func(header *msgs2.CDemoFileHeader) { x.header = header })
	p.RegisterNetMessageHandler(x.mechanicsSchema)
	p.RegisterNetMessageHandler(func(tick *msgs2.CNETMsg_Tick) {
		if tick.Tick != nil {
			n := int(*tick.Tick)
			x.serverTick = &n
		}
	})
	p.RegisterNetMessageHandler(x.shot)
	p.RegisterEventHandler(func(events.DataTablesParsed) {
		for _, class := range p.ServerClasses().All() {
			class.OnEntityCreated(func(e st.Entity) {
				className := e.ServerClass().Name()
				category := kind(className)
				if category == "unsupported" && e.Property("m_AttributeManager.m_Item.m_iItemDefinitionIndex") != nil {
					category = "weapon"
				}
				if category == "unsupported" && geometryCandidate(e) {
					category = "world"
				}
				if category == "unsupported" {
					x.unsupportedClasses[className]++
					return
				}
				x.supportedClasses[className]++
				id := entityID(e)
				tr := &tracked{entity: e, last: map[string]*clockPoint{}, attached: map[string]bool{}, included: map[string]bool{}, category: category}
				x.active[id] = tr
				e.OnDestroy(func() { delete(x.active, id); delete(x.playerPrevious, id) })
				e.OnCreateFinished(func() { x.attach(tr, true) })
			})
		}
	})
	p.RegisterEventHandler(func(events.FrameDone) { x.frame() })
	lastTick := req.Windows[len(req.Windows)-1].EndTick
	for {
		more, err := p.ParseNextFrame()
		if err != nil {
			return err
		}
		if !more || p.GameState().IngameTick() > lastTick {
			break
		}
	}
	x.flushFrame()
	if !x.headerSent {
		return errors.New("no CS2 demo header was read")
	}
	return nil
}
func main() {
	req, err := readRequest(os.Stdin)
	if err != nil {
		writeRequestError(os.Stdout, err)
		os.Exit(1)
	}
	if err := run(req, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func readRequest(reader io.Reader) (request, error) {
	var req request
	data, err := io.ReadAll(io.LimitReader(reader, (1<<20)+1))
	if err != nil {
		return req, err
	}
	if len(data) > 1<<20 {
		return req, errors.New("evidence request exceeds 1 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return req, errors.New("invalid evidence JSON request")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return req, errors.New("expected exactly one evidence request")
	}
	return req, nil
}

func writeRequestError(writer io.Writer, err error) {
	_ = json.NewEncoder(writer).Encode(map[string]any{"type": "end", "status": "error", "emittedTicks": 0, "missingTicks": []int{}, "duplicateTicks": 0, "frames": 0, "shots": 0, "supportedClasses": map[string]int{}, "unsupportedClasses": map[string]int{}, "outputBytes": 0, "capabilities": []string{}, "error": err.Error()})
}
