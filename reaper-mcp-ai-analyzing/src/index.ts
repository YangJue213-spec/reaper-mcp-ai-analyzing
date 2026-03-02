#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { spawn } from 'child_process';

import { ReaperFileClient } from './reaper/file-client.js';

// ===== Audio Loudness Analysis using FFmpeg =====
interface LoudnessData {
  integratedLufs: number;
  truePeak: number;
  loudnessRange: number;
  threshold: number;
}

/**
 * Analyze audio file loudness using FFmpeg's loudnorm filter
 * This provides accurate LUFS-I, True Peak, and Loudness Range measurements
 */
async function analyzeLoudness(audioFilePath: string): Promise<LoudnessData> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', audioFilePath,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null',
      '-'
    ];
    
    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      // FFmpeg outputs loudnorm stats to stderr
      try {
        // Extract JSON from stderr
        const jsonMatch = stderr.match(/\{\s*"input_i"[^}]+\}/s);
        if (jsonMatch) {
          const stats = JSON.parse(jsonMatch[0]);
          
          // Parse values - convert from string to number
          const integratedLufs = parseFloat(stats.input_i) || -23.0;
          const truePeak = parseFloat(stats.input_tp) || -1.0;
          const loudnessRange = parseFloat(stats.input_lra) || 0.0;
          const threshold = parseFloat(stats.input_thresh) || -30.0;
          
          resolve({
            integratedLufs,
            truePeak,
            loudnessRange,
            threshold
          });
        } else {
          // Fallback: try to parse individual values
          const iMatch = stderr.match(/input_i:\s*([-\d.]+)/);
          const tpMatch = stderr.match(/input_tp:\s*([-\d.]+)/);
          const lraMatch = stderr.match(/input_lra:\s*([-\d.]+)/);
          
          if (iMatch) {
            resolve({
              integratedLufs: parseFloat(iMatch[1]),
              truePeak: tpMatch ? parseFloat(tpMatch[1]) : -1.0,
              loudnessRange: lraMatch ? parseFloat(lraMatch[1]) : 0.0,
              threshold: -30.0
            });
          } else {
            // If parsing fails, return default values
            console.error('[analyzeLoudness] Failed to parse FFmpeg output, using defaults');
            resolve({
              integratedLufs: -23.0,
              truePeak: -1.0,
              loudnessRange: 0.0,
              threshold: -30.0
            });
          }
        }
      } catch (error) {
        console.error('[analyzeLoudness] Error parsing FFmpeg output:', error);
        reject(error);
      }
    });
    
    ffmpeg.on('error', (error) => {
      console.error('[analyzeLoudness] FFmpeg spawn error:', error);
      reject(error);
    });
  });
}

// Load environment variables
config();

// ===== Task Manager for Async Operations =====
interface AnalysisTask {
  taskId: string;
  status: 'pending' | 'rendering' | 'analyzing' | 'completed' | 'failed';
  progress: number;
  params: any;
  renderStatusFile?: string;
  audioFilePath?: string;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

class TaskManager {
  private tasks: Map<string, AnalysisTask> = new Map();
  private tasksDir: string = '/tmp/reaper-mcp/tasks';

  constructor() {
    this.ensureTasksDir();
  }

  private async ensureTasksDir() {
    try {
      await fs.mkdir(this.tasksDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create tasks directory:', e);
    }
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
      console.error('Failed to save task:', e);
    }
  }

  async cleanupOldTasks(maxAgeMs: number = 3600000) { // 1 hour
    const now = Date.now();
    for (const [taskId, task] of this.tasks.entries()) {
      if (now - task.createdAt > maxAgeMs) {
        this.tasks.delete(taskId);
        try {
          const taskFile = join(this.tasksDir, `${taskId}.json`);
          await fs.unlink(taskFile).catch(() => {});
          // Cleanup audio file if exists
          if (task.audioFilePath) {
            await fs.unlink(task.audioFilePath).catch(() => {});
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }
}

class ReaperMCPServer {
  private server: Server;
  private client: ReaperFileClient;
  private taskManager: TaskManager;
  private openai: OpenAI;

  constructor() {
    // Initialize File-based IPC client (compatible with Mac M4)
    this.client = new ReaperFileClient({
      scriptTimeout: parseInt(process.env.REAPER_SCRIPT_TIMEOUT || '10000'),
    });

    this.taskManager = new TaskManager();

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });

    this.server = new Server({
      name: 'reaper-mcp-server',
      version: '1.0.0',
    });

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error: any) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.client.disconnect();
      await this.server.close();
      process.exit(0);
    });

