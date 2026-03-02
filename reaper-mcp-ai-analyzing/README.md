# REAPER MCP AI Analyzing

[English](#english) | [中文](#中文)

<a name="english"></a>
## English

A Model Context Protocol (MCP) server for REAPER DAW with **AI-powered audio analysis**. Control REAPER through natural language and get intelligent mix suggestions from AI models with audio capabilities.

### 🚀 Features

- **25+ MCP Tools** for REAPER control (tracks, FX, routing, media items)
- **AI Audio Analysis** - Analyze mixes with ANY audio-capable AI model
- **File-based IPC** - No network required, works on macOS/Windows/Linux
- **Multi-Provider Support** - OpenAI, Google Gemini, Anthropic Claude, and any OpenAI-compatible API

### 🤖 Supported AI Models

| Provider | Supported Models | Audio Input |
|----------|------------------|-------------|
| **OpenAI** | gpt-4o-audio-preview, gpt-4o-mini-audio-preview | ✅ Native |
| **Google** | gemini-2.5-pro, gemini-2.5-flash | ✅ Native |
| **Anthropic** | claude-4-opus, claude-4-sonnet | ✅ File attachment |
| **Custom** | Any OpenAI-compatible API | Depends on model |

### 📁 Project Structure

```
reaper-mcp-ai-analyzing/
├── src/
│   ├── index.ts              # MCP Server main entry
│   ├── types/
│   │   └── reaper.ts         # Type definitions
│   ├── utils/
│   │   ├── env.ts            # Environment config
│   │   ├── logger.ts         # Logging utility
│   │   └── audio.ts          # Audio processing
│   ├── bridge/
│   │   └── file-client.ts    # File IPC client
│   └── ai/
│       ├── analyzer.ts       # Audio analysis coordinator
│       └── providers/
│           ├── base.ts       # Base AI provider
│           └── openai.ts     # OpenAI implementation
├── bridge/
│   └── file-bridge.lua       # REAPER Lua bridge script
└── package.json
```

### 🔧 Installation

```bash
# Clone the repository
git clone https://github.com/YangJue213-spec/reaper-mcp-ai-analyzing.git
cd reaper-mcp-ai-analyzing

# Install dependencies
npm install

# Build the project
npm run build

# Configure environment
cp .env.example .env
# Edit .env with your OpenAI API key
```

### ⚙️ Configuration (.env)

```bash
# ============================================
# AI Provider Configuration
# ============================================

# Provider Type: 'openai', 'gemini', 'anthropic', or 'custom'
AI_PROVIDER=openai

# --- OpenAI Configuration ---
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
AUDIO_MODEL_NAME=gpt-4o-audio-preview
# Alternative models: gpt-4o-mini-audio-preview

# --- Google Gemini Configuration ---
# GEMINI_API_KEY=your-gemini-key-here
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# AUDIO_MODEL_NAME=gemini-2.5-pro
# Alternative models: gemini-2.5-flash

# --- Anthropic Claude Configuration ---
# ANTHROPIC_API_KEY=your-anthropic-key-here
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# AUDIO_MODEL_NAME=claude-4-opus-20250514
# Alternative models: claude-4-sonnet-20250514

# ============================================
# REAPER Configuration
# ============================================
REAPER_SCRIPT_TIMEOUT=30000
```

### 🎮 MCP Tools

#### Project & Track Control
- `get_project_info` - Get project sample rate, tempo, track count
- `get_track_info` - Get track details (volume, pan, FX count, etc.)
- `create_track` - Create new track with optional name
- `delete_track` - Delete track by index
- `set_track_name` - Rename a track
- `set_track_volume` - Set volume in dB
- `set_track_pan` - Set pan (-1 to 1)
- `set_track_send` - Create send to another track
- `set_track_output` - Route track output

#### FX Control
- `get_track_fx` - List all FX on a track
- `add_fx_to_track` - Add plugin (supports Waves, FabFilter, generic)
- `remove_fx_from_track` - Remove FX by index
- `get_fx_params` - Get all parameters of an FX
- `set_fx_param` - Set parameter by absolute value
- `set_fx_param_normalized` - Set parameter (0-1 normalized)
- `set_fx_enabled` - Enable/disable FX

#### Media Items
- `get_item_info` - Get item position, length, fades
- `split_item` - Split item at position

#### AI Analysis (Core Feature)
- `analyze_and_suggest_mix` - Render and analyze audio with AI
- `start_audio_analysis` - Start async analysis task
- `get_analysis_status` - Check analysis progress

### 🔌 MCP Configuration

Add to your MCP client settings (Claude Desktop, Cline, etc.):

```json
{
  "mcpServers": {
    "reaper-ai": {
      "command": "node",
      "args": ["/path/to/reaper-mcp-ai-analyzing/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "your_api_key_here",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "AUDIO_MODEL_NAME": "gpt-4o-audio-preview"
      }
    }
  }
}
```

### 🎵 How to Use

#### 1. Setup REAPER Bridge
1. Open REAPER
2. Go to **Actions** → **Show Action List**
3. Click **New Action** → **Load ReaScript**
4. Select `bridge/file-bridge.lua`
5. The bridge is now running (check REAPER console for "REAPER MCP Bridge started")

#### 2. Start MCP Server
```bash
npm start
```

#### 3. Use Natural Language Prompts

**Example 1: Analyze a track**
```
"Analyze the lead vocal track (track 0) and suggest EQ improvements"
```

**Example 2: Check mix loudness**
```
"Check the overall mix loudness and tell me if it meets streaming standards"
```

**Example 3: Add FX and analyze**
```
"Add a compressor to the bass track, then analyze if the dynamics are better"
```

### 📝 Example Prompts

```markdown
1. "Get project info and list all tracks"
2. "Set track 0 volume to -6 dB and pan to 0.2"
3. "Add Pro-Q 3 to track 1 and analyze the frequency balance"
4. "Check REAPER connection status"
5. "Analyze the master mix from 0 to 30 seconds"
```

---

<a name="中文"></a>
## 中文

带有 **AI 音频分析功能** 的 REAPER MCP 服务器。通过自然语言控制 REAPER，并从任何支持音频输入的 AI 模型获取智能混音建议。

### 🚀 功能特性

- **25+ MCP 工具** 用于 REAPER 控制
- **AI 音频分析** - 使用任何支持音频的 AI 模型分析混音
- **文件 IPC** - 无需网络，支持 macOS/Windows/Linux
- **多提供商支持** - OpenAI、Google Gemini、Anthropic Claude

### 🤖 支持的 AI 模型

| 提供商 | 支持的模型 | 音频输入 |
|--------|-----------|---------|
| **OpenAI** | gpt-4o-audio-preview, gpt-4o-mini-audio-preview | ✅ 原生支持 |
| **Google** | gemini-2.5-pro, gemini-2.5-flash | ✅ 原生支持 |
| **Anthropic** | claude-4-opus, claude-4-sonnet | ✅ 文件附件 |
| **自定义** | 任何兼容 OpenAI 的 API | 取决于模型 |

### 🔧 安装

```bash
git clone https://github.com/YangJue213-spec/reaper-mcp-ai-analyzing.git
cd reaper-mcp-ai-analyzing
npm install
npm run build
cp .env.example .env
# 编辑 .env 配置你的 AI 提供商
```

### ⚙️ 配置 (.env)

```bash
# ============================================
# AI 提供商配置
# ============================================

# 提供商类型: 'openai', 'gemini', 'anthropic', 或 'custom'
AI_PROVIDER=openai

# --- OpenAI 配置 ---
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
AUDIO_MODEL_NAME=gpt-4o-audio-preview
# 备选模型: gpt-4o-mini-audio-preview

# --- Google Gemini 配置 ---
# GEMINI_API_KEY=your-gemini-key-here
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# AUDIO_MODEL_NAME=gemini-2.5-pro
# 备选模型: gemini-2.5-flash

# --- Anthropic Claude 配置 ---
# ANTHROPIC_API_KEY=your-anthropic-key-here
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# AUDIO_MODEL_NAME=claude-4-opus-20250514
# 备选模型: claude-4-sonnet-20250514

# ============================================
# REAPER 配置
# ============================================
REAPER_SCRIPT_TIMEOUT=30000
```

### 🔌 MCP 配置

添加到 Claude Desktop、Cline 等 MCP 客户端：

```json
{
  "mcpServers": {
    "reaper-ai": {
      "command": "node",
      "args": ["/path/to/reaper-mcp-ai-analyzing/build/index.js"],
      "env": {
        "AI_PROVIDER": "openai",
        "OPENAI_API_KEY": "your_api_key_here",
        "AUDIO_MODEL_NAME": "gpt-4o-audio-preview"
      }
    }
  }
}
```

### 🎵 使用方法

#### 1. 设置 REAPER 桥接
1. 打开 REAPER
2. 进入 **动作** → **显示动作列表**
3. 点击 **新建动作** → **加载 ReaScript**
4. 选择 `bridge/file-bridge.lua`
5. 桥接已启动（在 REAPER 控制台查看）

#### 2. 启动 MCP 服务器
```bash
npm start
```

#### 3. 使用自然语言

**示例 1：分析轨道**
```
"分析主唱轨道（轨道 0）并建议 EQ 调整"
```

**示例 2：检查响度**
```
"检查整体混音响度，是否符合流媒体标准"
```

### 📝 提示词示例

```markdown
1. "获取工程信息并列出所有轨道"
2. "将轨道 0 音量设为 -6 dB，声像设为 0.2"
3. "给轨道 1 添加 Pro-Q 3 并分析频响平衡"
4. "检查 REAPER 连接状态"
5. "分析主混音从 0 到 30 秒的部分"
```

### 🛠️ 故障排除

**"REAPER file bridge is not available"**
- 确保 Lua 脚本已在 REAPER 中运行
- 检查 REAPER 控制台是否有错误信息
- 确认 `/tmp/reaper-mcp` 目录可访问

**"AI Analyzer not initialized"**
- 检查 `.env` 文件中的 `OPENAI_API_KEY`
- 确保已运行 `npm run build`

### 📜 License

MIT License - See [LICENSE](LICENSE) file