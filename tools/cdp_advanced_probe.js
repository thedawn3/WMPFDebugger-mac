const WebSocket = require("ws");

const WS_URL = "ws://127.0.0.1:62000";
const STARTUP_WAIT_MS = 5000;
const PAUSE_WAIT_MS = 12000;
const FETCH_WAIT_MS = 10000;
const RESPONSE_WAIT_MS = 8000;
const DOM_MARKER_ID = "__codex_dom_overlay__";
const DOM_MARKER_TEXT = "codex-dom-ok";
const CONSOLE_MARKER = "__CODEX_ADVANCED_PROBE__";
const FALLBACK_BREAKPOINT_URLS = [
  "https://lib/WAServiceMainContext.js",
  "https://servicewechat.com/__dev__/WAPCAdapterAppIndex.js",
];
const FALLBACK_API_URLS = [
  "https://api.livelab.com.cn/member/member/app/info",
  "https://api.livelab.com.cn/performance/app/project/serverTime",
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function main() {
  const ws = new WebSocket(WS_URL);
  const pending = new Map();
  const scripts = [];
  const requests = [];
  const responses = [];
  const pausedEvents = [];
  const fetchPausedEvents = [];
  const consoleEvents = [];
  const waiters = [];
  let id = 1;

  function resolveWaiters(msg) {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (waiter.method !== msg.method) continue;
      if (waiter.predicate && !waiter.predicate(msg)) continue;
      waiters.splice(i, 1);
      waiter.resolve(msg);
    }
  }

  function waitForEvent(method, predicate, timeoutMs) {
    return withTimeout(
      new Promise((resolve) => {
        waiters.push({ method, predicate, resolve });
      }),
      timeoutMs,
      null
    );
  }

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

    if (msg.method === "Debugger.scriptParsed") {
      scripts.push({
        scriptId: msg.params.scriptId,
        url: msg.params.url || "",
        hash: msg.params.hash || "",
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

    if (msg.method === "Network.responseReceived") {
      responses.push({
        requestId: msg.params.requestId,
        url: msg.params.response && msg.params.response.url,
        status: msg.params.response && msg.params.response.status,
        mimeType: msg.params.response && msg.params.response.mimeType,
      });
    }

    if (msg.method === "Debugger.paused") {
      pausedEvents.push({
        reason: msg.params.reason,
        hitBreakpoints: msg.params.hitBreakpoints || [],
        callFrames: (msg.params.callFrames || []).map((frame) => ({
          functionName: frame.functionName || "",
          url: frame.url || "",
          lineNumber: frame.location ? frame.location.lineNumber : null,
          columnNumber: frame.location ? frame.location.columnNumber : null,
          callFrameId: frame.callFrameId,
        })),
      });
    }

    if (msg.method === "Fetch.requestPaused") {
      fetchPausedEvents.push({
        requestId: msg.params.requestId,
        networkId: msg.params.networkId || "",
        url: msg.params.request && msg.params.request.url,
        method: msg.params.request && msg.params.request.method,
        headers: msg.params.request && msg.params.request.headers,
      });
    }

    if (msg.method === "Runtime.consoleAPICalled") {
      consoleEvents.push({
        type: msg.params.type,
        args: (msg.params.args || []).map((arg) =>
          Object.prototype.hasOwnProperty.call(arg, "value") ? arg.value : arg.description
        ),
      });
    }

    resolveWaiters(msg);
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
  handshake.consoleEnable = takeResult(await send("Console.enable"));
  handshake.logEnable = takeResult(await send("Log.enable"));

  handshake.initialReload = takeResult(await send("Page.reload", { ignoreCache: true }));
  await delay(STARTUP_WAIT_MS);

  const uniqueScriptUrls = scripts
    .map((item) => item.url)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const breakpointTarget =
    uniqueScriptUrls.find((url) => url.includes("WAServiceMainContext.js")) ||
    uniqueScriptUrls.find((url) => url.includes("WAPCAdapterAppIndex.js")) ||
    uniqueScriptUrls.find((url) => url.startsWith("https://lib/")) ||
    uniqueScriptUrls.find((url) => url.startsWith("https://servicewechat.com/")) ||
    FALLBACK_BREAKPOINT_URLS[0] ||
    null;

  let breakpoint = { ok: false, error: "no script target found" };
  let paused = null;
  if (breakpointTarget) {
    breakpoint = takeResult(
      await send("Debugger.setBreakpointByUrl", {
        lineNumber: 0,
        url: breakpointTarget,
      })
    );

    if (breakpoint.ok) {
      const pausedPromise = waitForEvent("Debugger.paused", null, PAUSE_WAIT_MS);
      const reloadResult = takeResult(await send("Page.reload", { ignoreCache: true }));
      paused = await pausedPromise;
      breakpoint.reloadResult = reloadResult;

      if (paused) {
        breakpoint.pausedTopFrame =
          paused.params &&
          paused.params.callFrames &&
          paused.params.callFrames[0]
            ? {
                functionName: paused.params.callFrames[0].functionName || "",
                url: paused.params.callFrames[0].url || "",
                lineNumber: paused.params.callFrames[0].location
                  ? paused.params.callFrames[0].location.lineNumber
                  : null,
                columnNumber: paused.params.callFrames[0].location
                  ? paused.params.callFrames[0].location.columnNumber
                  : null,
              }
            : null;
        breakpoint.resume = takeResult(await send("Debugger.resume"));
      }

      if (breakpoint.result && breakpoint.result.breakpointId) {
        breakpoint.remove = takeResult(
          await send("Debugger.removeBreakpoint", {
            breakpointId: breakpoint.result.breakpointId,
          })
        );
      }
    }
  }

  await delay(3000);

  const domWrite = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          let node = document.getElementById('${DOM_MARKER_ID}');
          if (!node) {
            node = document.createElement('div');
            node.id = '${DOM_MARKER_ID}';
            node.style.position = 'fixed';
            node.style.top = '0';
            node.style.left = '0';
            node.style.zIndex = '2147483647';
            node.style.padding = '6px 10px';
            node.style.background = '#07c160';
            node.style.color = '#fff';
            node.style.fontSize = '12px';
            document.body.appendChild(node);
          }
          node.textContent = '${DOM_MARKER_TEXT}-' + Date.now();
          console.log('${CONSOLE_MARKER}:dom', node.textContent);
          return {
            id: node.id,
            text: node.textContent
          };
        })()
      `,
      returnByValue: true,
    })
  );

  const domRead = takeResult(
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const node = document.getElementById('${DOM_MARKER_ID}');
          return node ? { text: node.textContent, visible: !!node.offsetParent || true } : null;
        })()
      `,
      returnByValue: true,
    })
  );

  const observedApiUrls = requests
    .map((item) => item.url)
    .filter((url) => typeof url === "string")
    .filter((url) => /^https:\/\/api\.livelab\.com\.cn\//.test(url));

  const replayUrl =
    observedApiUrls.find((url) => url.includes("/member/member/app/info")) ||
    observedApiUrls.find((url) => url.includes("/performance/app/project/serverTime")) ||
    observedApiUrls[0] ||
    FALLBACK_API_URLS[0] ||
    null;

  let fetchIntercept = { ok: false, error: "no api url observed" };
  if (replayUrl) {
    fetchIntercept.enable = takeResult(
      await send("Fetch.enable", {
        patterns: [{ urlPattern: replayUrl, requestStage: "Request" }],
      })
    );

    const pausePromise = waitForEvent(
      "Fetch.requestPaused",
      (msg) => msg.params && msg.params.request && msg.params.request.url === replayUrl,
      FETCH_WAIT_MS
    );

    fetchIntercept.replay = takeResult(
      await send("Runtime.evaluate", {
        expression: `
          (() => {
            const url = ${JSON.stringify(replayUrl)};
            fetch(url, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store'
            })
              .then((resp) => resp.text().then((text) => ({ status: resp.status, length: text.length })))
              .then((info) => console.log('${CONSOLE_MARKER}:fetch', JSON.stringify(info)))
              .catch((err) => console.log('${CONSOLE_MARKER}:fetch_error', String(err)));
            return { url };
          })()
        `,
        returnByValue: true,
      })
    );

    const intercepted = await pausePromise;
    if (intercepted) {
      fetchIntercept.paused = {
        url: intercepted.params.request.url,
        method: intercepted.params.request.method,
        headers: intercepted.params.request.headers || {},
        networkId: intercepted.params.networkId || "",
      };
      fetchIntercept.continue = takeResult(
        await send("Fetch.continueRequest", { requestId: intercepted.params.requestId })
      );
      const responseEvent = await waitForEvent(
        "Network.responseReceived",
        (msg) => msg.params && msg.params.response && msg.params.response.url === replayUrl,
        RESPONSE_WAIT_MS
      );
      fetchIntercept.response = responseEvent
        ? {
            url: responseEvent.params.response.url,
            status: responseEvent.params.response.status,
            mimeType: responseEvent.params.response.mimeType,
          }
        : null;
    }

    fetchIntercept.disable = takeResult(await send("Fetch.disable"));
  }

  await delay(2000);

  const markerConsoleEvents = consoleEvents.filter((item) =>
    item.args.some((arg) => String(arg).includes(CONSOLE_MARKER))
  );

  const output = {
    ws_url: WS_URL,
    handshake,
    breakpoint_target: breakpointTarget,
    breakpoint,
    paused_event_count: pausedEvents.length,
    dom_write: domWrite,
    dom_read: domRead,
    replay_url: replayUrl,
    fetch_intercept: fetchIntercept,
    marker_console_events: markerConsoleEvents,
    observed_api_urls: observedApiUrls.slice(0, 10),
    request_count: requests.length,
    response_count: responses.length,
    sample_script_urls: uniqueScriptUrls.slice(0, 20),
  };

  console.log(JSON.stringify(output, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: String(error && error.stack ? error.stack : error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
