# Bounded CS2 death evidence helper

This read-only Go executable extracts requested demo tick windows for local evidence analysis. It does not start CS2, connect to a database, download demos, or write exports. The app supplies one JSON request on stdin and consumes NDJSON on stdout. Diagnostics go to stderr. The parent process cancels work by terminating this child.

The helper pins demoinfocs to `v4.5.2-0.20260909182438-8e1342e6585c`. Build with the Go version declared in `go.mod` or newer, without CGO:

```powershell
$env:CGO_ENABLED = '0'
go test ./...
go build -trimpath -ldflags="-s -w" -o death-evidence.exe .
```

Build artifacts belong in the app's tool staging directory, not source control. Include `THIRD_PARTY_NOTICES.txt` when distributing the executable. No demo, account, or real-match fixture belongs in this directory.

## Weapon mechanics evidence

The helper now requests explicit ground flags, movement type, armor/helmet, defusing,
duck state, controller tick base, active-weapon magazine/reload/mode, and attack timers.
Untransmitted fields still have `present: false`; network schema fields are not
assumed to be present just because they exist in the engine's in-memory schema.

`controller.m_nTickBase` is sampled through the controller that owns the exact pawn
handle/serial. Its `lastUpdate` is null: the helper does not pretend that a snapshot
read is an observed property update. The controller clock, packet server clock and
demo clock remain separate.

The pinned parser falls back to unsigned varint decoding for the signed `GameTick_t`
typedef. The helper reads the demo's flattened serializer and emits additional
`decoded.m_nNextPrimaryAttackTick`, `decoded.m_nNextSecondaryAttackTick` and
`decoded.m_nDeployTick` fields only after confirming the scalar type. It ZigZag
decodes `GameTick_t`, preserves actual signed `int32`, and leaves unknown/conflicting
types unavailable. Original properties are kept alongside these derived fields.
An actual patch-14190 probe produced raw next-attack 17846, decoded 8923, with
controller/server tick 8917; the next-attack clock therefore cannot safely be read
directly from the original property.

`FireBullets.extra`, when transmitted, contains direct movement/air inaccuracy and
sub-tick clocks. The patch-14165 and patch-14190 demos sampled here did not transmit
these optional fields. `raw.tick` was either the packet server tick or one tick
earlier. Never treat a frame-end snapshot as an exact sub-tick firing state.
Only explicitly transmitted selected cvars are included with shots; missing cvars
do not imply engine defaults.

The application carries numeric weapon facts extracted from Valve's
`scripts/weapons.vdata_c` (CRC32 `b6efe34a`, patch 14190, ClientVersion 2000930,
Steam build 25815307). The 34 weapon profiles contain separate fire-mode cadence,
standing/crouching inaccuracy, spread and recovery parameters. Unsupported demo
patches are rejected instead of reusing current-game weapon values.

The conservative mechanics provider checks measured inaccuracy and penalty
trajectories, requires a clean measured baseline, and excludes mixed stance,
scope, airborne, reload and turning states. Unknown turning inaccuracy prevents
residual-component attribution; explicit `extra.inaccuracy_move` can establish
the movement component independently. Exact zero velocity is used only as a
sufficient stationary condition, never as a counter-strafe speed threshold.
It deliberately does not widen this condition with an arbitrary epsilon.

Full player-body certification is still separate from weapon facts. The actual
`agents/models/ctm_fbi/ctm_fbi.vmdl_c` has authored view/hull bounds
`[-16,-16,0]..[16,16,72]`, while one of its mesh bounds already extends to
`[-15.166242,-22.727013,-0.014049]..[8.836346,22.636650,78.344368]`.
The model also references external world-model animation graphs. Consequently,
neither the movement hull nor these authored view bounds certify all animated
body poses; they cannot enable a target-relative spray diagnosis.

## Request and budgets

```json
{
  "version": 1,
  "demoPath": "D:/demos/example.dem",
  "windows": [{ "startTick": 12000, "endTick": 12128 }],
  "players": []
}
```

`startTick` and `endTick` are inclusive demo/game ticks. Overlapping and adjacent windows are merged. A request accepts at most 128 windows and 4096 unique ticks. `players` is optional; omitted or empty selects all pawns. Specified Steam IDs filter player rows and known shot actors. An unresolved shot actor is retained with null identity.

The helper processes the demo sequentially to preserve entity baselines, but emits full per-tick evidence only within these windows and stops immediately after their last tick. There is no whole-match trajectory export. Limits are 1 MiB input, 2 MiB per output line, and 128 MiB total output. An exceeded limit fails the job instead of truncating evidence silently.

## Stream

The authoritative app types are in `src/node/death-review/evidence-protocol.ts`.

