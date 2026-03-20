# Stable Mode

## Purpose

Stable mode is the default operating mode in this fork. It exists because the
most expensive failure on macOS is repeated `WeApp` crashes, not initial
connection failure.

The current crash signature observed on March 20, 2026 is repeated
`WeApp -> CrRendererMain -> EXC_BAD_ACCESS / SIGSEGV` in the renderer path, so
stable mode now starts from the lowest native patch surface first.

## Default behavior

When you run:

```bash
yarn start:stable
```

the runtime behavior is:

- attach only the primary `WeChatAppEx` process
- disable loadstart flag patch
- disable scene rewrite
- disable the CDP filter patch
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

If stable mode stays alive but does not expose enough debugging capability,
escalate one step at a time instead of jumping directly to full mode:

1. `WMPF_PATCH_CDP_FILTER=1 yarn start:stable`
2. `WMPF_PATCH_CDP_FILTER=1 WMPF_REWRITE_SCENE=1 yarn start:stable`
3. `WMPF_FORCE_LOADSTART_FLAG=1 WMPF_PATCH_CDP_FILTER=1 WMPF_REWRITE_SCENE=1 yarn start:stable`
4. `yarn start:compat`
5. `yarn start:full`

## Runtime flags

`src/index.js` supports:

- `--attach-all`
- `--force-loadstart-flag`
- `--no-force-loadstart-flag`
- `--patch-resource-cache`
- `--no-cdp-filter`
- `--no-scene-rewrite`
- `--verbose-hook`
- `--unsafe`

Matching environment variables:

- `WMPF_SAFE_MODE`
- `WMPF_ATTACH_ALL`
- `WMPF_FORCE_LOADSTART_FLAG`
- `WMPF_PATCH_RESOURCE_CACHE`
- `WMPF_PATCH_CDP_FILTER`
- `WMPF_REWRITE_SCENE`
- `WMPF_VERBOSE_HOOK`

## Compat mode

Use compat mode when stable mode does not crash but still cannot expose the
expected debug entry:

```bash
yarn start:compat
```

Compat mode keeps `attachAll` off and `patchResourceCache` off, but restores
the older native rewrites:

- enable loadstart flag patch
- enable scene rewrite
- enable CDP filter patch

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
5. Only then step through the escalation order above.
6. Use `yarn probe:basic` before trying `probe:advanced` or `probe:live`.
