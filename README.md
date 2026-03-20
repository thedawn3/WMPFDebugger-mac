# WMPFDebugger-mac

macOS 上的微信小程序远程调试桥，基于微信私有远程调试协议转成标准 Chrome DevTools Protocol (CDP)。

这个仓库当前已经整理成适合长期维护的 fork 基线，重点针对本机验证过的微信 `4.1.7 (34371)` / `XWEB 18788` 场景做了稳定性修正。

## Lineage

代码血缘分两层：

- 原始项目：[`evi0s/WMPFDebugger`](https://github.com/evi0s/WMPFDebugger)
- macOS 直接基线：[`linguo2625469/WMPFDebugger-mac`](https://github.com/linguo2625469/WMPFDebugger-mac)

中间适配分支还包括：

- [`chain00x/WMPFDebugger-arm`](https://github.com/chain00x/WMPFDebugger-arm)

当前这个整理版是基于 `linguo2625469/WMPFDebugger-mac` 做的长期维护 fork，但文档和设计说明统一以 `evi0s/WMPFDebugger` 作为原始来源来描述。

## This fork changed what

相对 mac 直接基线，这个整理版新增了几类改动：

- 自动识别微信 `4.1.7 (34371)`，并映射到 `18788` 偏移配置
- 默认启用稳定模式，降低 `WeApp` 闪退概率
- 默认只附加主 `WeChatAppEx` 进程，不再默认扫全部 `--type=` 子进程
- hook 增加运行时开关，可按需禁用高风险 patch
- 补充协议级验证脚本，便于在没有稳定 DevTools UI 的情况下做回归测试
- 补充文档，明确长期使用流程和风险边界

详细变更见 `docs/FORK_NOTES.md`。

## Verified local environment

这份 fork 当前明确按以下本机环境整理和验证：

- WeChat app version: `4.1.7`
- WeChat bundle version: `34371`
- `WeChatAppEx` runtime `client_version`: `4066645761` (`0xf2641701`)
- XWEB / WMPF config target: `18788`

这组版本信息的详细记录见 `docs/VERSION_MATRIX.md`。

## Supported versions

当前明确整理和验证过的版本：

- `34371 -> 18788` (macOS WeChat `4.1.7`)
- `18152`
- `18788`

版本号检测命令：

```bash
defaults read /Applications/WeChat.app/Contents/MacOS/WeChatAppEx.app/Contents/Info.plist CFBundleVersion
```

如果输出是纯 `34371`，本仓库会自动映射到 `18788` 配置。

## Requirements

- macOS
- Node.js 22+
- yarn
- Chromium 内核浏览器，推荐 `Google Chrome`
- 已安装并运行微信 macOS 版
- SIP 已关闭，否则 Frida 无法附加

## Install

```bash
yarn
```

## Quick start

如果你只是想先把 hook 挂起来并确认是否工作，按这个最短流程做：

1. 如果微信还没启动，`make up` 会尝试自动拉起；更稳的做法仍然是先手动打开一次目标小程序
2. 在仓库目录执行：

```bash
cd /Users/thedawn/codex-work/playground/wechat-devtools-417/WMPFDebugger-mac-fork
make up
```

3. 控制台会先自动检查：

- 微信是否已启动
- `WeChatAppEx` 是否就绪
- 是否检测到 `WeApp` 渲染进程
- `9421` / `62000` 端口是否被旧进程占用

4. 看到下面这类输出，说明 hook 已经挂上：

```text
[doctor] Initial process state: WeChat=1 WeChatAppEx=1 Helpers=... WeApp=0
[doctor] WeChat is running, but no WeApp renderer detected yet
[doctor] Please open the target mini program business page in WeChat
[server] debug server running on ws://localhost:9421
[server] proxy server running on ws://localhost:62000
[frida] Selected WeChatAppEx process(es): ...
[frida] Loaded script from: ...
[frida] Successfully attached to PID ...
```

5. 如果随后检测到小程序页面打开，控制台还会继续提示：

```text
[doctor] WeApp renderer detected: WeChat=1 WeChatAppEx=1 Helpers=... WeApp=1
[doctor] Chrome DevTools URL: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
```

6. 再用 `Google Chrome` 打开：

```text
devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
```

如果只是要验证桥有没有活着，先不要跑高压测试，优先执行：

```bash
make probe-basic
```

如果终端里没有出现 `Successfully attached to PID`，或者直接报 `Failed to attach`、`hook script not found`、`No WeChatAppEx processes found`，先不要继续点小程序，直接看终端报错。

如果你不想记 `yarn` 命令，也可以直接用这些快捷命令：

```bash
make up
make stable
make compat
make full
make doctor
make probe-basic
make probe-advanced
make probe-live
```

## Recommended stable workflow

先按这个流程用，不要一上来就开 `start:compat` 或 `start:full`。

1. 完全退出微信和本工具
2. 正常启动微信
3. 先把目标小程序正常打开一次，让缓存和运行态预热完成
4. 回到仓库执行：

```bash
make stable
```

5. 再次打开目标小程序，进入真正的业务页面，不要停在“小程序列表/最近使用”页
6. 用 `Google Chrome` 打开：

```text
devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
```

如果你要做回归验证，而不是人工点 DevTools，先跑：

```bash
make probe-basic
```

确认 `make up` / `make stable` 本身不闪退后，再考虑 `make probe-advanced` 或 `make probe-live`。

更详细的稳定使用说明见 `docs/STABLE_MODE.md`。

## Runtime modes

### Stable mode (default)

```bash
make stable
```

特点：

- 只附加主 `WeChatAppEx` 进程
- 默认关闭 loadstart flag patch
- 默认关闭 scene rewrite
- 默认关闭 CDP filter patch
- 默认关闭 resource cache patch
- 目标是先保证小程序不闪退，再逐项恢复调试能力

### Compat mode

```bash
make compat
```

特点：

- 保持只附加主 `WeChatAppEx` 进程
- 开启 loadstart flag patch
- 开启 scene rewrite
- 开启 CDP filter patch
- 仍然关闭 resource cache patch
- 适合在 `start:stable` 不崩但调试入口不足时逐步加功能

### Full mode

```bash
make full
```

特点：

- 会启用更激进的 patch
- 适合排查兼容性或做偏移研究
- 不建议作为日常长期方案

## Runtime flags

`src/index.js` 支持以下开关：

- `--attach-all`：附加所有匹配到的 `WeChatAppEx` 进程
- `--force-loadstart-flag`：启用 loadstart 第二参数强制改写
- `--no-force-loadstart-flag`：禁用 loadstart 第二参数强制改写
- `--patch-resource-cache`：启用 resource cache patch
- `--no-cdp-filter`：禁用 CDP filter patch
- `--no-scene-rewrite`：禁用 scene rewrite
- `--verbose-hook`：输出更详细 hook 日志
- `--unsafe`：关闭稳定模式默认值

对应环境变量：

- `WMPF_SAFE_MODE`
- `WMPF_ATTACH_ALL`
- `WMPF_FORCE_LOADSTART_FLAG`
- `WMPF_PATCH_RESOURCE_CACHE`
- `WMPF_PATCH_CDP_FILTER`
- `WMPF_REWRITE_SCENE`
- `WMPF_VERBOSE_HOOK`

## Validation tools

协议级验证脚本已经整理到 `tools/`：

- `tools/cdp_probe.js`：基础连通性、脚本抓取、请求抓取、DOM/console 注入
- `tools/cdp_advanced_probe.js`：断点、请求拦截、DOM 覆盖层、console 联动
- `tools/cdp_live_validation.js`：偏实战的 live validation 方案

命令：

```bash
yarn probe:basic
yarn probe:advanced
yarn probe:live
```

详见 `docs/VALIDATION.md`。

## Troubleshooting

### 打得开 DevTools，但小程序会闪退

优先怀疑以下问题：

- 使用了过于激进的 patch
- 在小程序冷启动、无缓存时就开始 hook
- 附加到了不该附加的 `WeChatAppEx --type=` 子进程
- 同时开了多个 DevTools 客户端，导致调试链压力过大

先改回稳定流程：

1. 关掉多余的 `devtools://` 标签页
2. 完全退出微信和本工具
3. 正常打开一次目标小程序
4. 再执行 `yarn start:stable`

如果 `start:stable` 不闪退但调试能力不足，再按这个顺序逐步加压：

1. `WMPF_PATCH_CDP_FILTER=1 yarn start:stable`
2. `WMPF_PATCH_CDP_FILTER=1 WMPF_REWRITE_SCENE=1 yarn start:stable`
3. `WMPF_FORCE_LOADSTART_FLAG=1 WMPF_PATCH_CDP_FILTER=1 WMPF_REWRITE_SCENE=1 yarn start:stable`
4. 最后才用 `yarn start:compat` 或 `yarn start:full`

### 连接上了，但当前上下文没有 `wx`

这通常说明你连到的是 `page-frame.html / AppIndex / WebView` 层，而不是 `AppService` 逻辑层。

### 版本不支持

如果没有对应偏移配置，需要自己补版本配置文件。可参考：

- `evi0s/WMPFDebugger` 的版本适配思路
- `chain00x/WMPFDebugger-arm` 的 mac 偏移经验
- 本仓库现有 `frida/config/addresses.*.json`

## Repository layout

```text
WMPFDebugger-mac/
├── docs/
│   ├── FORK_NOTES.md
│   ├── STABLE_MODE.md
│   └── VALIDATION.md
├── frida/
│   ├── config/
│   └── hook.js
├── src/
│   ├── index.js
│   └── third-party/
├── tools/
│   ├── cdp_probe.js
│   ├── cdp_advanced_probe.js
│   └── cdp_live_validation.js
├── package.json
└── README.md
```

## Disclaimer

仅供学习和授权环境下的本地研究使用。使用本项目产生的任何风险由使用者自行承担。
