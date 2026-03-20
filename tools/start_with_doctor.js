#!/usr/bin/env node

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const entrypoint = path.join(projectRoot, "src", "index.js");
const DEBUG_PORT = 9421;
const CDP_PORT = 62000;
const DIAGNOSTIC_DIR = path.join(
    process.env.HOME || "",
    "Library/Logs/DiagnosticReports"
);
const REQUIRED_MODULES = ["ws", "protobufjs", "frida"];
const AUTO_OPEN_DEVTOOLS =
    ["1", "true", "yes", "on"].includes(
        String(process.env.WMPF_AUTO_OPEN_DEVTOOLS || "").toLowerCase()
    ) || process.argv.includes("--open-devtools");

const mode = process.argv[2] || "stable";

const MODES = {
    stable: {
        label: "stable",
        args: [],
        env: {
            WMPF_SAFE_MODE: "1",
        },
    },
    compat: {
        label: "compat",
        args: ["--force-loadstart-flag"],
        env: {
            WMPF_SAFE_MODE: "1",
            WMPF_FORCE_LOADSTART_FLAG: "1",
            WMPF_REWRITE_SCENE: "1",
            WMPF_PATCH_CDP_FILTER: "1",
        },
    },
    full: {
        label: "full",
        args: ["--attach-all", "--force-loadstart-flag"],
        env: {
            WMPF_SAFE_MODE: "0",
            WMPF_FORCE_LOADSTART_FLAG: "1",
            WMPF_REWRITE_SCENE: "1",
            WMPF_PATCH_CDP_FILTER: "1",
            WMPF_PATCH_RESOURCE_CACHE: "1",
            WMPF_ATTACH_ALL: "1",
        },
    },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message) => {
    console.log(`[doctor] ${message}`);
};

const lazyLoadWs = () => require("ws");

const readProcessList = () => {
    const output = execFileSync("ps", ["-axo", "pid=,command="], {
        encoding: "utf-8",
    }).trim();

    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(.*)$/);
            if (!match) return null;
            return {
                pid: Number(match[1]),
                command: match[2],
            };
        })
        .filter(Boolean);
};

const getProcessState = () => {
    const rows = readProcessList();

    const wechat = rows.filter(
        (row) =>
            row.command === "/Applications/WeChat.app/Contents/MacOS/WeChat" ||
            row.command.startsWith("/Applications/WeChat.app/Contents/MacOS/WeChat ")
    );
    const appExMain = rows.filter(
        (row) =>
            row.command.includes(
                "/MacOS/WeChatAppEx.app/Contents/MacOS/WeChatAppEx"
            ) && !row.command.includes(" --type=")
    );
    const appExHelpers = rows.filter((row) =>
        row.command.includes("WeChatAppEx Helper")
    );
    const weApp = rows.filter((row) =>
        row.command.includes(
            "/Helpers/WeApp.app/Contents/MacOS/WeApp"
        )
    );

    return {
        wechatCount: wechat.length,
        appExMainCount: appExMain.length,
        appExHelperCount: appExHelpers.length,
        weAppCount: weApp.length,
    };
};

const formatState = (state) =>
    `WeChat=${state.wechatCount} WeChatAppEx=${state.appExMainCount} Helpers=${state.appExHelperCount} WeApp=${state.weAppCount}`;

const portIsFree = (port) =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port, "127.0.0.1");
    });

const portAcceptsConnection = (port) =>
    new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        let settled = false;

        const finish = (value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(700);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });

const ensurePortsFree = async () => {
    const debugPortFree = await portIsFree(DEBUG_PORT);
    const cdpPortFree = await portIsFree(CDP_PORT);

    if (!debugPortFree || !cdpPortFree) {
        throw new Error(
            `Port check failed. ${DEBUG_PORT} free=${debugPortFree} ${CDP_PORT} free=${cdpPortFree}. Close the old hook process first.`
        );
    }
};

const ensureWeChatInstalled = () => {
    if (!fs.existsSync("/Applications/WeChat.app")) {
        throw new Error("WeChat.app not found under /Applications");
    }
};

const ensureDependenciesInstalled = () => {
    const missing = REQUIRED_MODULES.filter((name) => {
        try {
            require.resolve(name, { paths: [projectRoot] });
            return false;
        } catch (_) {
            return true;
        }
    });

    if (missing.length === 0) {
        return;
    }

    log(`Missing dependencies: ${missing.join(", ")}`);
    log("Running yarn install before startup");
    execFileSync("yarn", [], {
        cwd: projectRoot,
        stdio: "inherit",
    });
};

