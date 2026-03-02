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

import { ReaperFileClient } from './bridge/file-client.js';
import { AudioAnalyzer } from './ai/analyzer.js';
import { OpenAIProvider } from './ai/providers/openai.js';
import { EnvConfig } from './utils/env.js';
import { Logger } from './utils/logger.js';

class ReaperMCPServer {
  private server: Server;
  private client: ReaperFileClient;
  private analyzer: AudioAnalyzer | null = null;
  private tasks: Map<string, any> = new Map();

  constructor() {
    this.client = new ReaperFileClient({
      scriptTimeout: EnvConfig.getReaperTimeout(),
    });

    // Initialize AI analyzer if API key is available
    try {
      const aiConfig = EnvConfig.getOpenAIConfig();
      const provider = new OpenAIProvider(aiConfig);
      this.analyzer = new AudioAnalyzer(provider);
      Logger.info('AI Analyzer initialized');
    } catch (error) {
      Logger.warn('AI Analyzer not initialized - API key missing');
    }

    this.server = new Server({
      name: 'reaper-mcp-ai-analyzing',
      version: '1.0.0',
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error: any) => Logger.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.client.disconnect();
      await this.server.close();
      process.exit(0);
    });

    // Periodic cleanup
    setInterval(() => this.cleanupOldTasks(), 600000);
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
            properties: { trackName: { type: 'string' } },
          },
        },
        {
          name: 'delete_track',
          description: 'Delete a track by index',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' } },
            required: ['trackIndex'],
          },
        },
        {
          name: 'set_track_name',
          description: 'Set the name of a track',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number' },
              trackName: { type: 'string' }
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
            properties: { trackIndex: { type: 'number' }, pan: { type: 'number' } },
            required: ['trackIndex', 'pan'],
          },
        },
        {
          name: 'set_track_send',
          description: 'Create a send from source track to destination track',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndex: { type: 'number' }, 
              destTrackIndex: { type: 'number' },
              volumeDb: { type: 'number' }
            },
            required: ['sourceTrackIndex', 'destTrackIndex'],
          },
        },
        {
          name: 'set_track_output',
          description: 'Set track output destination (-1 for master)',
          inputSchema: {
            type: 'object',
            properties: { 
              sourceTrackIndex: { type: 'number' }, 
              destTrackIndex: { type: 'number' }
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
              sourceTrackIndices: { type: 'array', items: { type: 'number' } }, 
              destTrackIndex: { type: 'number' },
              volumeDb: { type: 'number' }
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
              sourceTrackIndices: { type: 'array', items: { type: 'number' } }, 
              destTrackIndex: { type: 'number' }
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
          description: 'Add an FX plugin to a track',
          inputSchema: {
            type: 'object',
            properties: { 
              trackIndex: { type: 'number' }, 
              fxName: { type: 'string' },
              vendor: { type: 'string', enum: ['waves', 'fabfilter', 'generic'] }
            },
            required: ['trackIndex', 'fxName'],
          },
        },
        {
          name: 'remove_fx_from_track',
          description: 'Remove an FX from a track',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' }, fxIndex: { type: 'number' } },
            required: ['trackIndex', 'fxIndex'],
          },
        },
        {
          name: 'get_fx_params',
          description: 'Get all parameters of an FX',
          inputSchema: {
            type: 'object',
            properties: { trackIndex: { type: 'number' }, fxIndex: { type: 'number' } },
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
              value: { type: 'number' },
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
              trackIndex: { type: 'number' },
              itemIndex: { type: 'number' },
              position: { type: 'number' },
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
          name: 'check_reaper_connection',
          description: 'Check if REAPER file bridge is active',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'analyze_and_suggest_mix',
          description: 'Analyze audio using AI and suggest mix improvements. Supports solo/master/chorus/multi modes.',
          inputSchema: {
            type: 'object',
            properties: {
              trackId: { type: 'string', description: 'Track ID (number as string, or "master")' },
              trackIds: { type: 'array', items: { type: 'string' }, description: 'Multiple track IDs for multi mode' },
              renderMode: { type: 'string', enum: ['solo', 'master', 'chorus', 'multi'] },
              startTime: { type: 'number', description: 'Start time in seconds' },
              endTime: { type: 'number', description: 'End time in seconds' },
              context: { type: 'string', description: 'Additional context for AI analysis' },
            },
            required: ['renderMode'],
          },
        },
        {
          name: 'start_audio_analysis',
          description: 'Start async audio analysis task',
          inputSchema: {
            type: 'object',
            properties: {
              trackId: { type: 'string' },
              trackIds: { type: 'array', items: { type: 'string' } },
              renderMode: { type: 'string', enum: ['solo', 'master', 'chorus', 'multi'] },
              startTime: { type: 'number' },
              endTime: { type: 'number' },
              context: { type: 'string' },
            },
            required: ['renderMode'],
          },
        },
        {
          name: 'get_analysis_status',
          description: 'Get status of async analysis task',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
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
            return { 
              content: [{ 
                type: 'text', 
                text: `Created track ${result.trackNumber} (trackIndex: ${result.trackIndex}): ${result.name || 'Unnamed'}\n\nTip: Use trackIndex=${result.trackIndex} for subsequent operations like add_fx_to_track.`
              }] 
            };
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
            return { content: [{ type: 'text', text: `Created send from track ${sourceTrackIndex} to track ${destTrackIndex}` }] };
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
            return { content: [{ type: 'text', text: `Available FX plugins (${data.length}):\n${data.slice(0, 50).join('\n')}` }] };
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
                text: `${header}\n${pluginsList}\n\nTip: Use the exact plugin name with add_fx_to_track.`
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
              vendor?: string;
            };
            const result = await this.client.addFXToTrack(trackIndex, fxName, vendor);
            return { content: [{ type: 'text', text: `Added ${result.fxName} at index ${result.fxIndex}` }] };
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

          case 'check_reaper_connection': {
            try {
              await this.client.getProjectInfo();
              return { content: [{ type: 'text', text: 'REAPER file bridge is connected and responding' }] };
            } catch (error) {
              return { 
                content: [{ 
                  type: 'text', 
                  text: 'REAPER file bridge is not available. Please ensure the Lua script is running in REAPER.' 
                }] 
              };
            }
          }

          case 'analyze_and_suggest_mix': {
            if (!this.analyzer) {
              return { content: [{ type: 'text', text: 'AI Analyzer not initialized. Please set OPENAI_API_KEY in .env' }] };
            }
            
            const { trackId, trackIds, renderMode, startTime = 0, endTime, context } = args as any;
            
            // Start render
            const renderResult = await this.client.isolateAndRender(
              trackId || '0',
              startTime,
              endTime || 30,
              renderMode as any,
              trackIds
            );
            
            // Wait for render to complete
            await this.waitForRender(renderResult.statusFile);
            
            // Analyze
            const analysis = await this.analyzer.analyze(renderResult.filePath, context);
            
            return { 
              content: [{ 
                type: 'text', 
                text: `## AI Mix Analysis\n\n${analysis.suggestions}\n\n*Analyzed using ${analysis.provider} ${analysis.model}*` 
              }] 
            };
          }

          case 'start_audio_analysis': {
            if (!this.analyzer) {
              return { content: [{ type: 'text', text: 'AI Analyzer not initialized' }] };
            }
            
            const task = this.analyzer.createTask(args);
            return { content: [{ type: 'text', text: `Analysis task started. Task ID: ${task.taskId}` }] };
          }

          case 'get_analysis_status': {
            const { taskId } = args as { taskId: string };
            const task = this.analyzer?.getTask(taskId);
            if (!task) {
              return { content: [{ type: 'text', text: `Task ${taskId} not found` }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
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

  private async waitForRender(statusFile: string | undefined): Promise<void> {
    if (!statusFile) return;
    
    for (let i = 0; i < 60; i++) {
      try {
        const data = await fs.readFile(statusFile, 'utf-8');
        const status = JSON.parse(data);
        if (status.status === 'completed') return;
        if (status.status === 'failed') throw new Error('Render failed');
      } catch (e) {
        // File might not exist yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Render timeout');
  }

  private async cleanupOldTasks() {
    await this.analyzer?.cleanupOldTasks();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    Logger.info('REAPER MCP AI Analyzing server running on stdio');
  }
}

const server = new ReaperMCPServer();
server.run().catch(console.error);