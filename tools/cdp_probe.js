const WebSocket = require("ws");

const WS_URL = "ws://127.0.0.1:62000";
const EVENT_WAIT_MS = 5000;
const NETWORK_WAIT_MS = 8000;
const SCRIPT_SOURCE_SNIPPET = 400;
const CONSOLE_MARKER = "__CODEX_CONSOLE_PROBE__";
const DOM_MARKER = "__CODEX_DOM_PROBE__";
const FETCH_MARKER = "__codex_fetch_probe__";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const ws = new WebSocket(WS_URL);
  const pending = new Map();
  const events = [];
  const scripts = [];
  const requests = [];
  const consoleEvents = [];
  const logEvents = [];
  let id = 1;

  function send(method, params = {}) {
    const msgId = id++;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
    });
  }

  function takeResult(response) {
    if (!response) return { ok: false, error: "no response" };
    if (response.error) return { ok: false, error: response.error };
    return { ok: true, result: response.result };
  }

  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (typeof msg.id === "number") {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
      return;
    }

    events.push(msg);
    if (msg.method === "Debugger.scriptParsed") {
      scripts.push({
        scriptId: msg.params.scriptId,
        url: msg.params.url || "",
        hash: msg.params.hash || "",
        length: msg.params.length || 0,
      });
    }
    if (msg.method === "Network.requestWillBeSent") {
      requests.push({
        requestId: msg.params.requestId,
        url: msg.params.request && msg.params.request.url,
        method: msg.params.request && msg.params.request.method,
        type: msg.params.type || "",
      });
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleEvents.push({
        type: msg.params.type,
        args:
          (msg.params.args || []).map((arg) =>
            Object.prototype.hasOwnProperty.call(arg, "value") ? arg.value : arg.description
          ) || [],
      });
    }
    if (msg.method === "Log.entryAdded") {
      logEvents.push({
        level: msg.params.entry && msg.params.entry.level,
        source: msg.params.entry && msg.params.entry.source,
        text: msg.params.entry && msg.params.entry.text,
      });
    }
  });

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const handshake = {};
  handshake.runtimeEnable = takeResult(await send("Runtime.enable"));
  handshake.debuggerEnable = takeResult(await send("Debugger.enable"));
  handshake.networkEnable = takeResult(await send("Network.enable"));
  handshake.pageEnable = takeResult(await send("Page.enable"));
  handshake.logEnable = takeResult(await send("Log.enable"));
  handshake.consoleEnable = takeResult(await send("Console.enable"));

  await delay(EVENT_WAIT_MS);

  const runtimeSummary = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => ({
          href: typeof location !== 'undefined' ? location.href : null,
          title: typeof document !== 'undefined' ? document.title : null,
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          hasWx: typeof wx !== 'undefined',
          hasFetch: typeof fetch !== 'undefined',
          hasXHR: typeof XMLHttpRequest !== 'undefined'
        }))()
      `,
      returnByValue: true,
    })
  );

  const injectWrite = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          globalThis.__codex_probe = {
            ts: Date.now(),
            marker: 'ok',
            rand: Math.random().toString(16).slice(2)
          };
          return globalThis.__codex_probe;
        })()
      `,
      returnByValue: true,
    })
  );

  const injectRead = takeResult(
    await send("Runtime.evaluate", {
      expression: "globalThis.__codex_probe",
      returnByValue: true,
    })
  );

  const domInject = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const value = 'dom-' + Date.now();
          if (typeof document !== 'undefined' && document.body) {
            document.body.setAttribute('${DOM_MARKER}', value);
          }
          return {
            value,
            bodyTag: typeof document !== 'undefined' && document.body ? document.body.tagName : null
          };
        })()
      `,
      returnByValue: true,
    })
  );

  const domRead = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => ({
          value:
            typeof document !== 'undefined' && document.body
              ? document.body.getAttribute('${DOM_MARKER}')
              : null
        }))()
      `,
      returnByValue: true,
    })
  );

  const consoleInject = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const payload = '${CONSOLE_MARKER}:' + Date.now();
          console.log(payload);
          return { payload };
        })()
      `,
      returnByValue: true,
    })
  );

  const fetchInject = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          if (typeof fetch !== 'function') {
            return { ok: false, reason: 'fetch_missing' };
          }
          const url =
            'https://servicewechat.com/__dev__/WAPCAdapterAppIndex.js?${FETCH_MARKER}=' + Date.now();
          fetch(url, { cache: 'no-store' })
            .then((resp) => resp.text().then((text) => ({ status: resp.status, length: text.length })))
            .then((info) => console.log('${CONSOLE_MARKER}:fetch_done', JSON.stringify(info)))
            .catch((err) => console.log('${CONSOLE_MARKER}:fetch_error', String(err)));
          return { ok: true, url };
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    })
  );

  await delay(3000);

  const reloadResult = takeResult(await send("Page.reload", { ignoreCache: true }));
  await delay(NETWORK_WAIT_MS);

  let scriptSource = { ok: false, error: "no candidate script" };
  const preferredScript =
    scripts.find((item) => item.url && item.url.includes("WAServiceMainContext.js")) ||
    scripts.find((item) => item.url && item.url.includes("WAPCAdapterAppIndex.js")) ||
    scripts.find((item) => item.url && item.url.includes(".app.js")) ||
    scripts.find((item) => item.url);
  if (preferredScript) {
    const sourceResp = takeResult(
      await send("Debugger.getScriptSource", { scriptId: preferredScript.scriptId })
    );
    if (sourceResp.ok) {
      scriptSource = {
        ok: true,
        scriptId: preferredScript.scriptId,
        url: preferredScript.url,
        length: (sourceResp.result.scriptSource || "").length,
        snippet: (sourceResp.result.scriptSource || "").slice(0, SCRIPT_SOURCE_SNIPPET),
      };
    } else {
      scriptSource = {
        ok: false,
        url: preferredScript.url,
        error: sourceResp.error,
      };
    }
  }

  const scriptUrls = scripts
    .map((item) => item.url)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 30);

  const requestUrls = requests
    .map((item) => item.url)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 30);

  const matchedInjectedRequests = requests.filter(
    (item) => item.url && item.url.includes(FETCH_MARKER)
  );
  const matchedConsoleEvents = consoleEvents.filter((item) =>
    (item.args || []).some((value) => String(value).includes(CONSOLE_MARKER))
  );
  const matchedLogs = logEvents.filter((item) =>
    String(item.text || "").includes(CONSOLE_MARKER)
  );

  const output = {
    ws_url: WS_URL,
    handshake,
    script_event_count: scripts.length,
    sample_script_urls: scriptUrls,
    script_source_probe: scriptSource,
    network_event_count: requests.length,
    sample_request_urls: requestUrls,
    runtime_summary: runtimeSummary,
    inject_write: injectWrite,
    inject_read: injectRead,
    dom_inject: domInject,
    dom_read: domRead,
    console_inject: consoleInject,
    console_event_count: consoleEvents.length,
    console_marker_events: matchedConsoleEvents,
    log_event_count: logEvents.length,
    log_marker_events: matchedLogs,
    fetch_inject: fetchInject,
    injected_request_matches: matchedInjectedRequests,
    reload_result: reloadResult,
    raw_event_count: events.length,
  };

  console.log(JSON.stringify(output, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exit(1);
});
