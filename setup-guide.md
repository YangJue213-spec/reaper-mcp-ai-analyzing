# REAPER MCP AI Analyzing - Setup Guide

## Quick Start

### 1. Prerequisites

- **Node.js** >= 18.0.0
- **REAPER** DAW (latest version recommended)
- **FFmpeg** (for audio analysis)
- **OpenAI API Key** (for AI analysis features)

### 2. Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH

**Linux:**
```bash
sudo apt-get install ffmpeg
```

### 3. Project Setup

```bash
# Clone repository
git clone https://github.com/YangJue213-spec/reaper-mcp-ai-analyzing.git
cd reaper-mcp-ai-analyzing

# Install dependencies
npm install

# Build TypeScript
npm run build

# Configure environment
cp .env.example .env
```

### 4. Configure Environment

Edit `.env` file:
```bash
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
AUDIO_MODEL_NAME=gpt-4o-audio-preview
REAPER_SCRIPT_TIMEOUT=30000
```

### 5. Setup REAPER Bridge

1. Open REAPER
2. Go to **Actions** → **Show Action List**
3. Click **New Action** → **Load ReaScript**
4. Select `bridge/file-bridge.lua`
5. Check REAPER console (View → Console) for "REAPER MCP Bridge started"

### 6. Configure MCP Client

Add to your MCP client configuration:

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "reaper-ai": {
      "command": "node",
      "args": ["/absolute/path/to/reaper-mcp-ai-analyzing/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-api-key"
      }
    }
  }
}
```

**Cline (VS Code settings):**
```json
{
  "mcpServers": {
    "reaper-ai": {
      "command": "node",
      "args": ["/absolute/path/to/reaper-mcp-ai-analyzing/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-api-key"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 7. Test Connection

In your AI assistant, try:
```
Check REAPER connection
```

Expected response:
```
REAPER file bridge is connected and responding
```

## Troubleshooting

### "REAPER file bridge is not available"

1. Check if Lua script is running in REAPER (View → Console)
2. Verify `/tmp/reaper-mcp` directory exists and is writable
3. Try restarting the Lua script in REAPER

### "AI Analyzer not initialized"

1. Check `.env` file has correct `OPENAI_API_KEY`
2. Ensure you've run `npm run build`
3. Verify API key is valid at https://platform.openai.com

### FFmpeg errors

1. Verify FFmpeg is installed: `ffmpeg -version`
2. Check FFmpeg is in PATH
3. Try reinstalling FFmpeg

### Build errors

```bash
# Clean and rebuild
rm -rf build
npm run build
```

## Usage Examples

### Basic Control
```
"Get project info"
"Create track named 'Guitar'"
"Set track 0 volume to -6 dB"
```

### FX Management
```
"Add Pro-Q 3 to track 1"
"Get FX parameters for track 0, FX 0"
"Set FX 0 param 2 to 0.5 on track 1"
```

### AI Analysis
```
"Analyze track 0 and suggest EQ"
"Check master mix loudness"
"Analyze the chorus from 30s to 45s"
```

## File Structure

```
reaper-mcp-ai-analyzing/
├── src/
│   ├── index.ts              # MCP Server entry
│   ├── types/
│   │   └── reaper.ts         # TypeScript types
│   ├── utils/
│   │   ├── env.ts            # Environment config
│   │   ├── logger.ts         # Logger
│   │   └── audio.ts          # Audio utilities
│   ├── bridge/
│   │   └── file-client.ts    # REAPER communication
│   └── ai/
│       ├── analyzer.ts       # AI analysis coordinator
│       └── providers/
│           ├── base.ts       # Base provider
│           └── openai.ts     # OpenAI implementation
├── bridge/
│   └── file-bridge.lua       # REAPER Lua script
├── demo/
│   └── example-prompts.md    # Example prompts
├── build/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Next Steps

1. Read `demo/example-prompts.md` for usage examples
2. Explore available tools in the README
3. Try analyzing your first track!

## Support

For issues and feature requests, please use GitHub Issues.