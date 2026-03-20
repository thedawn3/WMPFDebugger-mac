#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const DEBUG_PORT = 62000;
const devtoolsUrl =
    process.argv[2] ||
    `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${DEBUG_PORT}`;
const browser = process.env.WMPF_DEVTOOLS_BROWSER || "Google Chrome";

try {
    execFileSync(
        "osascript",
        [
            "-e",
            `tell application "${browser}" to activate`,
            "-e",
            `tell application "${browser}" to open location "${devtoolsUrl}"`,
        ],
        { stdio: "ignore" }
    );
    console.log(`[devtools] Opened in ${browser}: ${devtoolsUrl}`);
} catch (error) {
    console.error(
        `[devtools] Failed to open ${browser}. You can open this URL manually: ${devtoolsUrl}`
    );
    process.exit(1);
}
