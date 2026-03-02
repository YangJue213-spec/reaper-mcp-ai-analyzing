# REAPER MCP AI Analyzing

[English](#english) | [中文](#中文)

<a name="english"></a>
## English

A Model Context Protocol (MCP) server for REAPER DAW with **AI-powered audio analysis**. Control REAPER through natural language and get intelligent mix suggestions from any AI model with audio capabilities.

### Features

- **30+ MCP tools** for REAPER control (tracks, FX, routing, media items)
- **AI Audio Analysis** - Analyze mixes with ANY audio-capable AI model
- **Multi-Provider Support** - OpenAI, Google Gemini, Anthropic Claude, or any OpenAI-compatible API
- **File-based IPC** - No network required, works on macOS/Windows/Linux

### AI Audio Analysis

The standout feature of this MCP server is **AI-powered audio analysis**. You can use ANY AI model that supports audio input:

#### Supported AI Providers

| Provider | Model Examples | Base URL |
|----------|---------------|----------|
| **OpenAI** | gpt-4o-audio-preview, gpt-4o-mini-audio-preview | https://api.openai.com/v1 |
| **Google** | gemini-1.5-pro, gemini-1.5-flash | https://generativelanguage.googleapis.com |
| **Anthropic** | claude-3-opus, claude-3-sonnet | https://api.anthropic.com |
| **Custom** | Any OpenAI-compatible API | Your custom endpoint |

### Installation

```bash
git clone https://github.com/[your-username]/reaper-mcp-ai-analyzing.git
cd reaper-mcp-ai-analyzing
npm install
npm run build
cp .env.example .env
# Edit .env with your AI provider settings
```

### Configuration (.env)

```bash
# Required: API Key from your AI provider
OPENAI_API_KEY=your_api_key_here

# Required: Base URL of your AI provider
OPENAI_BASE_URL=https://api.openai.com/v1

# Required: AI Model Name (must support audio input)
AUDIO_MODEL_NAME=gpt-4o-audio-preview
```

### AI Analysis Tools

- `analyze_and_suggest_mix` - AI analyzes audio and suggests mix improvements
- `start_audio_analysis` - Start async analysis task
- `get_analysis_status` - Get analysis results

---

<a name="中文"></a>
## 中文

带有 **AI 音频分析功能** 的 REAPER MCP 服务器。通过自然语言控制 REAPER，并从任何支持音频的 AI 模型获取智能混音建议。

### 功能特性

- **30+ MCP 工具** 用于 REAPER 控制（轨道、效果器、路由、媒体项目）
- **AI 音频分析** - 使用任何支持音频的 AI 模型分析混音
- **多提供商支持** - OpenAI、Google Gemini、Anthropic Claude 或任何兼容 OpenAI 的 API
- **文件 IPC** - 无需网络，支持 macOS/Windows/Linux

### AI 音频分析

本服务器的突出功能是 **AI 驱动的音频分析**。您可以使用任何支持音频输入的 AI 模型：

#### 支持的 AI 提供商

| 提供商 | 模型示例 | Base URL |
|--------|---------|----------|
| **OpenAI** | gpt-4o-audio-preview, gpt-4o-mini-audio-preview | https://api.openai.com/v1 |
| **Google** | gemini-1.5-pro, gemini-1.5-flash | https://generativelanguage.googleapis.com |
| **Anthropic** | claude-3-opus, claude-3-sonnet | https://api.anthropic.com |
| **自定义** | 任何兼容 OpenAI 的 API | 您的自定义端点 |

### 安装

```bash
git clone https://github.com/[your-username]/reaper-mcp-ai-analyzing.git
cd reaper-mcp-ai-analyzing
npm install
npm run build
cp .env.example .env
# 编辑 .env 配置您的 AI 提供商设置
```

### 配置 (.env)

```bash
# 必需：AI 提供商的 API 密钥
OPENAI_API_KEY=your_api_key_here

# 必需：AI 提供商的 Base URL
OPENAI_BASE_URL=https://api.openai.com/v1

# 必需：AI 模型名称（必须支持音频输入）
AUDIO_MODEL_NAME=gpt-4o-audio-preview
```

### AI 分析工具

- `analyze_and_suggest_mix` - AI 分析音频并提出混音改进建议
- `start_audio_analysis` - 启动异步分析任务
- `get_analysis_status` - 获取分析结果

### 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
