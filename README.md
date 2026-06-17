# RePix Local

RePix Local 是 [RePix](https://github.com) 的本地桌面版：用 **Tauri 2 + Rust + SQLite** 在单机完成 AI 视频复刻工作流，UI 与网页版 `re-pix/apps/web` 对齐（Tailwind v4、shadcn 风格组件、中英双语）。

无需单独启动后端服务；所有任务、日志、素材与配置均由桌面应用本地管理。

## 功能

| 页面 | 说明 |
|------|------|
| **总览** | 任务统计、7 日趋势、状态分布、处理队列、API 用量 |
| **新建任务** | 选择本地 MP4/MOV，配置分辨率、画幅、语言、改写风格等，提交后进入控制台 |
| **控制台** | 历史 run 列表；详情页含阶段时间线、实时日志、费用与任务素材 |
| **素材库** | 按类型筛选（全部 / 成片 / 片段 / 分镜 / 音频），本地文件预览 |
| **设置** | 四个 Provider API Key（DeepSeek、Qwen-VL、Tongyi、Seedance）、Whisper 模型、FFmpeg 路径 |

实时更新通过 Tauri `pipeline-event` 事件推送，运行中的任务辅以轮询兜底。

## 技术栈

- **前端**：React 18、Vite 5、Tailwind CSS v4、Radix UI、Zod
- **桌面壳**：Tauri 2
- **后端**：Rust（Tokio、SQLx + SQLite、reqwest）
- **媒体**：FFmpeg / FFprobe（本地路径可配置）
- **密钥**：系统 keyring + AES-GCM 加密存储

## 环境要求

- **Node.js** 18+ 与 npm
- **Rust** stable（含 `cargo`）
- **Tauri 依赖**（Windows 需 WebView2；首次开发建议安装 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）
- **FFmpeg / FFprobe**（可在设置页配置路径，或确保在 `PATH` 中）

## 快速开始

```powershell
# 克隆后进入项目目录
cd re-pix-local

# 安装前端依赖
npm install

# 开发模式（启动 Vite + Tauri 桌面窗口）
npm run dev
```

其他常用命令：

```powershell
npm run ui:dev      # 仅前端（http://127.0.0.1:1420，无 Tauri 能力）
npm run ui:check    # TypeScript 类型检查
npm run ui:build    # 构建前端到 dist/
npm run build       # 打包桌面安装包
cargo check --manifest-path src-tauri/Cargo.toml
```

## 项目结构

```
re-pix-local/
├── ui/src/                 # React 前端
│   ├── views/              # 页面（Dashboard、Wizard、Console、Library、Settings）
│   ├── components/       # Shell、ConsoleLive、AssetSections、shadcn UI
│   ├── api.ts              # Tauri invoke 封装
│   ├── messages/           # 中英文文案
│   └── lib/                # schema、library、asset-url 等
├── src-tauri/
│   ├── src/
│   │   ├── commands/       # Tauri 命令
│   │   ├── workflow/       # 流水线引擎与事件
│   │   ├── db/             # SQLite repository + migrations
│   │   ├── providers/      # 外部 AI Provider 集成
│   │   ├── media/          # FFmpeg 封装
│   │   └── storage/        # 本地素材管理
│   └── tauri.conf.json
├── index.html
├── vite.config.ts
└── package.json
```

## 本地数据目录

工作区默认位于：

- **Windows**：`%LOCALAPPDATA%\local\RePix\RePixLocal\`
- **macOS**：`~/Library/Application Support/local.RePix/RePixLocal/`
- **Linux**：`~/.local/share/local/RePix/RePixLocal/`

目录结构：

```
RePixLocal/
├── repix.sqlite      # 任务、run、日志、用量等
├── config.json       # 系统设置（FFmpeg 路径、Whisper 模型等）
├── tasks/<task_id>/  # 各任务素材（source、audio、frames、segments、final…）
├── logs/
└── temp/
```

素材预览通过 Tauri `convertFileSrc` + `assetProtocol` 加载，scope 已限定在上述工作区。

## 流水线阶段

1. **Transcript Extraction** — 转写与音频提取（faster-whisper + FFmpeg）
2. **Script Rewrite** — 关键帧分析与脚本改写（DeepSeek / Qwen-VL）
3. **Storyboard Generation** — 分镜图生成（Tongyi）
4. **Segment Generation** — 视频片段生成（Seedance）
5. **Final Render** — FFmpeg 合成成片

控制台会展示真实运行状态与错误信息，不会伪造成功。

> **当前限制**：Rust workflow 仍在完善中，完整 AI 流程可能于首阶段即失败（例如 FFmpeg 未配置）。UI 与数据层已为完整流程预留入口；后续迭代将实现各 Provider 与阶段逻辑。

## 配置 Provider

在 **设置 → Provider API Keys** 中分别配置：

| Provider | 用途 |
|----------|------|
| `DEEPSEEK` | 脚本改写 |
| `QWEN_VL` | 源视频关键帧视觉分析 |
| `TONGYI` | 分镜图生成 |
| `SEEDANCE` | 视频片段生成 |

每个 Provider 支持保存掩码后的 Key、可选 Base URL、以及从接口拉取的模型列表。API Key 通过系统 keyring 保存，不以明文写入数据库。

## 与网页版的关系

本地版 UI 与 `re-pix/apps/web` 视觉和交互对齐，但架构不同：

| | 网页版 | 本地版 |
|---|--------|--------|
| 前端 | Next.js | Vite + React |
| 数据 | Prisma + Postgres | SQLx + SQLite |
| 任务执行 | FastAPI + Celery | Rust workflow（进程内） |
| 实时更新 | SSE | Tauri `pipeline-event` |
| 登录 | 需要 | 跳过（本地单用户） |

## 开发说明

- 前端路径别名：`@/` → `ui/src/`
- 所有数据访问经 `ui/src/api.ts` 的 `invoke()` 调用，不引入额外 HTTP 层
- 数据库迁移位于 `src-tauri/src/db/migrations/`，应用启动时自动执行
- 提交前建议运行：`npm run ui:check`、`cargo check --manifest-path src-tauri/Cargo.toml`

## 许可证

本仓库为**私有专有软件**，`package.json` 中标记为 `UNLICENSED`，表示未向第三方授予任何使用、复制或分发权利。版权归项目所有者所有。

- **源代码**：仅限授权维护者访问与修改，禁止未经授权的分发或商用。
- **安装包**：通过购买获得的桌面安装包，适用随附的《最终用户许可协议》（EULA）；EULA 由发行渠道提供，不以本仓库的开源许可证形式授权。

本软件依赖的第三方开源组件（如 React、Tauri 等）仍受其各自许可证约束；发行安装包时需在「关于 / 开源致谢」中保留必要的版权声明。