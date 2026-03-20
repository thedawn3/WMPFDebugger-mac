#!/usr/bin/env node

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const entrypoint = path.join(projectRoot, "src", "index.js");
const DEBUG_PORT = 9421;
const CDP_PORT = 62000;
const REQUIRED_MODULES = ["ws", "protobufjs", "frida"];

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

    const timer = setInterval(() => {
        if (childExited) return;
        try {
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
                } else {
                    log(`Waiting for mini program page: ${formatState(state)}`);
                }
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
