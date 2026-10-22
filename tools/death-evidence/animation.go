package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"sort"

	"github.com/golang/snappy"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/msgs2"
	st "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/sendtables"
)

const animationPrefix = "CBodyComponent.m_animationController."
const maxAnimationBytes = 1 << 20
const maxAnimationEntries = 4096

type animationRecipe struct {
	ContextID      int     `json:"contextId"`
	RecipeVersion  *int    `json:"recipeVersion"`
	ActiveSlot     *int    `json:"activeSlot"`
	TopologyBase64 *string `json:"topologyBase64"`
	DynamicBase64  *string `json:"dynamicBase64"`
}
type animationTaskType struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}
type animationAsset struct {
	Index      int    `json:"index"`
	Path       string `json:"path"`
	DataBase64 string `json:"dataBase64"`
}
type animationContext struct {
	Type      string              `json:"type"`
	Frame     int                 `json:"frame"`
	Tick      int                 `json:"tick"`
	ContextID int                 `json:"contextId"`
	TaskTypes []animationTaskType `json:"taskTypes"`
	Assets    []animationAsset    `json:"assets"`
	Errors    []string            `json:"errors"`
}
type animationTableItem struct {
	index int
	key   string
	data  []byte
}
type animationTable struct {
	name     string
	fixed    bool
	userBits int
	flags    int32
	varint   bool
	items    map[int]animationTableItem
}
type animationState struct {
	tables   []*animationTable
	revision int
	emitted  int
	errors   []string
}

// The bit layout follows the pinned demoinfocs Source 2 string-table decoder.
// This bounded reader is independent because the upstream reader is internal.
type animationBitReader struct {
	data   []byte
	offset int
}

