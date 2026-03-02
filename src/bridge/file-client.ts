// File-based IPC Client for REAPER MCP Server

import { promises as fs } from 'fs';
import { join } from 'path';
import { ReaperConfig, ProjectInfo, TrackInfo, FXInfo, FXParam, MediaItemInfo, RenderResult } from '../types/reaper.js';
import { Logger } from '../utils/logger.js';
import { ReaperPluginParser } from '../utils/plugin-parser.js';

/**
 * File-based IPC Client for REAPER MCP Server
 * Uses JSON files in temp directory for communication instead of TCP
 */
export class ReaperFileClient {
  private config: ReaperConfig;
  private ipcDir: string;
  private commandFile: string;
  private responseFile: string;
  private isProcessing: boolean = false;
  private pluginParser: ReaperPluginParser;

  constructor(config: ReaperConfig = {}) {
    this.config = {
      scriptTimeout: config.scriptTimeout || 30000,
      ipcDir: config.ipcDir || '/tmp/reaper-mcp',
      ...config,
    };
    
    this.ipcDir = this.config.ipcDir!;
    this.commandFile = join(this.ipcDir, 'command.json');
    this.responseFile = join(this.ipcDir, 'response.json');
    this.pluginParser = new ReaperPluginParser();
  }

  /**
   * Initialize IPC directory
   */
  async connect(): Promise<void> {
    try {
      await fs.mkdir(this.ipcDir, { recursive: true });
      await this.cleanup();
      Logger.info(`File Client: Using IPC directory ${this.ipcDir}`);
    } catch (error) {
      throw new Error(`Failed to initialize IPC: ${error}`);
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    await this.cleanup();
  }

  /**
   * Clean up IPC files
   */
  private async cleanup(): Promise<void> {
    try {
      await fs.unlink(this.commandFile).catch(() => {});
      await fs.unlink(this.responseFile).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Send command and wait for response via file IPC
   */
  private async sendCommand(action: string, params: any = {}): Promise<any> {
    if (this.isProcessing) {
      throw new Error('Another command is already in progress');
    }

    this.isProcessing = true;

    try {
      await this.cleanup();

      const command = {
        id: Date.now().toString(),
        action,
        params,
        timestamp: Date.now(),
      };

      await fs.writeFile(this.commandFile, JSON.stringify(command, null, 2), 'utf-8');

      const startTime = Date.now();
      const timeout = this.config.scriptTimeout || 30000;

      while (Date.now() - startTime < timeout) {
        try {
          await fs.access(this.responseFile);
          const responseData = await fs.readFile(this.responseFile, 'utf-8');
          const response = JSON.parse(responseData);

          if (response.id === command.id) {
            await this.cleanup();

            if (response.success) {
              return response.data;
            } else {
              throw new Error(response.error || 'Command failed');
            }
          }
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            Logger.error('Error reading response:', error);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      await this.cleanup();
      throw new Error(`Command timeout after ${timeout}ms`);

    } finally {
      this.isProcessing = false;
    }
  }

  // ===== Project Commands =====

  async getProjectInfo(): Promise<ProjectInfo> {
    return this.sendCommand('get_project_info');
  }

  // ===== Track Commands =====

  async getTrackInfo(trackIndex: number): Promise<TrackInfo> {
    return this.sendCommand('get_track_info', { trackIndex });
  }

  async createTrack(trackName?: string): Promise<{ trackIndex: number; trackNumber: number; name: string }> {
    return this.sendCommand('create_track', { trackName });
  }

  async setTrackVolume(trackIndex: number, volumeDb: number): Promise<void> {
    await this.sendCommand('set_track_volume', { trackIndex, volumeDb });
  }

  async setTrackPan(trackIndex: number, pan: number): Promise<void> {
    await this.sendCommand('set_track_pan', { trackIndex, pan });
  }

  async deleteTrack(trackIndex: number): Promise<{ deletedTrackIndex: number }> {
    return this.sendCommand('delete_track', { trackIndex });
  }

  async setTrackName(trackIndex: number, trackName: string): Promise<{ trackIndex: number; trackNumber: number; name: string }> {
    return this.sendCommand('set_track_name', { trackIndex, trackName });
  }

  async setTrackSend(sourceTrackIndex: number, destTrackIndex: number, volumeDb: number = 0): Promise<void> {
    await this.sendCommand('set_track_send', { sourceTrackIndex, destTrackIndex, volumeDb });
  }

  async setTrackOutput(sourceTrackIndex: number, destTrackIndex: number): Promise<void> {
    await this.sendCommand('set_track_output', { sourceTrackIndex, destTrackIndex });
  }

  async batchSetTrackSend(sourceTrackIndices: number[], destTrackIndex: number, volumeDb: number = 0): Promise<{ results: any[] }> {
    return this.sendCommand('batch_set_track_send', { sourceTrackIndices, destTrackIndex, volumeDb });
  }

  async batchSetTrackOutput(sourceTrackIndices: number[], destTrackIndex: number): Promise<{ results: any[] }> {
    return this.sendCommand('batch_set_track_output', { sourceTrackIndices, destTrackIndex });
  }

  // ===== FX Commands =====

  async listAvailableFX(): Promise<string[]> {
    return this.sendCommand('list_available_fx');
  }

  async getTrackFX(trackIndex: number): Promise<FXInfo[]> {
    return this.sendCommand('get_track_fx', { trackIndex });
  }

  async getAvailablePlugins(searchQuery?: string, maxResults?: number, forceRefresh?: boolean): Promise<{
    plugins: string[];
    count: number;
    source: 'cache' | 'fallback';
    searchQuery?: string;
  }> {
    return this.pluginParser.getAvailablePlugins(searchQuery, maxResults, forceRefresh);
  }

  async addFXToTrack(trackIndex: number, fxName: string, vendor?: string): Promise<any> {
    // Step 1: Search for plugins matching the input name
    const searchResults = await this.pluginParser.getAvailablePlugins(fxName, 50);
    
    if (searchResults.plugins.length === 0) {
      throw new Error(`No plugins found matching "${fxName}"`);
    }

    // Step 2: Get track channel info
    const trackInfo = await this.getTrackInfo(trackIndex);
    const isMono = trackInfo.isMono || false;
    Logger.info(`[addFXToTrack] Track ${trackIndex} is ${isMono ? 'mono' : 'stereo'}, searching for "${fxName}"`);

    // Step 3: Filter and score matching plugins
    const plugins = searchResults.plugins;
    const scoredPlugins: { plugin: string; score: number }[] = [];
    
    for (const plugin of plugins) {
      const pluginLower = plugin.toLowerCase();
      const nameLower = fxName.toLowerCase();
      
      // Check if plugin contains the base name
      if (!pluginLower.includes(nameLower)) continue;
      
      let score = 0;
      
      // ===== STRONGLY PREFER VST3 =====
      if (plugin.startsWith('VST3:')) {
        score += 1000;  // Very high priority for VST3
      } else if (plugin.startsWith('VST:')) {
        score += 50;
      } else if (plugin.startsWith('AU:')) {
        score += 25;
      }
      
      // Check for Mono/Stereo indicators
      const isPluginMono = pluginLower.includes('mono') || pluginLower.includes('(m)');
      const isPluginStereo = pluginLower.includes('stereo') || pluginLower.includes('(s)');
      
      // Score based on channel match
      if (isMono && isPluginMono) {
        score += 200;
      } else if (!isMono && isPluginStereo) {
        score += 200;
      } else if (!isPluginMono && !isPluginStereo) {
        score += 100;
      } else if (isMono && isPluginStereo) {
        score -= 50;
      } else if (!isMono && isPluginMono) {
        score -= 50;
      }
      
      // Prefer Waves/FabFilter plugins with proper naming
      if (plugin.includes('(Waves)') || plugin.includes('(FabFilter)')) {
        score += 50;
      }
      
      scoredPlugins.push({ plugin, score });
    }

    // Sort by score descending
    scoredPlugins.sort((a, b) => b.score - a.score);
    
    // Get best match
    let bestMatch: string | null = scoredPlugins.length > 0 ? scoredPlugins[0].plugin : null;

    // If no match found with name filtering, try first result
    if (!bestMatch && plugins.length > 0) {
      bestMatch = plugins[0];
    }

    if (!bestMatch) {
      throw new Error(`Could not find suitable plugin match for "${fxName}"`);
    }

    Logger.info(`[addFXToTrack] Matched "${fxName}" to "${bestMatch}" (isMono: ${isMono})`);
    
    // Step 4: Add the FX with the exact matched name
    return this.sendCommand('add_fx_to_track_smart', { 
      trackIndex, 
      fxName: bestMatch, 
      vendor: vendor || 'generic' 
    });
  }

  async removeFXFromTrack(trackIndex: number, fxIndex: number): Promise<void> {
    await this.sendCommand('remove_fx_from_track', { trackIndex, fxIndex });
  }

  async getFXParams(trackIndex: number, fxIndex: number): Promise<FXParam[]> {
    return this.sendCommand('get_fx_params', { trackIndex, fxIndex });
  }

  async setFXParam(trackIndex: number, fxIndex: number, paramIndex: number, value: number): Promise<void> {
    await this.sendCommand('set_fx_param', { trackIndex, fxIndex, paramIndex, value });
  }

  async setFXParamNormalized(trackIndex: number, fxIndex: number, paramIndex: number, normalizedValue: number): Promise<void> {
    await this.sendCommand('set_fx_param_normalized', { trackIndex, fxIndex, paramIndex, normalizedValue });
  }

  async setFXEnabled(trackIndex: number, fxIndex: number, enabled: boolean): Promise<void> {
    await this.sendCommand('set_fx_enabled', { trackIndex, fxIndex, enabled });
  }

  async tweakFXParameter(trackIndex: number, fxName: string, paramIndex: number, normalizedValue: number): Promise<any> {
    return this.sendCommand('tweak_fx_parameter', { trackIndex, fxName, paramIndex, normalizedValue });
  }

  async manageTrackRouting(
    action: 'add_send' | 'remove_send' | 'set_master_send',
    sourceTrackIndex: number,
    destTrackIndex?: number,
    enable?: boolean,
    sendVolumeDb?: number,
    sendPan?: number
  ): Promise<any> {
    return this.sendCommand('manage_track_routing', {
      action,
      sourceTrackIndex,
      destTrackIndex,
      enable,
      sendVolumeDb,
      sendPan
    });
  }

  // ===== Media Item Commands =====

  async splitItem(trackIndex: number, itemIndex: number, position: number): Promise<{ newItemIndex: number }> {
    return this.sendCommand('split_item', { trackIndex, itemIndex, position });
  }

  async getItemInfo(trackIndex: number, itemIndex: number): Promise<MediaItemInfo> {
    return this.sendCommand('get_item_info', { trackIndex, itemIndex });
  }

  async analyzeMediaItem(trackIndex: number, itemIndex: number): Promise<any> {
    return this.sendCommand('analyze_media_item', { trackIndex, itemIndex });
  }

  // ===== Rendering =====

  async isolateAndRender(
    trackId: string,
    startTime: number,
    endTime: number,
    renderMode: 'solo' | 'master' | 'chorus' | 'multi' = 'solo',
    trackIds?: string[]
  ): Promise<RenderResult> {
    return this.sendCommand('isolate_and_render', { 
      trackId, 
      startTime, 
      endTime, 
      renderMode,
      trackIds 
    });
  }
}