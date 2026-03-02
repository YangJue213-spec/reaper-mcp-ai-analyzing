// Environment variable management

import { config } from 'dotenv';
import { AIProviderConfig } from '../types/reaper.js';

// Load .env file
config();

export class EnvConfig {
  static getOpenAIConfig(): AIProviderConfig {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.AUDIO_MODEL_NAME || 'gpt-4o-audio-preview';

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required. Please set it in your .env file.');
    }

    return {
      apiKey,
      baseUrl,
      model,
      maxAudioDuration: parseInt(process.env.MAX_AUDIO_DURATION || '30'),
    };
  }

  static getReaperTimeout(): number {
    return parseInt(process.env.REAPER_SCRIPT_TIMEOUT || '30000');
  }

  static getIpcDir(): string {
    return process.env.REAPER_IPC_DIR || '/tmp/reaper-mcp';
  }

  static getLogLevel(): string {
    return process.env.LOG_LEVEL || 'info';
  }

  static isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }
}