func (r *animationBitReader) read(n int) uint32 {
	if n < 0 || n > 32 || r.offset+n > len(r.data)*8 {
		panic(errors.New("truncated animation string table"))
	}
	var v uint32
	for i := 0; i < n; i++ {
		v |= uint32((r.data[r.offset/8]>>uint(r.offset%8))&1) << uint(i)
		r.offset++
	}
	return v
}
func (r *animationBitReader) flag() bool { return r.read(1) != 0 }
func (r *animationBitReader) text() string {
	b := []byte{}
	for {
		v := byte(r.read(8))
		if v == 0 {
			return string(b)
		}
		if len(b) >= 2048 {
			panic(errors.New("animation string too long"))
		}
		b = append(b, v)
	}
}
func (r *animationBitReader) varint() uint32 {
	var v uint32
	for i := 0; i < 5; i++ {
		b := r.read(8)
		if i == 4 && b > 15 {
			panic(errors.New("animation varint overflow"))
		}
		v |= (b & 127) << uint(i*7)
		if b < 128 {
			return v
		}
	}
	panic(errors.New("invalid animation varint"))
}
func (r *animationBitReader) ubit() uint32 {
	v := r.read(6)
	switch v & 48 {
	case 16:
		return (v & 15) | (r.read(4) << 4)
	case 32:
		return (v & 15) | (r.read(8) << 4)
	case 48:
		return (v & 15) | (r.read(28) << 4)
	}
	return v
}
func boundedAnimationDecompress(data []byte) []byte {
	size, err := snappy.DecodedLen(data)
	if err != nil || size > maxAnimationBytes {
		panic(errors.New("invalid animation compression"))
	}
	result, err := snappy.Decode(nil, data)
	if err != nil {
		panic(errors.New("invalid animation compression"))
	}
	return result
}
func decodeAnimationTable(data []byte, count int, table *animationTable) (items []animationTableItem, err error) {
	defer func() {
		if failure := recover(); failure != nil {
			items = nil
			err = fmt.Errorf("animation table decoding failed: %v", failure)
		}
	}()
	if count < 0 || count > maxAnimationEntries || len(data) > maxAnimationBytes {
		return nil, errors.New("animation table limit exceeded")
	}
	r := animationBitReader{data: data}
	index := -1
	history := []string{}
	items = []animationTableItem{}
	for i := 0; i < count; i++ {
		if r.flag() {
			index++
		} else {
			index = int(r.varint()) + 1
		}
		if index < 0 || index >= maxAnimationEntries {
			return nil, errors.New("animation table index limit exceeded")
		}
		key := ""
		if r.flag() {
			if r.flag() {
				pos, size := int(r.read(5)), int(r.read(5))
				if pos >= len(history) || size > len(history[pos]) {
					return nil, errors.New("invalid animation key history")
				}
				key = history[pos][:size] + r.text()
			} else {
				key = r.text()
			}
			if len(key) > 2048 {
				return nil, errors.New("animation string too long")
			}
			history = append(history, key)
			if len(history) > 32 {
				history = history[1:]
			}
		}
		var value []byte
		if r.flag() {
			compressed := false
			bitSize := 0
			if table.fixed {
				bitSize = table.userBits
			} else {
				if table.flags&1 != 0 {
					compressed = r.flag()
				}
				if table.varint {
					bitSize = int(r.ubit()) * 8
				} else {
					bitSize = int(r.read(17)) * 8
				}
			}
			if bitSize < 0 || bitSize > maxAnimationBytes*8 || r.offset+bitSize > len(data)*8 {
				return nil, errors.New("animation item size limit exceeded")
			}
			value = make([]byte, (bitSize+7)/8)
			for bit := 0; bit < bitSize; bit++ {
				value[bit/8] |= byte(r.read(1)) << uint(bit%8)
			}
			if compressed {
				value = boundedAnimationDecompress(value)
			}
		}
		items = append(items, animationTableItem{index, key, value})
	}
	return items, nil
}
func (a *animationState) fail(reason string) {
	for _, existing := range a.errors {
		if existing == reason {
			return
		}
	}
	if len(a.errors) < 16 {
		a.errors = append(a.errors, reason)
	}
	a.revision++
}
func (a *animationState) apply(table *animationTable, items []animationTableItem) {
	// Apply atomically so a truncated update cannot leave a plausible partial context.
	copyItems := make(map[int]animationTableItem, len(table.items)+len(items))
	for index, item := range table.items {
		copyItems[index] = item
	}
	for _, item := range items {
		previous := copyItems[item.index]
		if item.key == "" {
			item.key = previous.key
		}
		if item.data == nil {
			item.data = previous.data
		}
		if item.key == "" {
			a.fail("animation-table-missing-key")
			return
		}
		copyItems[item.index] = item
	}
	total := 0
	for _, other := range a.tables {
		source := other.items
		if other == table {
			source = copyItems
		}
		for _, item := range source {
			total += len(item.key) + len(item.data)
		}
	}
	if total > maxAnimationBytes || len(copyItems) > maxAnimationEntries || (table.name == "AnimTaskTypes" && len(copyItems) > 255) {
		a.fail("animation-context-size-limit")
		return
	}
	table.items = copyItems
	a.revision++
}
func (x *extractor) animationCreate(message *msgs2.CSVCMsg_CreateStringTable) {
	a := &x.animation
	if len(a.tables) >= maxAnimationEntries {
		a.fail("animation-table-count-limit")
		return
	}
	table := &animationTable{name: message.GetName(), fixed: message.GetUserDataFixedSize(), userBits: int(message.GetUserDataSize()), flags: message.GetFlags(), varint: message.GetUsingVarintBitcounts(), items: map[int]animationTableItem{}}
	// Every table occupies an ID, including tables that carry no animation data.
	a.tables = append(a.tables, table)
	if table.name != "AnimTaskTypes" && table.name != "AnimAssetData" {
		return
	}
	defer func() {
		if recover() != nil {
			a.fail("animation-table-decompression-failed")
		}
	}()
	data := message.GetStringData()
	if message.GetDataCompressed() {
		data = boundedAnimationDecompress(data)
	}
	items, err := decodeAnimationTable(data, int(message.GetNumEntries()), table)
	if err != nil {
		a.fail("animation-table-decode-failed")
		return
	}
	a.apply(table, items)
}
func (x *extractor) animationUpdate(message *msgs2.CSVCMsg_UpdateStringTable) {
	a := &x.animation
	index := int(message.GetTableId())
	if index < 0 || index >= len(a.tables) {
		a.fail("animation-table-id-missing")
		return
	}
	table := a.tables[index]
	if table.name != "AnimTaskTypes" && table.name != "AnimAssetData" {
		return
	}
	count := 1
	if message.NumChangedEntries != nil {
		count = int(message.GetNumChangedEntries())
	}
	items, err := decodeAnimationTable(message.GetStringData(), count, table)
	if err != nil {
		a.fail("animation-table-decode-failed")
		return
	}
	a.apply(table, items)
}
func (x *extractor) animationClear(_ *msgs2.CSVCMsg_ClearAllStringTables) {
	x.animation.tables = nil
	x.animation.errors = nil
	x.animation.revision++
}
func (x *extractor) emitAnimationContext(clock clockPoint) {
	a := &x.animation
	if !x.wanted[clock.Tick] || a.emitted == a.revision+1 {
		return
	}
	context := animationContext{Type: "animation-context", Frame: clock.Frame, Tick: clock.Tick, ContextID: a.revision + 1, TaskTypes: []animationTaskType{}, Assets: []animationAsset{}, Errors: append([]string{}, a.errors...)}
	for _, table := range a.tables {
		if table.name != "AnimTaskTypes" && table.name != "AnimAssetData" {
			continue
		}
		indices := []int{}
		for index := range table.items {
			indices = append(indices, index)
		}
		sort.Ints(indices)
		for _, index := range indices {
			item := table.items[index]
			if table.name == "AnimTaskTypes" {
				context.TaskTypes = append(context.TaskTypes, animationTaskType{index, item.key})
			} else {
				context.Assets = append(context.Assets, animationAsset{index, item.key, base64.StdEncoding.EncodeToString(item.data)})
			}
		}
	}
	x.send(context)
	a.emitted = a.revision + 1
}
func animationFields() []string {
	names := append([]string{}, playerFields...)
	for _, name := range []string{"m_nSerializePoseRecipeVersionAG2", "m_nSerializePoseRecipeAG2ActiveSlot", "m_hGraphDefinitionAG2", "m_primaryGraphId", "m_nServerGraphInstanceIteration", "m_nServerSerializationContextIteration"} {
		names = append(names, animationPrefix+name)
	}
	for _, name := range []string{"m_nHitboxSet", "m_flRootBoneOffset_x", "m_flRootBoneOffset_y", "m_flRootBoneOffset_z", "m_nRootBoneOffsetResetSerialNumber"} {
		names = append(names, "CBodyComponent.m_skeletonInstance.m_modelState."+name)
	}
	names = append(names, "CBodyComponent.m_skeletonInstance.m_angRotation")
	for _, name := range []string{"m_vecExternalGraphIds", "m_vecExternalClipIds", "m_vecSecondarySkeletonSlotIDs", "m_vecSecondarySkeletons"} {
		names = append(names, animationPrefix+name)
	}
	return names
}
func (x *extractor) animationRecipe(entity st.Entity) *animationRecipe {
	version := integer(raw(entity, animationPrefix+"m_nSerializePoseRecipeVersionAG2"))
	slot := animationActiveSlot(raw(entity, animationPrefix+"m_nSerializePoseRecipeAG2ActiveSlot"), raw(entity, animationPrefix+"m_SerializePoseRecipeAG2Slots"))
	if version == nil && slot == nil {
		return nil
	}
	result := &animationRecipe{ContextID: x.animation.revision + 1, RecipeVersion: version, ActiveSlot: slot}
	if slot != nil {
		if topology, ok := raw(entity, fmt.Sprintf("%sm_SerializePoseRecipeAG2Slots.%04d.m_topology", animationPrefix, *slot)).([]byte); ok && len(topology) <= 4096 {
			encoded := base64.StdEncoding.EncodeToString(topology)
			result.TopologyBase64 = &encoded
		}
	}
	result.DynamicBase64 = animationByteVector(raw(entity, animationPrefix+"m_SerializePoseRecipeAG2Dynamic"))
	return result
}

func animationActiveSlot(value any, slotsValue any) *int {
	slot := integer(value)
	slots, ok := slotsValue.([]any)
	if slot == nil || !ok || len(slots) == 0 || len(slots) > 32 || *slot < 0 || *slot >= len(slots) || slots[*slot] == nil {
		return nil
	}
	return slot
}

func animationByteVector(value any) *string {
	var data []byte
	switch values := value.(type) {
	case []byte:
		data = values
	case []any:
		if len(values) > 4096 {
			return nil
		}
		data = make([]byte, len(values))
		for i, v := range values {
			n := integer(v)
			if n == nil || *n < 0 || *n > 255 {
				return nil
			}
			data[i] = byte(*n)
		}
	default:
		return nil
	}
	if len(data) == 0 || len(data) > 4096 {
		return nil
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	return &encoded
}
