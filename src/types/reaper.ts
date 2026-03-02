// REAPER MCP AI Analyzing - Type Definitions

export interface ReaperConfig {
  scriptTimeout?: number;
  ipcDir?: string;
}

export interface ProjectInfo {
  sampleRate: number;
  tempo: number;
  timeSignatureNum: number;
  timeSignatureDen: number;
  trackCount: number;
  itemCount: number;
  projectLength: number;
}

export interface TrackInfo {
  trackNumber: number;
  name: string;
  volumeDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  fxCount: number;
  itemCount: number;
  trackChannels?: number;
  isMono?: boolean;
}

export interface FXInfo {
  fxIndex: number;
  name: string;
  enabled: boolean;
  paramCount?: number;
}

export interface FXParam {
  paramIndex: number;
  name: string;
  value: number;
  min: number;
  max: number;
  normalizedValue: number;
}

export interface MediaItemInfo {
  position: number;
  length: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  sourceFile?: string;
}

export interface AudioAnalysisResult {
  itemLength: number;
  sampleRate: number;
  numChannels: number;
  peakLevel: number;
  rmsLevel?: number;
  lufs?: number;
}

export interface LoudnessData {
  integratedLufs: number;
  truePeak: number;
  loudnessRange: number;
  threshold: number;
}

export interface RenderResult {
  filePath: string;
  renderMode: string;
  trackId?: string;
  trackIds?: string[];
  startTime: number;
  endTime: number;
  status: string;
  statusFile?: string;
}

export interface AnalysisTask {
  taskId: string;
  status: 'pending' | 'rendering' | 'analyzing' | 'completed' | 'failed';
  progress: number;
  params: any;
  renderStatusFile?: string;
  audioFilePath?: string;
  result?: AIAnalysisResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIAnalysisResult {
  suggestions: string;
  technicalDetails?: {
    eq?: string[];
    compression?: string[];
    loudness?: string;
    stereoWidth?: string;
    recommendations?: string[];
  };
  provider: string;
  model: string;
  timestamp: number;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxAudioDuration?: number;
}

export type RenderMode = 'solo' | 'master' | 'chorus' | 'multi';

export interface ReaperScriptResult {
  success: boolean;
  data?: any;
  error?: string;
  id?: string;
}