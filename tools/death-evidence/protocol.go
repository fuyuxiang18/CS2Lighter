package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
)

const protocolVersion = 1
const parserVersion = "demoinfocs-v4.5.2-0.20260909182438-8e1342e6585c"
const maxTicks = 4096
const maxSafeInteger = (1 << 53) - 1
const maxOutputBytes = 128 << 20

type window struct {
	StartTick int `json:"startTick"`
	EndTick   int `json:"endTick"`
}
type request struct {
	Version  int      `json:"version"`
	DemoPath string   `json:"demoPath"`
	Windows  []window `json:"windows"`
	Players  []string `json:"players,omitempty"`
}
type clockPoint struct {
	Frame      int  `json:"frame"`
	Tick       int  `json:"tick"`
	ServerTick *int `json:"serverTick"`
}
type field struct {
	Present    bool        `json:"present"`
	Value      any         `json:"value"`
	LastUpdate *clockPoint `json:"lastUpdate"`
}
type vector = [3]float64
type hull struct {
	Mins *vector `json:"mins"`
	Maxs *vector `json:"maxs"`
}
type playerRecord struct {
	ID             string           `json:"id"`
	SteamID        *string          `json:"steamId"`
	Origin         *vector          `json:"origin"`
	Eyes           *vector          `json:"eyes"`
	Yaw            *float64         `json:"yaw"`
	Pitch          *float64         `json:"pitch"`
	Velocity       *vector          `json:"velocity"`
	Team           *float64         `json:"team"`
	Health         *float64         `json:"health"`
	LifeState      *float64         `json:"lifeState"`
	Hull           hull             `json:"hull"`
	FieldsComplete bool             `json:"fieldsComplete"`
	Fields         map[string]field `json:"fields"`
	ActiveWeapon   *weaponRecord    `json:"activeWeapon"`
}
type weaponRecord struct {
	ID             string           `json:"id"`
	ClassName      string           `json:"className"`
	FieldsComplete bool             `json:"fieldsComplete"`
	Fields         map[string]field `json:"fields"`
}
type dynamicRecord struct {
	ID        string           `json:"id"`
	ClassName string           `json:"className"`
	Origin    *vector          `json:"origin"`
	Fields    map[string]field `json:"fields"`
	revision  uint64
}
type smokeRecord struct {
	dynamicRecord
	FrameDataBase64 *string `json:"frameDataBase64"`
	DeclaredSize    *int    `json:"declaredSize"`
	Update          *int    `json:"update"`
}
type delta[T any] struct {
	Complete bool     `json:"complete"`
	Upserts  []T      `json:"upserts"`
	Removed  []string `json:"removed"`
}
type emitter struct {
	out   io.Writer
	bytes int
}

func (e *emitter) send(value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(b) > 2<<20 {
		return fmt.Errorf("evidence record exceeds 2 MiB")
	}
	if e.bytes+len(b)+1 > maxOutputBytes {
		return fmt.Errorf("evidence output exceeds 128 MiB")
	}
	b = append(b, '\n')
	n, err := e.out.Write(b)
	e.bytes += n
	if err == nil && n != len(b) {
		return io.ErrShortWrite
	}
	return err
}
func validateRequest(r *request) (map[int]bool, error) {
	if r.Version != protocolVersion || r.DemoPath == "" || len(r.Windows) == 0 || len(r.Windows) > 128 || len(r.Players) > 64 {
		return nil, fmt.Errorf("invalid evidence request")
	}
	for _, id := range r.Players {
		if len(id) != 17 {
			return nil, fmt.Errorf("invalid player identifier")
		}
		if _, err := strconv.ParseUint(id, 10, 64); err != nil {
			return nil, fmt.Errorf("invalid player identifier")
		}
	}
	ticks := map[int]bool{}
	for _, w := range r.Windows {
		if w.StartTick < 0 || w.EndTick < w.StartTick || w.EndTick > maxSafeInteger || w.EndTick-w.StartTick >= maxTicks {
			return nil, fmt.Errorf("invalid or excessive tick window")
		}
		for tick := w.StartTick; tick <= w.EndTick; tick++ {
			ticks[tick] = true
			if len(ticks) > maxTicks {
				return nil, fmt.Errorf("merged windows exceed 4096 ticks")
			}
		}
	}
	ordered := make([]int, 0, len(ticks))
	for tick := range ticks {
		ordered = append(ordered, tick)
	}
	sort.Ints(ordered)
	r.Windows = []window{}
	for _, tick := range ordered {
		if len(r.Windows) == 0 || r.Windows[len(r.Windows)-1].EndTick+1 != tick {
			r.Windows = append(r.Windows, window{tick, tick})
		} else {
			r.Windows[len(r.Windows)-1].EndTick = tick
		}
	}
	return ticks, nil
}
func number(v any) *float64 {
	var n float64
	switch x := v.(type) {
	case float32:
		n = float64(x)
	case float64:
		n = x
	case uint64:
		if x > maxSafeInteger {
			return nil
		}
		n = float64(x)
	case uint32:
		n = float64(x)
	case int32:
		n = float64(x)
	case int64:
		if x > maxSafeInteger || x < -maxSafeInteger {
			return nil
		}
		n = float64(x)
	case int:
		n = float64(x)
	default:
		return nil
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	return &n
}
func vec(v any) *vector {
	switch x := v.(type) {
	case [3]float32:
		return vec([]any{x[0], x[1], x[2]})
	case [3]float64:
		return vec([]any{x[0], x[1], x[2]})
	case []any:
		if len(x) == 3 {
			a, b, c := number(x[0]), number(x[1]), number(x[2])
			if a != nil && b != nil && c != nil {
				return &vector{*a, *b, *c}
			}
		}
	}
	return nil
}
func normalize(v any) any {
	switch x := v.(type) {
	case uint64:
		if x > maxSafeInteger {
			return strconv.FormatUint(x, 10)
		}
		return x
	case int64:
		if x > maxSafeInteger || x < -maxSafeInteger {
			return strconv.FormatInt(x, 10)
		}
		return x
	case [3]float32:
		return []any{normalize(x[0]), normalize(x[1]), normalize(x[2])}
	case [3]float64:
		return []any{normalize(x[0]), normalize(x[1]), normalize(x[2])}
	case []any:
		if len(x) > 16384 {
			return map[string]any{"length": len(x), "omitted": true}
		}
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = normalize(item)
		}
		return out
	case float32:
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return nil
		}
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return nil
		}
	}
	return v
}
