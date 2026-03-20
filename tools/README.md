# Tools

This directory contains reusable protocol-level validation helpers.

## Files

- `cdp_probe.js`
  - basic connectivity and CDP sanity check
  - verifies Runtime / Debugger / Network / Page enable
  - verifies script discovery, DOM write/read, console events, injected fetch

- `cdp_advanced_probe.js`
  - stronger validation for breakpoint and request-flow behavior
  - attempts reload, breakpoint setup, Fetch interception, and response capture

- `cdp_live_validation.js`
  - live research helper for manual runtime work
  - useful when a real mini program business page is already open

## Commands

Run from repo root:

```bash
yarn probe:basic
yarn probe:advanced
yarn probe:live
```

## Current local reference target

These tools were validated against:

- WeChat `4.1.7 (34371)`

The exact mini program appid used during local validation is intentionally not
recorded in the repository.

The tools are reusable across other mini programs, but output shape will vary
depending on whether the active CDP target is only WebView or reaches deeper
runtime state.
