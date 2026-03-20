# Validation

This fork includes protocol-level validation scripts under `tools/`.

They exist for two reasons:

- the visual DevTools frontend can fail independently of the bridge
- CDP-level proof is stronger than UI-only proof

## Scripts

### `tools/cdp_probe.js`

Basic bridge validation:

- Runtime / Debugger / Network / Page enable
- script discovery
- script source fetch
- DOM write/read
- console event capture
- injected fetch request capture

Run:

```bash
yarn probe:basic
```

### `tools/cdp_advanced_probe.js`

More aggressive validation:

- reload and breakpoint setup
- DOM overlay injection
- API request replay attempt
- Fetch interception
- response observation

Run:

```bash
yarn probe:advanced
```

### `tools/cdp_live_validation.js`

Live validation script for research and manual runtime work:

- source keyword discovery
- hook installation
- runtime fetch tracking
- paused event collection
- real request pattern checks

Run:

```bash
yarn probe:live
```

## What a good run looks like

For a healthy bridge, expect most of the following:

- `Runtime.enable` is `ok`
- `Debugger.enable` is `ok`
- `Network.enable` is `ok`
- script URLs include `WAServiceMainContext.js` or `WAPCAdapterAppIndex.js`
- requests appear for `servicewechat.com` and real business APIs
- injected console markers are observed
- DOM writes can be read back

## Important limitation

If the current target is only `page-frame.html / AppIndex / WebView`, you may
see:

- `typeof wx === "undefined"`
- no `AppService` globals
- no access to plugin-only APIs such as `wx.pluginLogin`

That is a target-context limitation, not automatically a bridge failure.