const launchWeChatIfNeeded = async () => {
    const state = getProcessState();
    if (state.wechatCount > 0 && state.appExMainCount > 0) {
        return;
    }

    log("WeChat not fully running, trying to launch it with open -a WeChat");
    execFileSync("open", ["-a", "WeChat"], { stdio: "ignore" });

    for (let i = 0; i < 40; i += 1) {
        await sleep(1000);
        const next = getProcessState();
        if (next.wechatCount > 0 && next.appExMainCount > 0) {
            log(`WeChat is ready: ${formatState(next)}`);
            return;
        }
    }

    throw new Error("Timed out waiting for WeChat / WeChatAppEx to start");
};

const printNextHint = (state) => {
    if (state.weAppCount > 0) {
        log(`Detected active WeApp renderer: ${formatState(state)}`);
        log("You can now open the target business page and then attach Chrome DevTools.");
    } else {
        log(`WeChat is running, but no WeApp renderer detected yet: ${formatState(state)}`);
        log("Please open the target mini program business page in WeChat.");
    }
};

const findNewestWeAppCrash = () => {
    if (!fs.existsSync(DIAGNOSTIC_DIR)) {
        return null;
    }

    const files = fs
        .readdirSync(DIAGNOSTIC_DIR)
        .filter((name) => /^WeApp-.*\.(ips|crash)$/.test(name))
        .map((name) => {
            const fullPath = path.join(DIAGNOSTIC_DIR, name);
            const stat = fs.statSync(fullPath);
            return {
                name,
                fullPath,
                mtimeMs: stat.mtimeMs,
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return files[0] || null;
};

const summarizeCrashFile = (fullPath) => {
    try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const lines = raw.split(/\r?\n/);
        let data = null;

        for (const candidate of [raw, lines.slice(1).join("\n")]) {
            try {
                data = JSON.parse(candidate);
                break;
            } catch (_) {
                // ignore
            }
        }

        if (data) {
            const exceptionType = data?.exception?.type || "unknown";
            const signal = data?.exception?.signal || "unknown";
            const faultingThread = data?.faultingThread;
            const thread =
                Number.isInteger(faultingThread) && data?.threads?.[faultingThread]
                    ? data.threads[faultingThread]
                    : null;
            const threadName = thread?.name || `thread ${faultingThread ?? "unknown"}`;
            return `${exceptionType} / ${signal} / ${threadName}`;
        }

        const exceptionLine =
            lines.find((line) => /Exception Type:/i.test(line))?.trim() || "Exception Type: unknown";
        const signalLine =
            lines.find((line) => /Exception Codes:|Signal:/i.test(line))?.trim() || "Signal: unknown";
        return `${exceptionLine}; ${signalLine}`;
    } catch (error) {
        return `summary unavailable: ${error.message}`;
    }
};

const probeCdpWebSocket = () =>
    new Promise((resolve) => {
        let settled = false;
        let responded = false;
        let opened = false;
        const WebSocket = lazyLoadWs();
        const ws = new WebSocket(`ws://127.0.0.1:${CDP_PORT}`);

        const finish = (result) => {
            if (settled) return;
            settled = true;
            try {
                ws.close();
            } catch (_) {
                // ignore
            }
            resolve(result);
        };

        const timeout = setTimeout(() => {
            finish({
                opened,
                responded,
                message: opened
                    ? "WebSocket opened but no CDP response yet"
                    : "WebSocket did not open",
            });
        }, 1800);

        ws.on("open", () => {
            opened = true;
            try {
                ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            } catch (error) {
                clearTimeout(timeout);
                finish({
                    opened: true,
                    responded: false,
                    message: `WebSocket opened but send failed: ${error.message}`,
                });
            }
        });

        ws.on("message", (data) => {
            responded = true;
            clearTimeout(timeout);
            const text = String(data);
            finish({
                opened: true,
                responded: true,
                message: `CDP responded: ${text.slice(0, 160)}`,
            });
        });

        ws.on("error", (error) => {
            clearTimeout(timeout);
            finish({
                opened,
                responded: false,
                message: `CDP probe error: ${error.message}`,
            });
        });

        ws.on("close", () => {
            if (!settled) {
                clearTimeout(timeout);
                finish({
                    opened,
                    responded,
                    message: opened
                        ? "WebSocket closed before CDP response"
                        : "WebSocket closed before open",
                });
            }
        });
    });

let devtoolsOpened = false;

const tryOpenDevTools = () => {
    if (devtoolsOpened || !AUTO_OPEN_DEVTOOLS) {
        return;
    }

    try {
        execFileSync(process.execPath, [path.join(__dirname, "open_devtools.js")], {
            cwd: projectRoot,
            stdio: "inherit",
        });
        devtoolsOpened = true;
    } catch (error) {
        log(`Auto-open DevTools failed: ${error.message}`);
    }
};

const runDoctorOnly = async () => {
    ensureWeChatInstalled();
    const state = getProcessState();
    log(`Current process state: ${formatState(state)}`);
    if (state.wechatCount === 0) {
        log("WeChat is not running.");
    } else if (state.appExMainCount === 0) {
        log("WeChat is running but WeChatAppEx is not ready yet.");
    } else if (state.weAppCount === 0) {
        log("No WeApp renderer detected. Open a mini program business page.");
    } else {
        log("WeApp renderer detected. Environment looks ready for hook + DevTools.");
        if (AUTO_OPEN_DEVTOOLS) {
            log("Auto-open DevTools is enabled.");
        }
    }
};

const startHook = async () => {
    const preset = MODES[mode];
    if (!preset) {
        throw new Error(`Unknown mode: ${mode}`);
    }

    ensureWeChatInstalled();
    ensureDependenciesInstalled();
    await ensurePortsFree();

    const initial = getProcessState();
    log(`Initial process state: ${formatState(initial)}`);

    await launchWeChatIfNeeded();

    const ready = getProcessState();
    log(`Starting hook in ${preset.label} mode`);
    printNextHint(ready);
    if (ready.weAppCount > 0) {
        tryOpenDevTools();
    }

    const child = spawn(process.execPath, [entrypoint, ...preset.args], {
        cwd: projectRoot,
        env: {
            ...process.env,
            ...preset.env,
        },
        stdio: "inherit",
    });

    let lastWeAppCount = ready.weAppCount;
    let lastAppExMainCount = ready.appExMainCount;
    let childExited = false;
    let cdpReadyLogged = false;
    let debugReadyLogged = false;
    let cdpProbeStarted = false;
    let cdpProbeLogged = false;
    const startupCrashBaseline = findNewestWeAppCrash();
    let seenCrashPath = startupCrashBaseline?.fullPath || null;

    const timer = setInterval(() => {
        if (childExited) return;
        try {
            if (!debugReadyLogged) {
                portAcceptsConnection(DEBUG_PORT).then((ok) => {
                    if (!childExited && ok && !debugReadyLogged) {
                        debugReadyLogged = true;
                        log(`Debug bridge is reachable on ws://127.0.0.1:${DEBUG_PORT}`);
                    }
                });
            }

            if (!cdpReadyLogged) {
                portAcceptsConnection(CDP_PORT).then((ok) => {
                    if (!childExited && ok && !cdpReadyLogged) {
                        cdpReadyLogged = true;
                        log(`CDP bridge is ready on ws://127.0.0.1:${CDP_PORT}`);
                    }
                });
            }

            if (cdpReadyLogged && !cdpProbeStarted) {
                cdpProbeStarted = true;
                probeCdpWebSocket().then((result) => {
                    if (!childExited && !cdpProbeLogged) {
                        cdpProbeLogged = true;
                        log(result.message);
                    }
                });
            }

            const state = getProcessState();
            if (
                state.weAppCount !== lastWeAppCount ||
                state.appExMainCount !== lastAppExMainCount
            ) {
                lastWeAppCount = state.weAppCount;
                lastAppExMainCount = state.appExMainCount;
                if (state.weAppCount > 0) {
                    log(`WeApp renderer detected: ${formatState(state)}`);
                    log(
                        `Chrome DevTools URL: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${CDP_PORT}`
                    );
                    tryOpenDevTools();
                } else {
                    log(`Waiting for mini program page: ${formatState(state)}`);
                }
            }

            const latestCrash = findNewestWeAppCrash();
            if (
                latestCrash &&
                latestCrash.fullPath !== seenCrashPath &&
                (!startupCrashBaseline ||
                    latestCrash.mtimeMs > startupCrashBaseline.mtimeMs)
            ) {
                seenCrashPath = latestCrash.fullPath;
                log(`Detected new WeApp crash log: ${latestCrash.fullPath}`);
                log(`Crash summary: ${summarizeCrashFile(latestCrash.fullPath)}`);
            }
        } catch (error) {
            log(`Process monitor warning: ${error.message}`);
        }
    }, 3000);

    child.on("exit", (code, signal) => {
        childExited = true;
        clearInterval(timer);
        process.exit(code ?? 0);
    });
};

const main = async () => {
    if (mode === "doctor") {
        await runDoctorOnly();
        return;
    }

    await startHook();
};

main().catch((error) => {
    console.error(`[doctor] ${error.message}`);
    process.exit(1);
});
