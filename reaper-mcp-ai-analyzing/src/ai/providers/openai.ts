// OpenAI Provider Implementation

import OpenAI from 'openai';
import { BaseAIProvider } from './base.js';
import { AIAnalysisResult, LoudnessData } from '../../types/reaper.js';
import { Logger } from '../../utils/logger.js';

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor(config: { apiKey: string; baseUrl: string; model: string }) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async analyzeAudio(
    audioBase64: string,
    loudnessData: LoudnessData,
    context?: string
  ): Promise<AIAnalysisResult> {
    try {
      Logger.info('Analyzing audio with OpenAI...');
      
      const prompt = this.createAnalysisPrompt(loudnessData, context);
      
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert audio mixing and mastering engineer with years of experience.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format: 'wav'
                }
              }
            ]
          }
        ],
        max_tokens: 2000
      });

      const analysis = response.choices[0]?.message?.content || 'No analysis available';
      
      return {
        suggestions: analysis,
        provider: 'openai',
        model: this.config.model,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error('OpenAI analysis failed:', error);
      throw new Error(`OpenAI analysis failed: ${error}`);
    }
  }
}