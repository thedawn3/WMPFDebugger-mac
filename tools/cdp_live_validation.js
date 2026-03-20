const WebSocket = require("ws");

const WS_URL = "ws://127.0.0.1:62000";
const INIT_WAIT_MS = 3000;
const STEP_TIMEOUT_MS = 15000;
const BREAKPOINT_MARKER = "__codex_breakpoint_probe__";
const HOOK_SCRIPT_URL = "codex-live-hook.js";
const HOOK_CONSOLE_MARKER = "__CODEX_LIVE_HOOK__";
const REAL_REQUEST_PATTERNS = [
  "performance/app/project/serverTime",
  "marketing/app/teamTicketQueue/getCaptainQueue",
  "member/member/app/info",
];
const SOURCE_KEYWORDS = [
  "api.livelab.com.cn",
  "getCaptainQueue",
  "serverTime",
  "wx.request",
];
const CANDIDATE_SCRIPT_PATTERNS = [
  "WAServiceMainContext.js",
  "usr/appservice.app.js",
  "usr/common.app.js",
  "page-frame.html",
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label, onTimeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        if (onTimeout) onTimeout();
        reject(new Error(`timeout waiting for ${label}`));
      }, timeoutMs)
    ),
  ]);
}

function snippetAround(text, index, radius = 120) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end);
}

function valueFromRemote(result) {
  return result && result.result && Object.prototype.hasOwnProperty.call(result.result, "value")
    ? result.result.value
    : result;
}

