# RePix Local

RePix Local 是 [RePix](https://github.com) 的本地桌面版：用 **Tauri 2 + Rust + SQLite** 在单机完成 AI 视频复刻工作流，UI 与网页版 `re-pix/apps/web` 对齐（Tailwind v4、shadcn 风格组件、中英双语）。

无需单独启动后端服务；所有任务、日志、素材与配置均由桌面应用本地管理。

## 功能

| 页面 | 说明 |
|------|------|
| **总览** | 任务统计、7 日趋势、状态分布、处理队列、API 用量 |
| **新建任务** | 选择本地 MP4/MOV，配置分辨率、画幅、语言、改写风格等，提交后进入控制台 |
| **控制台** | 历史 run 列表；详情页含阶段时间线、实时日志、费用与任务素材；支持取消运行与恢复失败任务 |
| **素材库** | 按类型筛选（全部 / 成片 / 片段 / 分镜 / 音频），本地文件预览 |
| **设置** | Provider API Key、OSS/S3、Whisper/FFmpeg 路径、Mock 模式开关 |

实时更新通过 Tauri `pipeline-event` 事件推送，运行中的任务辅以轮询兜底。

## 技术栈

- **前端**：React 18、Vite 5、Tailwind CSS v4、Radix UI、Zod
- **桌面壳**：Tauri 2（Windows NSIS 安装包）
- **后端**：Rust（Tokio、SQLx + SQLite、reqwest、rust-s3）
- **媒体**：FFmpeg / FFprobe、whisper.cpp
- **密钥**：系统 keyring + AES-GCM 加密存储

## 环境要求

- **Node.js** 18+ 与 npm
- **Rust** stable（含 `cargo`）
- **Tauri 依赖**（Windows 需 WebView2；首次开发建议安装 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）
- **FFmpeg / FFprobe / whisper-cli**：Windows 安装包已内置；也可在设置页覆盖为自定义路径
- **Whisper 模型**：首次转写时自动从 Hugging Face 下载到本地 `models/whisper/`（默认 `base` 模型）

## 快速开始

```powershell
# 克隆后进入项目目录
cd re-pix-local

# 安装前端依赖
npm install

# 开发模式（启动 Vite + Tauri 桌面窗口）
npm run dev
```

### 常用命令

```powershell
npm run ui:dev      # 仅前端（http://127.0.0.1:1420，无 Tauri 能力）
npm run ui:check    # TypeScript 类型检查
npm run ui:build    # 构建前端到 dist/
npm run rust:check  # Rust 编译检查
npm run rust:test   # Rust 单元测试
npm run test        # ui:check + rust:test
npm run check       # ui:check + rust:check + rust:test（提交前推荐）
npm run fetch-tools # 下载并准备内置 FFmpeg / whisper-cli（打包前自动执行）
npm run build       # 打包 Windows NSIS 安装包
npm run build:win   # 同上，显式指定 x86_64-pc-windows-msvc
```

安装包输出目录：`src-tauri/target/release/bundle/nsis/`（`.exe` 安装程序）。

## 项目结构

```
re-pix-local/
├── ui/src/                 # React 前端
│   ├── views/              # Dashboard、Wizard、Console、Library、Settings
│   ├── components/         # Shell、ConsoleLive、AssetSections、shadcn UI
│   ├── api.ts              # Tauri invoke 封装
│   ├── messages/           # 中英文文案
│   └── lib/                # schema、library、asset-url 等
├── src-tauri/
│   ├── src/
│   │   ├── commands/       # Tauri 命令
│   │   ├── workflow/       # 五阶段流水线、取消/恢复
│   │   ├── db/             # SQLite repository + migrations
│   │   ├── providers/      # DeepSeek、Qwen-VL、Tongyi、Seedance
│   │   ├── media/          # FFmpeg、whisper.cpp、ASS 字幕
│   │   └── storage/        # 本地素材 + OSS/S3
│   └── tauri.conf.json
├── .github/workflows/      # CI（typecheck + cargo test）
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
├── config.json       # 系统设置（FFmpeg、OSS、Mock 模式等）
├── tasks/<task_id>/  # 各任务素材（source、audio、frames、segments、final…）
├── logs/
├── temp/
└── models/whisper/   # ggml-*.bin 模型文件
```

素材预览通过 Tauri `convertFileSrc` + `assetProtocol` 加载，scope 已限定在上述工作区。

## 流水线阶段

| # | 阶段 | 真实实现 | Provider / 工具 |
|---|------|----------|-----------------|
| 1 | Transcript Extraction | ✅ | FFmpeg 抽音频 + whisper.cpp；可选 DeepSeek 字幕校正 |
| 2 | Script Rewrite | ✅ | FFmpeg 抽关键帧 + Qwen-VL 分析 + DeepSeek 改写 |
| 3 | Storyboard Generation | ✅ | OSS 上传关键帧 + Tongyi img2img |
| 4 | Segment Generation | ✅ | OSS 上传分镜图 + Seedance 图生视频 |
| 5 | Final Render | ✅ | FFmpeg 拼接片段 + 烧录 ASS 字幕 + 混入源音频 |

**Mock 模式**（设置 → Mock providers）：无需 API Key / OSS，五阶段使用本地占位数据，适合离线演示。

**恢复运行**：失败或取消的任务可在控制台点击「恢复运行」，自动跳过已生成的阶段/场景产物，从断点继续。

控制台会展示真实运行状态与错误信息，不会伪造成功。

## 配置

### Provider API Keys

在 **设置 → Provider API Keys** 中分别配置：

| Provider | 用途 |
|----------|------|
| `DEEPSEEK` | 字幕校正、脚本改写 |
| `QWEN_VL` | 源视频关键帧视觉分析 |
| `TONGYI` | 分镜图 img2img 生成 |
| `SEEDANCE` | 视频片段生成 |

每个 Provider 支持保存掩码后的 Key、可选 Base URL、以及模型选择。API Key 通过系统 keyring 加密，不以明文写入数据库。

### 对象存储（Stage 3/4 必需）

Tongyi 与 Seedance 需要公网 HTTPS 图片 URL。在 **设置 → 系统设置 → 对象存储** 中配置：

| 字段 | 说明 |
|------|------|
| S3 Endpoint | 如 `https://oss-cn-shanghai.aliyuncs.com` |
| Public Endpoint | 自定义域名（阿里云 OSS 强烈建议配置，否则 Provider 可能无法读取图片） |
| Bucket / Access Key / Secret Key | 标准 S3 兼容凭证 |

### 外部工具

| 工具 | 用途 |
|------|------|
| FFmpeg / FFprobe | 抽音频、抽帧、拼接、成片 |
| whisper-cli + ggml 模型 | Stage 1 语音转写 |

## 与网页版的关系

本地版 UI 与 `re-pix/apps/web` 视觉和交互对齐，但架构不同：

| | 网页版 | 本地版 |
|---|--------|--------|
| 前端 | Next.js | Vite + React |
| 数据 | Prisma + Postgres | SQLx + SQLite |
| 任务执行 | FastAPI + Celery | Rust workflow（进程内 tokio） |
| 存储 | MinIO/OSS 为主 | 本地文件 + OSS（Provider 调用） |
| 实时更新 | SSE | Tauri `pipeline-event` |
| 登录 | 需要 | 跳过（本地单用户） |

## 开发说明

- 前端路径别名：`@/` → `ui/src/`
- 所有数据访问经 `ui/src/api.ts` 的 `invoke()` 调用，不引入额外 HTTP 层
- 数据库迁移位于 `src-tauri/src/db/migrations/`，应用启动时自动执行
- 提交前运行：`npm run check`
- CI：push 至 `main` 时自动执行 `npm run check`（GitHub Actions，Windows）

## 许可证

本仓库为**私有专有软件**，`package.json` 中标记为 `UNLICENSED`，表示未向第三方授予任何使用、复制或分发权利。版权归项目所有者所有。

- **源代码**：仅限授权维护者访问与修改，禁止未经授权的分发或商用。
- **安装包**：通过购买获得的桌面安装包，适用随附的《最终用户许可协议》（EULA）；EULA 由发行渠道提供，不以本仓库的开源许可证形式授权。

本软件依赖的第三方开源组件（如 React、Tauri 等）仍受其各自许可证约束；发行安装包时需在「关于 / 开源致谢」中保留必要的版权声明。