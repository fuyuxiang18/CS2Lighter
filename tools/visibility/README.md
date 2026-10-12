# Local map evidence tools

`vp run build:death-tools` builds the pinned Go extractor and stages Source 2 Viewer CLI 20.0 for Windows x64.
The release workflow installs Go 1.27.2. For a portable local SDK, set `CS2LIGHTER_GO` to its `go.exe`.
An existing official CLI archive may be supplied through `CS2LIGHTER_VRF_ARCHIVE`; the SHA-256 check still applies.

Source 2 Viewer is downloaded only while building the application, from its official GitHub release.
The running application reads installed CS2 map resources and configured local demos. It does not download maps or demos.
The archive and unpacked binaries are not committed. Original license texts are in `static/licenses/visibility`.

The map worker runs in a separate process, creates a compressed spatial cache under `demodata/visibility-maps`,
and removes its temporary GLB after completion or cancellation. Per-death reports are stored separately in
`demodata/death-evidence/<demo checksum>.json.gz`. Each demo has one compressed, integrity-checked report file,
limited to 8 MiB compressed and 64 MiB decoded. Neither path changes the base statistics cache schema or PostgreSQL data.

Map compatibility uses an explicit verified build mapping, and records the local source fingerprints.
Matching the demo's build to the installed build is not a claim that a map hash was recovered from the demo.
Unknown versions, missing resources, unknown moving geometry and unresolved smoke do not become clear gunlines.
