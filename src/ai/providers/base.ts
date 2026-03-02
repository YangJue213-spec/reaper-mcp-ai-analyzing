// Base AI Provider Interface

import { AIProviderConfig, AIAnalysisResult, LoudnessData } from '../../types/reaper.js';

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  abstract analyzeAudio(
    audioBase64: string,
    loudnessData: LoudnessData,
    context?: string
  ): Promise<AIAnalysisResult>;

  protected createAnalysisPrompt(loudnessData: LoudnessData, context?: string): string {
    const basePrompt = `You are an expert audio mixing engineer analyzing an audio file.

LOUDNESS ANALYSIS:
- Integrated LUFS: ${loudnessData.integratedLufs.toFixed(2)} LUFS
- True Peak: ${loudnessData.truePeak.toFixed(2)} dB
- Loudness Range: ${loudnessData.loudnessRange.toFixed(2)} LU
- Threshold: ${loudnessData.threshold.toFixed(2)} dB

TARGET SPECIFICATIONS:
- Target loudness: -14 LUFS (streaming standard) or -23 LUFS (broadcast)
- True peak should be below -1 dBTP
- Dynamic range should be appropriate for the genre

Please analyze this audio and provide:
1. Overall assessment of the mix quality
2. Specific issues with EQ, compression, loudness, stereo width
3. Actionable recommendations with specific parameter suggestions
4. Prioritized list of fixes`;

    if (context) {
      return `${basePrompt}\n\nADDITIONAL CONTEXT: ${context}`;
    }
    return basePrompt;
  }
}