    // Periodic cleanup of old tasks
    setInterval(() => this.taskManager.cleanupOldTasks(), 600000); // Every 10 minutes
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_project_info',
          description: 'Get current project information (sample rate, tempo, tracks, etc.)',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'get_track_info',
          description: 'Get information about a track',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' } },
            required: ['trackIndex'],
          },
        },
        {
          name: 'create_track',
          description: 'Create a new track with optional name',
          inputSchema: {
            type: 'object',
            properties: { 
              trackName: { type: 'string', description: 'Optional name for the new track' } 
            },
          },
        },
        {
          name: 'delete_track',
          description: 'Delete a track by index',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number', description: 'Track index to delete (0-based)' } 
            },
            required: ['trackIndex'],
          },
        },
        {
          name: 'set_track_name',
          description: 'Set the name of a track',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number', description: 'Track index (0-based)' },
              trackName: { type: 'string', description: 'New name for the track' }
            },
            required: ['trackIndex', 'trackName'],
          },
        },
        {
          name: 'set_track_volume',
          description: 'Set track volume in dB',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' }, volumeDb: { type: 'number' } },
            required: ['trackIndex', 'volumeDb'],
          },
        },
        {
          name: 'set_track_pan',
          description: 'Set track pan (-1 to 1)',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number' }, 
              pan: { type: 'number', minimum: -1, maximum: 1 } 
            },
            required: ['trackIndex', 'pan'],
          },
        },
        {
          name: 'set_track_send',
          description: 'Create a send from source track to destination track (parallel routing)',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndex: { type: 'number', description: 'Source track index' }, 
              destTrackIndex: { type: 'number', description: 'Destination track index' },
              volumeDb: { type: 'number', description: 'Send volume in dB (default: 0)' }
            },
            required: ['sourceTrackIndex', 'destTrackIndex'],
          },
        },
        {
          name: 'set_track_output',
          description: 'Set track output destination (changes main output routing)',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndex: { type: 'number', description: 'Source track index' }, 
              destTrackIndex: { type: 'number', description: 'Destination track index (-1 for master)' }
            },
            required: ['sourceTrackIndex', 'destTrackIndex'],
          },
        },
        {
          name: 'batch_set_track_send',
          description: 'Create sends from multiple source tracks to destination track',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndices: { 
                type: 'array', 
                items: { type: 'number' },
                description: 'Array of source track indices' 
              }, 
              destTrackIndex: { type: 'number', description: 'Destination track index' },
              volumeDb: { type: 'number', description: 'Send volume in dB (default: 0)' }
            },
            required: ['sourceTrackIndices', 'destTrackIndex'],
          },
        },
        {
          name: 'batch_set_track_output',
          description: 'Set output destination for multiple source tracks',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndices: { 
                type: 'array', 
                items: { type: 'number' },
                description: 'Array of source track indices' 
              }, 
              destTrackIndex: { type: 'number', description: 'Destination track index (-1 for master)' }
            },
            required: ['sourceTrackIndices', 'destTrackIndex'],
          },
        },
        {
          name: 'list_available_fx',
          description: 'Get list of all available FX plugins (Legacy - uses Lua, may timeout)',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'get_available_plugins',
          description: 'Get available plugins from REAPER cache files with optional search. Parses local plugin cache files directly for accurate names. Use this before add_fx_to_track to get exact plugin names.',
          inputSchema: {
            type: 'object',
            properties: {
              searchQuery: {
                type: 'string',
                description: 'Optional search keyword for fuzzy matching (e.g., "CLA-2A", "Pro-Q", "compressor")'
              },
              maxResults: {
                type: 'number',
                default: 10,
                description: 'Maximum number of results to return (default: 10, max: 50)'
              }
            },
          },
        },
        {
          name: 'get_track_fx',
          description: 'Get all FX on a track',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' } },
            required: ['trackIndex'],
          },
        },
        {
          name: 'add_fx_to_track',
          description: 'Add an FX plugin to a track with automatic Mono/Stereo detection. Supports Waves, FabFilter, and generic plugins.',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number', description: 'Track index to add FX to' }, 
              fxName: { type: 'string', description: 'Base FX name (e.g., "Pro-Q 3", "API-550", "ReaEQ"). Mono/Stereo suffix will be auto-added based on track configuration.' },
              vendor: { 
                type: 'string', 
                enum: ['waves', 'fabfilter', 'generic'],
                description: 'Plugin vendor type for proper naming convention. Default: generic'
              }
            },
            required: ['trackIndex', 'fxName'],
          },
        },
        {
          name: 'remove_fx_from_track',
          description: 'Remove an FX from a track',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number' }, 
              fxIndex: { type: 'number', description: 'Index of the FX to remove' } 
            },
            required: ['trackIndex', 'fxIndex'],
          },
        },
        {
          name: 'get_fx_params',
          description: 'Get all parameters of an FX',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number' }, 
              fxIndex: { type: 'number' } 
            },
            required: ['trackIndex', 'fxIndex'],
          },
        },
        {
          name: 'set_fx_param',
          description: 'Set FX parameter using absolute value',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number' },
              fxIndex: { type: 'number' },
              paramIndex: { type: 'number' },
              value: { type: 'number', description: 'Absolute parameter value' },
            },
            required: ['trackIndex', 'fxIndex', 'paramIndex', 'value'],
          },
        },
        {
          name: 'set_fx_param_normalized',
          description: 'Set FX parameter using normalized value (0-1)',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number' },
              fxIndex: { type: 'number' },
              paramIndex: { type: 'number' },
              normalizedValue: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['trackIndex', 'fxIndex', 'paramIndex', 'normalizedValue'],
          },
        },
        {
          name: 'tweak_fx_parameter',
          description: 'Tweak FX parameter by effect name (supports Waves, FabFilter, etc.). Finds FX by name and sets parameter using normalized value.',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number', description: 'Track index containing the FX' },
              fxName: { type: 'string', description: 'FX plugin name to search for (e.g., "VST: Pro-Q 3", "VST3: Waves API-550")' },
              paramIndex: { type: 'number', description: 'Parameter index to adjust' },
              normalizedValue: { type: 'number', minimum: 0, maximum: 1, description: 'Normalized value (0.0 to 1.0)' },
            },
            required: ['trackIndex', 'fxName', 'paramIndex', 'normalizedValue'],
          },
        },
        {
          name: 'manage_track_routing',
          description: 'Manage track routing and sends with precise control. Supports add_send, remove_send, and set_master_send actions.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { 
                type: 'string', 
                enum: ['add_send', 'remove_send', 'set_master_send'],
                description: 'Routing action to perform'
              },
              sourceTrackIndex: { type: 'number', description: 'Source track index' },
              destTrackIndex: { type: 'number', description: 'Destination track index (-1 for master). Required for add_send and remove_send.' },
              enable: { type: 'boolean', description: 'Enable/disable master send (for set_master_send action)' },
              sendVolumeDb: { type: 'number', default: 0, description: 'Send volume in dB (for add_send, default: 0)' },
              sendPan: { type: 'number', minimum: -1, maximum: 1, default: 0, description: 'Send pan -1 (left) to 1 (right) (for add_send)' },
            },
            required: ['action', 'sourceTrackIndex'],
          },
        },
        {
          name: 'set_fx_enabled',
          description: 'Enable or disable an FX',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number' },
              fxIndex: { type: 'number' },
              enabled: { type: 'boolean' },
            },
            required: ['trackIndex', 'fxIndex', 'enabled'],
          },
        },
        {
          name: 'split_item',
          description: 'Split a media item at a specific position',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number', description: 'Track index containing the item' },
              itemIndex: { type: 'number', description: 'Item index to split' },
              position: { type: 'number', description: 'Position in seconds where to split' },
            },
            required: ['trackIndex', 'itemIndex', 'position'],
          },
        },
        {
          name: 'get_item_info',
          description: 'Get information about a media item',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number' },
              itemIndex: { type: 'number' },
            },
            required: ['trackIndex', 'itemIndex'],
          },
        },
        {
          name: 'analyze_media_item',
          description: 'Analyze audio properties of a media item (peak, sample rate, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              trackIndex: { type: 'number' },
              itemIndex: { type: 'number' },
            },
            required: ['trackIndex', 'itemIndex'],
          },
        },
        {
          name: 'check_reaper_connection',
          description: 'Check if REAPER file bridge is active',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'analyze_and_suggest_mix',
          description: 'Analyze audio using AI and suggest mix improvements. Supports multiple render modes: solo (single track), master (full mix), chorus (time range), multi (multiple tracks together). Gets SWS loudness data and sends to AI for analysis.',
          inputSchema: {
            type: 'object',
            properties: {
              trackId: { 
                type: 'string', 
                description: 'Track ID to analyze (number as string, or "master" for master track). Used in solo mode.' 
              },
              trackIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of track IDs for multi-track analysis (used in "multi" renderMode)'
              },
              renderMode: {
                type: 'string',
                enum: ['solo', 'master', 'chorus', 'multi'],
                description: 'Render mode: solo=isolate single track, master=full mix, chorus=time range of master, multi=multiple tracks together'
              },
              startTime: { 
                type: 'number', 
                description: 'Start time in seconds (default: 0)' 
              },
              endTime: { 
                type: 'number', 
                description: 'End time in seconds (default: project length)' 
              },
            },
            required: ['renderMode'],
          },
        },
        {
          name: 'start_audio_analysis',
          description: 'Start an asynchronous audio analysis task. This tool triggers the rendering and AI analysis in the background and returns immediately with a task ID. Use get_analysis_status to check progress and results.',
          inputSchema: {
            type: 'object',
            properties: {
              trackId: { 
                type: 'string', 
                description: 'Track ID to analyze (number as string, or "master" for master track). Used in solo mode.' 
              },
              trackIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of track IDs for multi-track analysis (used in "multi" renderMode)'
              },
              renderMode: {
                type: 'string',
                enum: ['solo', 'master', 'chorus', 'multi'],
                description: 'Render mode: solo=isolate single track, master=full mix, chorus=time range of master, multi=multiple tracks together'
              },
              startTime: { 
                type: 'number', 
                description: 'Start time in seconds (default: 0)' 
              },
              endTime: { 
                type: 'number', 
                description: 'End time in seconds (default: project length, max 30 seconds for optimal analysis)' 
              },
            },
            required: ['renderMode'],
          },
        },
        {
          name: 'get_analysis_status',
          description: 'Get the status and results of an asynchronous audio analysis task started with start_audio_analysis.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'The task ID returned by start_audio_analysis'
              }
            },
            required: ['taskId'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Initialize client if needed
        await this.client.connect();

        switch (name) {
          case 'get_project_info': {
            const data = await this.client.getProjectInfo();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get_track_info': {
            const { trackIndex } = args as { trackIndex: number };
            const data = await this.client.getTrackInfo(trackIndex);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create_track': {
            const { trackName } = args as { trackName?: string };
            const result = await this.client.createTrack(trackName);
            return { content: [{ type: 'text', text: `Created track ${result.trackNumber}: ${result.name || 'Unnamed'}` }] };
          }

          case 'delete_track': {
            const { trackIndex } = args as { trackIndex: number };
            const result = await this.client.deleteTrack(trackIndex);
            return { content: [{ type: 'text', text: `Deleted track at index ${result.deletedTrackIndex}` }] };
          }

          case 'set_track_name': {
            const { trackIndex, trackName } = args as { trackIndex: number; trackName: string };
            const result = await this.client.setTrackName(trackIndex, trackName);
            return { content: [{ type: 'text', text: `Set track ${result.trackIndex} name to "${result.name}"` }] };
          }

          case 'set_track_volume': {
            const { trackIndex, volumeDb } = args as { trackIndex: number; volumeDb: number };
            await this.client.setTrackVolume(trackIndex, volumeDb);
            return { content: [{ type: 'text', text: `Set track ${trackIndex} volume to ${volumeDb} dB` }] };
          }

          case 'set_track_pan': {
            const { trackIndex, pan } = args as { trackIndex: number; pan: number };
            await this.client.setTrackPan(trackIndex, pan);
            return { content: [{ type: 'text', text: `Set track ${trackIndex} pan to ${pan}` }] };
          }

          case 'set_track_send': {
            const { sourceTrackIndex, destTrackIndex, volumeDb } = args as { 
              sourceTrackIndex: number; 
              destTrackIndex: number;
              volumeDb?: number 
            };
            await this.client.setTrackSend(sourceTrackIndex, destTrackIndex, volumeDb ?? 0);
            return { content: [{ type: 'text', text: `Created send from track ${sourceTrackIndex} to track ${destTrackIndex} at ${volumeDb ?? 0} dB` }] };
          }

          case 'set_track_output': {
            const { sourceTrackIndex, destTrackIndex } = args as { 
              sourceTrackIndex: number; 
              destTrackIndex: number;
            };
            await this.client.setTrackOutput(sourceTrackIndex, destTrackIndex);
            const destText = destTrackIndex === -1 ? 'master' : `track ${destTrackIndex}`;
            return { content: [{ type: 'text', text: `Set track ${sourceTrackIndex} output to ${destText}` }] };
          }

          case 'batch_set_track_send': {
            const { sourceTrackIndices, destTrackIndex, volumeDb } = args as { 
              sourceTrackIndices: number[]; 
              destTrackIndex: number;
              volumeDb?: number;
            };
            const result = await this.client.batchSetTrackSend(sourceTrackIndices, destTrackIndex, volumeDb ?? 0);
            const successCount = result.results.filter((r: any) => r.success).length;
            return { content: [{ type: 'text', text: `Created sends from ${successCount}/${sourceTrackIndices.length} tracks to track ${destTrackIndex}` }] };
          }

          case 'batch_set_track_output': {
            const { sourceTrackIndices, destTrackIndex } = args as { 
              sourceTrackIndices: number[]; 
              destTrackIndex: number;
            };
            const result = await this.client.batchSetTrackOutput(sourceTrackIndices, destTrackIndex);
            const successCount = result.results.filter((r: any) => r.success).length;
            const destText = destTrackIndex === -1 ? 'master' : `track ${destTrackIndex}`;
            return { content: [{ type: 'text', text: `Set output for ${successCount}/${sourceTrackIndices.length} tracks to ${destText}` }] };
          }

          case 'list_available_fx': {
            const data = await this.client.listAvailableFX();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get_available_plugins': {
            const { searchQuery, maxResults } = args as { searchQuery?: string; maxResults?: number };
            const result = await this.client.getAvailablePlugins(searchQuery, maxResults);
            
            const header = searchQuery 
              ? `Found ${result.count} plugins matching "${searchQuery}" (source: ${result.source}):`
              : `Available plugins (source: ${result.source}):`;
            
            const pluginsList = result.plugins.map((plugin, i) => `${i + 1}. ${plugin}`).join('\n');
            
            return { 
              content: [{ 
                type: 'text', 
                text: `${header}\n${pluginsList}\n\nTip: Use the exact plugin name with add_fx_to_track or add_fx_to_track_smart.`
              }] 
            };
          }

          case 'get_track_fx': {
            const { trackIndex } = args as { trackIndex: number };
            const data = await this.client.getTrackFX(trackIndex);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'add_fx_to_track': {
            const { trackIndex, fxName, vendor } = args as { 
              trackIndex: number; 
              fxName: string;
              vendor?: 'waves' | 'fabfilter' | 'generic';
            };
            const result = await this.client.addFXToTrack(trackIndex, fxName, vendor);
            const channelInfo = result.isMono ? 'mono' : `${result.trackChannels} channels`;
            return { content: [{ type: 'text', text: `Added ${result.fxName} (${channelInfo}, vendor: ${result.vendor}) at index ${result.fxIndex}` }] };
          }

          case 'remove_fx_from_track': {
            const { trackIndex, fxIndex } = args as { trackIndex: number; fxIndex: number };
            await this.client.removeFXFromTrack(trackIndex, fxIndex);
            return { content: [{ type: 'text', text: `Removed FX at index ${fxIndex} from track ${trackIndex}` }] };
          }

          case 'get_fx_params': {
            const { trackIndex, fxIndex } = args as { trackIndex: number; fxIndex: number };
            const data = await this.client.getFXParams(trackIndex, fxIndex);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'set_fx_param': {
            const { trackIndex, fxIndex, paramIndex, value } = args as {
              trackIndex: number;
              fxIndex: number;
              paramIndex: number;
              value: number;
            };
            await this.client.setFXParam(trackIndex, fxIndex, paramIndex, value);
            return { content: [{ type: 'text', text: `Set param ${paramIndex} to ${value}` }] };
          }

          case 'set_fx_param_normalized': {
            const { trackIndex, fxIndex, paramIndex, normalizedValue } = args as {
              trackIndex: number;
              fxIndex: number;
              paramIndex: number;
              normalizedValue: number;
            };
            await this.client.setFXParamNormalized(trackIndex, fxIndex, paramIndex, normalizedValue);
            return { content: [{ type: 'text', text: `Set param ${paramIndex} to ${normalizedValue} (normalized)` }] };
          }

          case 'set_fx_enabled': {
            const { trackIndex, fxIndex, enabled } = args as {
              trackIndex: number;
              fxIndex: number;
              enabled: boolean;
            };
            await this.client.setFXEnabled(trackIndex, fxIndex, enabled);
            return { content: [{ type: 'text', text: `${enabled ? 'Enabled' : 'Disabled'} FX at index ${fxIndex}` }] };
          }

          case 'tweak_fx_parameter': {
            const { trackIndex, fxName, paramIndex, normalizedValue } = args as {
              trackIndex: number;
              fxName: string;
              paramIndex: number;
              normalizedValue: number;
            };
            const result = await this.client.tweakFXParameter(trackIndex, fxName, paramIndex, normalizedValue);
            return { content: [{ type: 'text', text: `Tweaked "${result.fxName}" param ${result.paramName} (${result.paramIndex}) to ${normalizedValue}` }] };
          }

          case 'manage_track_routing': {
            const { action, sourceTrackIndex, destTrackIndex, enable, sendVolumeDb, sendPan } = args as {
              action: 'add_send' | 'remove_send' | 'set_master_send';
              sourceTrackIndex: number;
              destTrackIndex?: number;
              enable?: boolean;
              sendVolumeDb?: number;
              sendPan?: number;
            };
            const result = await this.client.manageTrackRouting(action, sourceTrackIndex, destTrackIndex, enable, sendVolumeDb, sendPan);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'split_item': {
            const { trackIndex, itemIndex, position } = args as {
              trackIndex: number;
              itemIndex: number;
              position: number;
            };
            const result = await this.client.splitItem(trackIndex, itemIndex, position);
            return { content: [{ type: 'text', text: `Split item at ${position}s, new item index: ${result.newItemIndex}` }] };
          }

          case 'get_item_info': {
            const { trackIndex, itemIndex } = args as { trackIndex: number; itemIndex: number };
            const data = await this.client.getItemInfo(trackIndex, itemIndex);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'analyze_media_item': {
            const { trackIndex, itemIndex } = args as { trackIndex: number; itemIndex: number };
            const data = await this.client.analyzeMediaItem(trackIndex, itemIndex);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'check_reaper_connection': {
            try {
              await this.client.connect();
              await this.client.getProjectInfo();
              return { content: [{ type: 'text', text: 'REAPER file bridge is connected and responding' }] };
            } catch (error) {
              return { 
                content: [{ 
                  type: 'text', 
                  text: 'REAPER file bridge is not available. Please ensure:\n1. The file-bridge.lua script is loaded in REAPER\n2. The script is running (check REAPER console)\n3. IPC directory is accessible' 
                }] 
              };
            }
          }

          case 'analyze_and_suggest_mix': {
            return this.handleAnalyzeAndSuggestMix(args as any);
          }

          case 'start_audio_analysis': {
            return this.handleStartAudioAnalysis(args as any);
          }

          case 'get_analysis_status': {
            return this.handleGetAnalysisStatus(args as any);
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  // ===== ASYNC AUDIO ANALYSIS IMPLEMENTATION =====

  private async handleStartAudioAnalysis(args: any) {
    const { 
      trackId, 
      trackIds, 
      renderMode = 'solo',
      startTime = 0, 
      endTime 
    } = args;

    // Validate parameters
    if (renderMode === 'solo' && !trackId) {
      return { 
        content: [{ type: 'text', text: 'Error: trackId is required for solo render mode' }],
        isError: true
      };
    }
    if (renderMode === 'multi' && (!trackIds || trackIds.length === 0)) {
      return { 
        content: [{ type: 'text', text: 'Error: trackIds array is required for multi render mode' }],
        isError: true
      };
    }

    // Create task
    const task = this.taskManager.createTask({
      trackId, trackIds, renderMode, startTime, endTime
    });

    // Start async process (don't await)
    this.runAnalysisTask(task.taskId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId: task.taskId,
          status: 'pending',
          message: 'Audio analysis started. Use get_analysis_status to check progress.',
          estimatedTime: '30-60 seconds'
        }, null, 2)
      }]
    };
  }

  private async runAnalysisTask(taskId: string) {
    try {
      const task = this.taskManager.getTask(taskId);
      if (!task) return;

      const { trackId, trackIds, renderMode, startTime, endTime } = task.params;

      // Step 1: Get project info
      this.taskManager.updateTask(taskId, { status: 'rendering', progress: 10 });
      
      const projectInfo = await this.client.getProjectInfo();
      // Support longer audio analysis (up to 30 seconds) thanks to async architecture
      const actualEndTime = Math.min(endTime ?? projectInfo.projectLength, startTime + 30);

      // Step 2: Start render
      this.taskManager.updateTask(taskId, { progress: 20 });
      
      const effectiveTrackId = trackId || '0';
      const renderResult = await this.client.isolateAndRender(
        effectiveTrackId,
        startTime,
        actualEndTime,
        renderMode,
        trackIds
      );

      const statusFilePath = (renderResult as any).statusFile;
      const audioFilePath = (renderResult as any).filePath;

      this.taskManager.updateTask(taskId, { 
        renderStatusFile: statusFilePath,
        audioFilePath: audioFilePath,
        progress: 30 
      });

      // Step 3: Poll for render completion
      let renderCompleted = false;
      let attempts = 0;
      const maxAttempts = 60;

      while (!renderCompleted && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;

        try {
          const statusData = await fs.readFile(statusFilePath, 'utf-8');
          const status = JSON.parse(statusData);

          if (status.status === 'completed') {
            renderCompleted = true;
            this.taskManager.updateTask(taskId, { 
              audioFilePath: status.filePath,
              progress: 50 
            });
          } else if (status.status === 'failed') {
            throw new Error(`Render failed: ${status.error}`);
          }
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
            // Ignore file not found, retry
          }
        }
      }

      if (!renderCompleted) {
        throw new Error('Render timeout');
      }

      // Step 4: Analyze loudness using FFmpeg (replaces get_sws_loudness)
      this.taskManager.updateTask(taskId, { status: 'analyzing', progress: 60 });
      
      let loudnessData: LoudnessData;
      try {
        loudnessData = await analyzeLoudness(audioFilePath!);
        console.error(`[runAnalysisTask] Loudness analyzed: LUFS-I=${loudnessData.integratedLufs.toFixed(1)}, TruePeak=${loudnessData.truePeak.toFixed(1)} dBTP`);
      } catch (loudnessError) {
        console.error('[runAnalysisTask] Failed to analyze loudness, using defaults:', loudnessError);
        loudnessData = {
          integratedLufs: -23.0,
          truePeak: -1.0,
          loudnessRange: 0.0,
          threshold: -30.0
        };
      }

      // Step 5: AI Analysis
      this.taskManager.updateTask(taskId, { progress: 70 });
      
      const audioBuffer = await fs.readFile(audioFilePath!);
      const base64Audio = audioBuffer.toString('base64');

      const userPrompt = `你是一位专业的母带与混音工程师。请聆听这段音频，结合响度数据（当前 LUFS-I: ${loudnessData.integratedLufs.toFixed(1)}, True Peak: ${loudnessData.truePeak.toFixed(1)} dBTP, 响度范围: ${loudnessData.loudnessRange.toFixed(1)} LU），分析其频段均衡度、掩蔽效应和动态。请仅返回一段严格的 JSON 格式数据，包含 'analysis' (诊断说明) 和 'actions' (针对效果器的调整指令数组)。`;

      let aiResponse: string;
      try {
        const response = await this.openai.chat.completions.create({
          model: process.env.AUDIO_MODEL_NAME || 'gemini-3.1-pro-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'input_audio', input_audio: { data: base64Audio, format: 'wav' } }
              ]
            }
          ],
          max_tokens: 2000,
        });
        aiResponse = response.choices[0]?.message?.content || '';
      } catch (audioError: any) {
        const dataUri = `data:audio/wav;base64,${base64Audio}`;
        const response = await this.openai.chat.completions.create({
          model: process.env.AUDIO_MODEL_NAME || 'gemini-3.1-pro-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'text', text: dataUri }
              ]
            }
          ],
          max_tokens: 2000,
        });
        aiResponse = response.choices[0]?.message?.content || '';
      }

      // Step 6: Parse result
      this.taskManager.updateTask(taskId, { progress: 90 });
      
      let analysisResult: any;
      try {
        const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : aiResponse.trim();
        analysisResult = JSON.parse(jsonStr);
      } catch (e) {
        analysisResult = {
          analysis: 'Failed to parse AI response',
          actions: [],
          rawResponse: aiResponse
        };
      }

      // Cleanup
      await fs.unlink(audioFilePath!).catch(() => {});
      await fs.unlink(statusFilePath).catch(() => {});

      // Complete
      this.taskManager.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        result: analysisResult
      });

    } catch (error: any) {
      this.taskManager.updateTask(taskId, {
        status: 'failed',
        error: error.message
      });
    }
  }

  private async handleGetAnalysisStatus(args: { taskId: string }) {
    const { taskId } = args;
    const task = this.taskManager.getTask(taskId);

    if (!task) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found' }, null, 2) }],
        isError: true
      };
    }

    const response: any = {
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };

    if (task.status === 'completed') {
      response.result = task.result;
    } else if (task.status === 'failed') {
      response.error = task.error;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
  }

  // ===== SYNC VERSION (for backward compatibility) =====

  private async handleAnalyzeAndSuggestMix(args: any) {
    const { 
      trackId, 
      trackIds, 
      renderMode = 'solo',
      startTime = 0, 
      endTime 
    } = args;

    if (renderMode === 'solo' && !trackId) {
      return { 
        content: [{ type: 'text', text: 'Error: trackId is required for solo render mode' }],
        isError: true
      };
    }
    if (renderMode === 'multi' && (!trackIds || trackIds.length === 0)) {
      return { 
        content: [{ type: 'text', text: 'Error: trackIds array is required for multi render mode' }],
        isError: true
      };
    }

    const projectInfo = await this.client.getProjectInfo();
    // Support longer audio analysis (up to 30 seconds) thanks to async architecture
    const actualEndTime = Math.min(endTime ?? projectInfo.projectLength, startTime + 30);

    const effectiveTrackId = trackId || '0';
    const renderResult = await this.client.isolateAndRender(
      effectiveTrackId, 
      startTime, 
      actualEndTime,
      renderMode,
      trackIds
    );
    
    const statusFilePath = (renderResult as any).statusFile;
    if (!statusFilePath) {
      throw new Error('No status file returned from isolate_and_render');
    }

    console.error(`[analyze_and_suggest_mix] Waiting for render to complete. Status file: ${statusFilePath}`);
    
    let renderCompleted = false;
    let renderFilePath = '';
    const maxPollAttempts = 60;
    let pollAttempts = 0;
    
    while (!renderCompleted && pollAttempts < maxPollAttempts) {
      try {
        const statusData = await fs.readFile(statusFilePath, 'utf-8');
        const status = JSON.parse(statusData);
        
        console.error(`[analyze_and_suggest_mix] Poll ${pollAttempts + 1}: status = ${status.status}`);
        
        if (status.status === 'completed') {
          renderCompleted = true;
          renderFilePath = status.filePath || (renderResult as any).filePath;
          console.error(`[analyze_and_suggest_mix] Render completed! File: ${renderFilePath}, Size: ${status.fileSize} bytes`);
        } else if (status.status === 'failed') {
          throw new Error(`Render failed: ${status.error || 'Unknown error'}`);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
          pollAttempts++;
        }
      } catch (error: any) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          pollAttempts++;
        } else {
          throw error;
        }
      }
    }
    
    if (!renderCompleted) {
      throw new Error('Render timeout after 60 seconds');
    }

    // Analyze loudness using FFmpeg (replaces get_sws_loudness)
    let loudnessData: LoudnessData;
    try {
      loudnessData = await analyzeLoudness(renderFilePath);
      console.error(`[analyze_and_suggest_mix] Loudness analyzed: LUFS-I=${loudnessData.integratedLufs.toFixed(1)}, TruePeak=${loudnessData.truePeak.toFixed(1)} dBTP`);
    } catch (loudnessError) {
      console.error('[analyze_and_suggest_mix] Failed to analyze loudness, using defaults:', loudnessError);
      loudnessData = {
        integratedLufs: -23.0,
        truePeak: -1.0,
        loudnessRange: 0.0,
        threshold: -30.0
      };
    }
    
    console.error(`[analyze_and_suggest_mix] Reading audio file: ${renderFilePath}`);
    const audioBuffer = await fs.readFile(renderFilePath);
    const base64Audio = audioBuffer.toString('base64');
    console.error(`[analyze_and_suggest_mix] Audio file size: ${audioBuffer.length} bytes, Base64 length: ${base64Audio.length}`);
    
    const userPrompt = `你是一位专业的母带与混音工程师。请聆听这段音频，结合响度数据（当前 LUFS-I: ${loudnessData.integratedLufs.toFixed(1)}, True Peak: ${loudnessData.truePeak.toFixed(1)} dBTP, 响度范围: ${loudnessData.loudnessRange.toFixed(1)} LU），分析其频段均衡度、掩蔽效应和动态。请仅返回一段严格的 JSON 格式数据，包含 'analysis' (诊断说明) 和 'actions' (针对效果器的调整指令数组)。`;

    let aiResponse: string;
    try {
      console.error(`[analyze_and_suggest_mix] Sending to AI with input_audio format...`);
      const response = await this.openai.chat.completions.create({
        model: process.env.AUDIO_MODEL_NAME || 'gemini-3.1-pro-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'input_audio', input_audio: { data: base64Audio, format: 'wav' } }
            ]
          }
        ],
        max_tokens: 2000,
      });
      aiResponse = response.choices[0]?.message?.content || 'No response from AI';
      console.error(`[analyze_and_suggest_mix] AI response received (input_audio format)`);
    } catch (audioError: any) {
      console.error(`[analyze_and_suggest_mix] input_audio format failed, trying data URI format: ${audioError.message}`);
      const dataUri = `data:audio/wav;base64,${base64Audio}`;
      const response = await this.openai.chat.completions.create({
        model: process.env.AUDIO_MODEL_NAME || 'gemini-3.1-pro-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'text', text: dataUri }
            ]
          }
        ],
        max_tokens: 2000,
      });
      aiResponse = response.choices[0]?.message?.content || 'No response from AI';
      console.error(`[analyze_and_suggest_mix] AI response received (data URI format)`);
    }

    let analysisResult: any;
    try {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : aiResponse.trim();
      analysisResult = JSON.parse(jsonStr);
      console.error(`[analyze_and_suggest_mix] Successfully parsed AI response as JSON`);
    } catch (e) {
      console.error(`[analyze_and_suggest_mix] Failed to parse AI response as JSON: ${e}`);
      analysisResult = {
        analysis: 'Failed to parse AI response',
        actions: [],
        rawResponse: aiResponse,
        parseError: String(e)
      };
    }

    try {
      await fs.unlink(renderFilePath).catch(() => {});
      await fs.unlink(statusFilePath).catch(() => {});
      console.error(`[analyze_and_suggest_mix] Cleaned up temporary files`);
    } catch (cleanupError) {
      console.error('[analyze_and_suggest_mix] Failed to cleanup temporary file:', cleanupError);
    }

    return { 
      content: [{ 
        type: 'text', 
        text: JSON.stringify(analysisResult, null, 2)
      }] 
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('REAPER MCP server (file-based IPC) running on stdio');
  }
}

const server = new ReaperMCPServer();
server.run().catch(console.error);