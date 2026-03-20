# Stable Mode

## Purpose

Stable mode is the default operating mode in this fork. It exists because the
most expensive failure on macOS is repeated `WeApp` crashes, not initial
connection failure.

## Default behavior

When you run:

```bash
yarn start:stable
```

the runtime behavior is:

- attach only the primary `WeChatAppEx` process
- enable scene rewrite
- enable the CDP filter patch
- disable the resource cache patch

## Recommended long-term workflow

Use this sequence for daily use:

1. Fully quit WeChat and this tool.
2. Start WeChat normally.
3. Open the target mini program once without hooking so caches and runtime state
   are created.
4. Close that page or return to WeChat.
5. Run:

```bash
yarn start:stable
```

6. Reopen the target mini program and enter the real business page.
7. Open Chrome DevTools:

```text
devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
```

## Runtime flags

`src/index.js` supports:

- `--attach-all`
- `--patch-resource-cache`
- `--no-cdp-filter`
- `--no-scene-rewrite`
- `--verbose-hook`
- `--unsafe`

Matching environment variables:

- `WMPF_SAFE_MODE`
- `WMPF_ATTACH_ALL`
- `WMPF_PATCH_RESOURCE_CACHE`
- `WMPF_PATCH_CDP_FILTER`
- `WMPF_REWRITE_SCENE`
- `WMPF_VERBOSE_HOOK`

## Full mode

Use full mode only for debugging instability or offset research:

```bash
yarn start:full
```

This enables the more aggressive path:

- attach all matching `WeChatAppEx` processes
- enable the resource cache patch

Do not treat full mode as the default long-term workflow.

## If mini programs still crash

Reduce variables first:

1. Close extra `devtools://` tabs.
2. Keep only one active CDP client.
3. Go back to `yarn start:stable`.
4. Reproduce with a mini program that already has cache/runtime state.
5. Only then try `yarn start:full` for comparison.
