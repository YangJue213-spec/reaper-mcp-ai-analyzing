// Audio Analyzer Coordinator

import { OpenAIProvider } from './providers/openai.js';
import { AIAnalysisResult, LoudnessData, AnalysisTask } from '../types/reaper.js';
import { Logger } from '../utils/logger.js';
import { analyzeLoudness, audioToBase64 } from '../utils/audio.js';
import { promises as fs } from 'fs';
import { join } from 'path';

export class AudioAnalyzer {
  private provider: OpenAIProvider;
  private tasks: Map<string, AnalysisTask> = new Map();
  private tasksDir: string = '/tmp/reaper-mcp/tasks';

  constructor(provider: OpenAIProvider) {
    this.provider = provider;
    this.ensureTasksDir();
  }

  private async ensureTasksDir() {
    try {
      await fs.mkdir(this.tasksDir, { recursive: true });
    } catch (e) {
      Logger.error('Failed to create tasks directory:', e);
    }
  }

  async analyze(
    audioFilePath: string,
    context?: string
  ): Promise<AIAnalysisResult> {
    // Analyze loudness
    const loudnessData = await analyzeLoudness(audioFilePath);
    Logger.info(`Loudness: ${loudnessData.integratedLufs.toFixed(2)} LUFS`);

    // Convert to base64
    const audioBase64 = await audioToBase64(audioFilePath);

    // Get AI analysis
    const result = await this.provider.analyzeAudio(audioBase64, loudnessData, context);

    return result;
  }

  createTask(params: any): AnalysisTask {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: AnalysisTask = {
      taskId,
      status: 'pending',
      progress: 0,
      params,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.saveTask(task);
    return task;
  }

  getTask(taskId: string): AnalysisTask | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(taskId: string, updates: Partial<AnalysisTask>) {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates, { updatedAt: Date.now() });
      this.saveTask(task);
    }
  }

  private async saveTask(task: AnalysisTask) {
    try {
      const taskFile = join(this.tasksDir, `${task.taskId}.json`);
      await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
    } catch (e) {
      Logger.error('Failed to save task:', e);
    }
  }

  async cleanupOldTasks(maxAgeMs: number = 3600000) {
    const now = Date.now();
    for (const [taskId, task] of this.tasks.entries()) {
      if (now - task.createdAt > maxAgeMs) {
        this.tasks.delete(taskId);
        try {
          const taskFile = join(this.tasksDir, `${taskId}.json`);
          await fs.unlink(taskFile).catch(() => {});
          if (task.audioFilePath) {
            await fs.unlink(task.audioFilePath).catch(() => {});
          }
        } catch (e) {}
      }
    }
  }
}