async function main() {
  const ws = new WebSocket(WS_URL);
  const pending = new Map();
  const events = [];
  const scripts = [];
  const consoleEvents = [];
  const pausedEvents = [];
  const fetchPausedEvents = [];
  const requestEvents = [];
  const responseEvents = [];
  const loadingFinishedEvents = [];
  let nextId = 1;

  function send(method, params = {}, timeoutMs = STEP_TIMEOUT_MS) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(
      new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      }),
      timeoutMs,
      method,
      () => pending.delete(id)
    );
  }

  function takeResult(response) {
    if (!response) return { ok: false, error: "no response" };
    if (response.error) return { ok: false, error: response.error };
    return { ok: true, result: response.result };
  }

  async function waitFor(list, predicate, timeoutMs, label, startIndex = 0) {
    const started = Date.now();
    let index = startIndex;
    while (Date.now() - started < timeoutMs) {
      while (index < list.length) {
        const item = list[index++];
        if (predicate(item)) {
          return item;
        }
      }
      await delay(50);
    }
    throw new Error(`timeout waiting for ${label}`);
  }

  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (typeof msg.id === "number") {
      const handler = pending.get(msg.id);
      if (handler) {
        pending.delete(msg.id);
        handler.resolve(msg);
      }
      return;
    }

    events.push(msg);

    if (msg.method === "Debugger.scriptParsed") {
      scripts.push({
        scriptId: msg.params.scriptId,
        url: msg.params.url || "",
        startLine: msg.params.startLine || 0,
        startColumn: msg.params.startColumn || 0,
      });
      return;
    }

    if (msg.method === "Runtime.consoleAPICalled") {
      consoleEvents.push(msg);
      return;
    }

    if (msg.method === "Debugger.paused") {
      pausedEvents.push(msg);
      return;
    }

    if (msg.method === "Fetch.requestPaused") {
      fetchPausedEvents.push(msg);
      return;
    }

    if (msg.method === "Network.requestWillBeSent") {
      requestEvents.push(msg);
      return;
    }

    if (msg.method === "Network.responseReceived") {
      responseEvents.push(msg);
      return;
    }

    if (msg.method === "Network.loadingFinished") {
      loadingFinishedEvents.push(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const handshake = {
    runtimeEnable: takeResult(await send("Runtime.enable")),
    debuggerEnable: takeResult(await send("Debugger.enable")),
    skipAllPauses: takeResult(await send("Debugger.setSkipAllPauses", { skip: false })),
    networkEnable: takeResult(await send("Network.enable")),
    pageEnable: takeResult(await send("Page.enable")),
    logEnable: takeResult(await send("Log.enable")),
    consoleEnable: takeResult(await send("Console.enable")),
    fetchEnable: takeResult(
      await send("Fetch.enable", {
        patterns: [
          { urlPattern: `*${BREAKPOINT_MARKER}*`, requestStage: "Request" },
          ...REAL_REQUEST_PATTERNS.map((pattern) => ({
            urlPattern: `*${pattern}*`,
            requestStage: "Request",
          })),
        ],
      })
    ),
  };

  await delay(INIT_WAIT_MS);

  const runtimeSummary = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => ({
          href: location.href,
          title: document.title,
          ua: navigator.userAgent
        }))()
      `,
      returnByValue: true,
    })
  );

  const candidateScripts = scripts.filter((item) =>
    CANDIDATE_SCRIPT_PATTERNS.some((pattern) => item.url.includes(pattern))
  );

  const sourceHits = [];
  for (const keyword of SOURCE_KEYWORDS) {
    let hit = null;
    for (const script of candidateScripts) {
      const sourceResp = takeResult(
        await send("Debugger.getScriptSource", { scriptId: script.scriptId })
      );
      if (!sourceResp.ok) {
        continue;
      }
      const source = sourceResp.result.scriptSource || "";
      const idx = source.indexOf(keyword);
      if (idx !== -1) {
        hit = {
          keyword,
          url: script.url,
          scriptId: script.scriptId,
          index: idx,
          snippet: snippetAround(source, idx),
        };
        break;
      }
    }
    sourceHits.push(hit || { keyword, found: false });
  }

  const hookSource = [
    "(() => {",
    "  if (globalThis.__codexLiveHookInstalled) return { ok: true, reused: true };",
    "  const originalFetch = globalThis.fetch;",
    "  globalThis.__codexLiveHookInstalled = true;",
    "  globalThis.__codexFetchCalls = [];",
    "  globalThis.fetch = async function (...args) {",
    "    const req = args[0];",
    "    const url = typeof req === 'string' ? req : ((req && req.url) || '');",
    `    const isProbe = url.includes('${BREAKPOINT_MARKER}');`,
    "    globalThis.__codexFetchCalls.push({ ts: Date.now(), url, isProbe });",
    `    console.log('${HOOK_CONSOLE_MARKER}', url);`,
    "    if (isProbe) {",
    "      debugger;",
    "    }",
    "    return originalFetch.apply(this, args);",
    "  };",
    "  return { ok: true, hasFetch: typeof originalFetch === 'function' };",
    "})()",
    `//# sourceURL=${HOOK_SCRIPT_URL}`,
  ].join("\n");

  const hookInstall = takeResult(
    await send("Runtime.evaluate", {
      expression: hookSource,
      returnByValue: true,
    })
  );

  const hookScript = await waitFor(
    scripts,
    (item) => item.url === HOOK_SCRIPT_URL,
    STEP_TIMEOUT_MS,
    "hook script parsed"
  );

  const breakpointSet = takeResult(
    await send("Debugger.setBreakpointByUrl", {
      urlRegex: "codex-live-hook\\.js$",
      lineNumber: 10,
      columnNumber: 0,
    })
  );

  const probeUrl =
    "https://servicewechat.com/__dev__/WAPCAdapterAppIndex.js?" +
    `${BREAKPOINT_MARKER}=${Date.now()}`;

  const pausedStart = pausedEvents.length;
  const fetchPausedStart = fetchPausedEvents.length;
  const requestStart = requestEvents.length;
  const responseStart = responseEvents.length;
  const loadingStart = loadingFinishedEvents.length;

  const probeFetchPromise = send("Runtime.evaluate", {
    expression: `
      (async () => {
        const url = ${JSON.stringify(probeUrl)};
        const resp = await fetch(url, { cache: 'no-store' });
        const text = await resp.text();
        return { ok: true, url, status: resp.status, length: text.length };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  }, 60000);

  let breakpointPause = null;
  try {
    const pausedEvent = await waitFor(
      pausedEvents,
      (item) => {
        const top = item.params && item.params.callFrames && item.params.callFrames[0];
        return top && top.url === HOOK_SCRIPT_URL;
      },
      4000,
      "breakpoint pause",
      pausedStart
    );

    const topFrame = pausedEvent.params.callFrames[0];
    const pausedEval = takeResult(
      await send("Debugger.evaluateOnCallFrame", {
        callFrameId: topFrame.callFrameId,
        expression: "({ url, isProbe, callCount: globalThis.__codexFetchCalls.length })",
        returnByValue: true,
      })
    );

    const resumeResult = takeResult(await send("Debugger.resume"));
    breakpointPause = {
      ok: true,
      reason: pausedEvent.params.reason,
      functionName: topFrame.functionName,
      url: topFrame.url,
      location: topFrame.location,
      call_frame_eval: pausedEval,
      resume: resumeResult,
    };
  } catch (error) {
    const hookState = takeResult(
      await send("Runtime.evaluate", {
        expression:
          "({ callCount: (globalThis.__codexFetchCalls || []).length, lastCall: (globalThis.__codexFetchCalls || []).slice(-1)[0] || null })",
        returnByValue: true,
      })
    );
    breakpointPause = {
      ok: false,
      error: String(error),
      hook_state: hookState,
    };
  }

  let probeFetchIntercept = null;
  try {
    const probeFetchPaused = await waitFor(
      fetchPausedEvents,
      (item) => item.params && item.params.request && item.params.request.url === probeUrl,
      4000,
      "probe request interception",
      fetchPausedStart
    );
    const probeContinue = takeResult(
      await send("Fetch.continueRequest", { requestId: probeFetchPaused.params.requestId })
    );
    probeFetchIntercept = {
      ok: true,
      requestId: probeFetchPaused.params.requestId,
      continue: probeContinue,
    };
  } catch (error) {
    probeFetchIntercept = {
      ok: false,
      error: String(error),
    };
  }

  const probeRequestEvent = await waitFor(
    requestEvents,
    (item) => item.params && item.params.request && item.params.request.url === probeUrl,
    STEP_TIMEOUT_MS,
    "probe requestWillBeSent",
    requestStart
  );

  const probeResponseEvent = await waitFor(
    responseEvents,
    (item) => item.params && item.params.requestId === probeRequestEvent.params.requestId,
    STEP_TIMEOUT_MS,
    "probe responseReceived",
    responseStart
  );

  await waitFor(
    loadingFinishedEvents,
    (item) => item.params && item.params.requestId === probeRequestEvent.params.requestId,
    STEP_TIMEOUT_MS,
    "probe loadingFinished",
    loadingStart
  );

  const probeBody = takeResult(
    await send("Network.getResponseBody", { requestId: probeRequestEvent.params.requestId })
  );
  const probeFetchResult = takeResult(await probeFetchPromise);

  const reloadResult = takeResult(await send("Page.reload", { ignoreCache: true }));

  const realFetchPausedStart = fetchPausedEvents.length;
  const realRequestStart = requestEvents.length;
  const realResponseStart = responseEvents.length;
  const realLoadingStart = loadingFinishedEvents.length;
  let realIntercept = null;
  try {
    const realRequestEvent = await waitFor(
      requestEvents,
      (item) =>
        item.params &&
        item.params.request &&
        REAL_REQUEST_PATTERNS.some((pattern) =>
          item.params.request.url && item.params.request.url.includes(pattern)
        ),
      STEP_TIMEOUT_MS,
      "real requestWillBeSent",
      realRequestStart
    );
    const realUrl = realRequestEvent.params.request.url;

    let realFetchIntercept = null;
    try {
      const realFetchPaused = await waitFor(
        fetchPausedEvents,
        (item) => item.params && item.params.request && item.params.request.url === realUrl,
        4000,
        "real app request interception",
        realFetchPausedStart
      );
      const realContinue = takeResult(
        await send("Fetch.continueRequest", { requestId: realFetchPaused.params.requestId })
      );
      realFetchIntercept = {
        ok: true,
        requestId: realFetchPaused.params.requestId,
        continue: realContinue,
      };
    } catch (error) {
      realFetchIntercept = {
        ok: false,
        error: String(error),
      };
    }

    const realResponseEvent = await waitFor(
      responseEvents,
      (item) => item.params && item.params.requestId === realRequestEvent.params.requestId,
      STEP_TIMEOUT_MS,
      "real responseReceived",
      realResponseStart
    );

    await waitFor(
      loadingFinishedEvents,
      (item) => item.params && item.params.requestId === realRequestEvent.params.requestId,
      STEP_TIMEOUT_MS,
      "real loadingFinished",
      realLoadingStart
    );

    const realBody = takeResult(
      await send("Network.getResponseBody", { requestId: realRequestEvent.params.requestId })
    );

    let replay = null;
    if ((realFetchPaused.params.request.method || "GET") === "GET") {
      const replayFetchPausedStart = fetchPausedEvents.length;
      const replayPromise = send("Runtime.evaluate", {
        expression: `
          (async () => {
            const url = ${JSON.stringify(realUrl)};
            const resp = await fetch(url, { cache: 'no-store', credentials: 'include' });
            const text = await resp.text();
            return { ok: true, url, status: resp.status, length: text.length };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      }, 60000);

      const replayFetchPaused = await waitFor(
        fetchPausedEvents,
        (item) => item.params && item.params.request && item.params.request.url === realUrl,
        4000,
        "real request replay interception",
        replayFetchPausedStart
      );

      const replayContinue = takeResult(
        await send("Fetch.continueRequest", { requestId: replayFetchPaused.params.requestId })
      );
      const replayResult = takeResult(await replayPromise);
      replay = {
        fetchIntercept: {
          ok: true,
          requestId: replayFetchPaused.params.requestId,
        },
        continue: replayContinue,
        result: replayResult,
      };
    }

    realIntercept = {
      url: realUrl,
      method: realRequestEvent.params.request.method,
      headers: realRequestEvent.params.request.headers,
      fetch_intercept: realFetchIntercept,
      responseStatus: realResponseEvent.params.response.status,
      responseMimeType: realResponseEvent.params.response.mimeType,
      body: realBody.ok
        ? {
            base64Encoded: !!realBody.result.base64Encoded,
            length: (realBody.result.body || "").length,
            snippet: snippetAround(realBody.result.body || "", 0, 160),
          }
        : realBody,
      replay,
    };
  } catch (error) {
    realIntercept = {
      ok: false,
      error: String(error),
    };
  }

  const hookConsoleHits = consoleEvents
    .map((item) => ({
      type: item.params.type,
      args: (item.params.args || []).map((arg) =>
        Object.prototype.hasOwnProperty.call(arg, "value") ? arg.value : arg.description
      ),
    }))
    .filter((item) => item.args.some((value) => String(value).includes(HOOK_CONSOLE_MARKER)));

  const output = {
    ws_url: WS_URL,
    handshake,
    runtime_summary: runtimeSummary,
    candidate_script_count: candidateScripts.length,
    source_hits: sourceHits,
    hook_install: hookInstall,
    hook_script: hookScript,
    breakpoint_set: breakpointSet,
    breakpoint_pause: breakpointPause,
    probe_request: {
      url: probeUrl,
      fetch_intercept: probeFetchIntercept,
      network_request_id: probeRequestEvent.params.requestId,
      response_status: probeResponseEvent.params.response.status,
      response_body: probeBody.ok
        ? {
            base64Encoded: !!probeBody.result.base64Encoded,
            length: (probeBody.result.body || "").length,
          }
        : probeBody,
      runtime_fetch_result: probeFetchResult,
    },
    real_request_intercept: realIntercept,
    hook_console_hits: hookConsoleHits,
    reload_result: reloadResult,
    event_counts: {
      scripts: scripts.length,
      console: consoleEvents.length,
      paused: pausedEvents.length,
      fetchPaused: fetchPausedEvents.length,
      requests: requestEvents.length,
      responses: responseEvents.length,
      loadingFinished: loadingFinishedEvents.length,
      raw: events.length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exit(1);
});
