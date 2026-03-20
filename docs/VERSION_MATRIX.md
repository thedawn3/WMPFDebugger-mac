# Version Matrix

This file records the exact local versions used for the current fork baseline.

## Local WeChat environment

- WeChat app version: `4.1.7`
- WeChat bundle version (`CFBundleVersion`): `34371`
- `WeChatAppEx` runtime `client_version`: `4066645761`
- `client_version` hex: `0xf2641701`
- XWEB / WMPF offset target used by this fork: `18788`

## Mapping used in code

Because some macOS WeChat builds expose only the plain bundle version, this fork
uses:

- `34371 -> 18788`

That mapping is implemented in `src/index.js`.

## Current verified mini program target

The currently verified local CDP bridge tests were run against a real mini
program business page on this machine. The repository intentionally does not
record that mini program's appid.

## Verification notes

That real target was sufficient to verify:

- Chrome DevTools frontend attachment
- script discovery and script source fetch
- network event capture
- DOM / console injection
- injected fetch observation

It did **not** guarantee AppService-level APIs were exposed in the current CDP
target. In the observed target, `typeof wx === "undefined"` was still possible
because the active target was often `page-frame.html / AppIndex / WebView`.