- `header`: protocol/parser versions, map name, raw `patch`/`buildNum`, source byte count, tick rate, merged windows, requested tick count, `playerFieldsMode: "delta"`. The header waits for a valid server tick interval. It does not certify map geometry compatibility.
- `progress`: parser frame, current demo tick, requested and emitted unique ticks. Parsing before the first window can produce progress without frame payloads.
- `frame`: demo tick, parser frame, nullable raw network server tick, player rows, and world/smoke entity deltas. Entity IDs contain both entity index and serial, such as `123:45`. Repeated demo ticks are buffered until the tick advances; only the final state is emitted, including later health/position/property changes. The original repetition count remains in `end.duplicateTicks`.
- `shot`: original FireBullets protobuf fields, both clocks, original `playerHandle`, and nullable verified `playerEntityId`, `steamId`, and controller slot. Original absent protobuf fields are explicit nulls; real zero values remain zero.
- `end`: success/error, unique emitted tick count, exact missing ticks, duplicate count, output frame/shot counts, bytes emitted before the end record, capabilities, and encountered supported/unsupported entity creation counts. Counts are not current active entity counts. Early input/file errors can return an error end before a header.

### Player state

Every frame includes origin, eyes, yaw/pitch, velocity, team, health, life state, and collision hull. Missing values are null. Origin requires all six actual body-component cell/offset fields, so a missing position is not converted to `[0, 0, 0]`. Eyes use origin plus the full `m_vecViewOffset.m_vecX/Y/Z` fields; the similarly named velocity fields are never substituted.

`fields` preserves full network paths, value presence, and last observed property update clocks. The callback's initial baseline notification is excluded from `lastUpdate`, leaving it null until an actual subsequent update is seen. A schema path with no decoded value has `present: false`. `lastUpdate` describes a received property update, not a mouse-input timestamp or guaranteed shot-time interpolation state.

`fieldsComplete: true` resets the raw-field dictionary for that entity. It occurs on the first row, a new entity serial, and the start of a noncontiguous output window. Consecutive rows with `fieldsComplete: false` include only changed `WireField` objects. Presence loss is sent explicitly. The app must merge these deltas before analysis; a field omitted from a delta is unchanged, not missing.

Flash duration/max alpha and the active weapon handle are recorded using their actual pawn paths. `m_flFlashBangTime` is included as an explicit missing field when it is not networked. `activeWeapon` is null when its full handle cannot be verified against both the entity index and serial. Otherwise it contains weapon ID, class, and its own `fieldsComplete`/`fields` dictionary for ammo, reload, deploy, attack timing, item definition and recoil/accuracy state. Reset this dictionary when the weapon ID changes or `fieldsComplete` is true; field deltas are independent of the pawn dictionary. Weapons also supply compact geometry and owner fields in `world` so the consumer can explicitly choose how held or dropped models affect its query.

Raw camera FOV values can be engine sentinels; e.g. zero does not establish a zero-degree view. Collision bounds are not animated hitboxes. Aim-punch base ticks use their original network clock. The helper preserves these facts and does not silently invent projection, bones, recoil interpolation, or input history.

### Dynamic world and smoke

Doors, breakables, dynamic props, physics classes, and other entities whose available schema exposes a model or collision are enumerated. World fields retain body-component transforms, models and animation state, collision, rendering, parent/owner, door, breakable, physics and health/life state. Unrelated account, camera/audio and game-statistic fields are excluded. The `environment-model-candidates` capability identifies this expanded candidate enumeration.

The first `world` and `smokes` messages have `complete: true`; subsequent messages contain changed entities and removals. Consumers must maintain entity state across messages and window gaps. Here `complete` means a complete enumeration of supported network entity types, not complete collision/render geometry. Unsupported classes are reported at the end. World upserts compare actual values and presence: a retransmission of the same value does not emit another object or advance its emitted field clock. Player and active-weapon field clocks retain every observed update independently.

Smoke carries complete available network `m_VoxelFrameData` bytes as base64, declared size, update number, and other raw fields. The byte array and its individual indexes are not duplicated in `fields`. These bytes are preserved without claiming that their compressed format is a decoded density grid. An undetonated smoke can have a present all-zero buffer and size zero.

Integers outside JavaScript's exact integer range, including model resource handles, are decimal strings. Consumers must not convert them to floating-point numbers for resource matching.

### Shot identity and clocks

FireBullets `player` is a full pawn entity handle, not a player slot. Identity is assigned only when that handle exactly equals a participant controller's current `m_hPlayerPawn`, followed by the matching current pawn entity. Unknown identities remain null. All shots are filtered by the callback's demo tick; the original protobuf tick remains in `raw`.

Demo tick, parser frame, network server tick, and embedded shot tick are separate clocks. Do not subtract them without validating their relationship. A frame is the state observed at frame end; the helper does not claim it is an exact subtick shot snapshot.

## Validation

Tests cover merged-window limits, missing-versus-zero evidence, full-path eye/velocity separation, exact large integer preservation, optional protobuf nulls, entity serial changes, delta resets across gaps, property disappearance, output limits, short writes, and early error results. Real demo checks are performed separately with bounded windows; only anonymous aggregate reports are retained outside the repository.
