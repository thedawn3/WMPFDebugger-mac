# Fork Notes

This fork is a maintenance-oriented baseline with two distinct upstream layers:

- canonical original project: `evi0s/WMPFDebugger`
- direct macOS code baseline: `linguo2625469/WMPFDebugger-mac`

Historical mac adaptation lineage also includes:

- `chain00x/WMPFDebugger-arm`

The goal is not to maximize patch coverage. The goal is to keep the macOS WeChat
mini program debug bridge usable over time, with conservative defaults first.

## Main changes

### 1. Version alias for macOS WeChat `4.1.7 (34371)`

Some macOS builds expose `CFBundleVersion` as a plain `34371` instead of the
older dotted form. This fork maps:

- `34371 -> 18788`

That allows the existing `addresses.18788.json` offsets to be reused directly.

### 1.1 Local verified target matrix was recorded

The fork now explicitly records the local versions it was validated against:

- WeChat app `4.1.7`
- bundle version `34371`
- `WeChatAppEx` runtime `client_version` `4066645761` (`0xf2641701`)

This is documented in `docs/VERSION_MATRIX.md` so later maintainers know which
results came from a real local run and which parts remain generalized.

### 2. Stable mode is the default

The upstream behavior is effective but aggressive. This fork defaults to a
stable mode intended to reduce `WeApp` renderer crashes:

- attach only the primary `WeChatAppEx` process by default
- disable loadstart flag patch by default
- disable scene rewrite by default
- disable CDP filter patch by default
- disable resource cache patch by default

The more aggressive native rewrites are still available through `start:compat`,
`start:full`, or explicit runtime flags when needed.

### 3. Runtime switches were added

`src/index.js` now supports runtime flags and matching environment variables so
the same build can be used for:

- conservative daily use
- offset research
- compatibility debugging

### 4. Validation tools were added

Protocol-level CDP probes were added under `tools/` so you can verify the bridge
without depending entirely on the visual DevTools frontend.

## Remote and maintenance model

For day-to-day git maintenance, the practical code upstream is still the macOS
baseline repo, because that is the repository this code was directly organized
from.

For documentation and attribution, the canonical origin remains:

- `evi0s/WMPFDebugger`

## Files added or changed in this fork

- `src/index.js`
- `frida/hook.js`
- `package.json`
- `README.md`
- `tools/cdp_probe.js`
- `tools/cdp_advanced_probe.js`
- `tools/cdp_live_validation.js`
- `docs/STABLE_MODE.md`
- `docs/VALIDATION.md`

## Why the stable defaults matter

On macOS, the failure mode is often not "DevTools cannot connect". The common
failure mode is:

- `WeApp` launches
- the private debug bridge connects
- then the renderer crashes

That makes "connectivity worked once" a weak success criterion. This fork
optimizes for keeping `WeApp` alive first, then enabling deeper patches only
when they are actually required.
