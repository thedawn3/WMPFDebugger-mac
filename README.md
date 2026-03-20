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

## Recommended stable workflow

先按这个流程用，不要一上来就开 full mode。

1. 完全退出微信和本工具
2. 正常启动微信
3. 先把目标小程序正常打开一次，让缓存和运行态预热完成
4. 回到仓库执行：

```bash
yarn start:stable
```

5. 再次打开目标小程序，进入真正的业务页面，不要停在“小程序列表/最近使用”页
6. 用 `Google Chrome` 打开：

```text
devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
```

如果你要做回归验证，而不是人工点 DevTools，直接跑：

```bash
yarn probe:basic
yarn probe:advanced
```

更详细的稳定使用说明见 `docs/STABLE_MODE.md`。

## Runtime modes

### Stable mode (default)

```bash
yarn start:stable
```

特点：

- 只附加主 `WeChatAppEx` 进程
- 默认开启 scene rewrite
- 默认开启 CDP filter patch
- 默认关闭 resource cache patch
- 目标是先保证小程序不闪退，再保证调试链可用

### Full mode

```bash
yarn start:full
```

特点：

- 会启用更激进的 patch
- 适合排查兼容性或做偏移研究
- 不建议作为日常长期方案

## Runtime flags

`src/index.js` 支持以下开关：

- `--attach-all`：附加所有匹配到的 `WeChatAppEx` 进程
- `--patch-resource-cache`：启用 resource cache patch
- `--no-cdp-filter`：禁用 CDP filter patch
- `--no-scene-rewrite`：禁用 scene rewrite
- `--verbose-hook`：输出更详细 hook 日志
- `--unsafe`：关闭稳定模式默认值

对应环境变量：

- `WMPF_SAFE_MODE`
- `WMPF_ATTACH_ALL`
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
