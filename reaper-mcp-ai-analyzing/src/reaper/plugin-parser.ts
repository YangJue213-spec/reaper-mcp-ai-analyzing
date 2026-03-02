import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * REAPER Plugin Parser
 * Parses REAPER's plugin cache files to get accurate plugin names
 */
export class ReaperPluginParser {
  // Real cache file paths for Apple Silicon Mac
  private vstIniPath: string = '/Applications/reaper-vstplugins_arm64.ini';
  private auIniPath: string = '/Applications/reaper-auplugins_arm64.ini';
  
  // Cache for parsed plugins
  private pluginCache: string[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 60000; // 60 seconds cache TTL

  /**
   * Get all available plugins with optional search
   * @param searchQuery Optional search keyword for fuzzy matching
   * @param maxResults Maximum number of results to return (default: 50)
   * @returns Array of plugin names
   */
  async getAvailablePlugins(searchQuery?: string, maxResults: number = 50): Promise<{
    plugins: string[];
    count: number;
    totalCount: number;
    source: 'cache' | 'fallback';
    searchQuery?: string;
    cachePaths: { vst: string; au: string };
  }> {
    // Use cache if valid
    if (!this.pluginCache || Date.now() - this.cacheTimestamp > this.CACHE_TTL) {
      this.pluginCache = await this.parseAllPlugins();
      this.cacheTimestamp = Date.now();
    }

    let results = this.pluginCache;
    const totalCount = results.length;
    let source: 'cache' | 'fallback' = 'cache';

    // If no plugins found in cache, use fallback
    if (results.length === 0) {
      results = this.getFallbackPlugins();
      source = 'fallback';
    }

    // Apply search if provided
    if (searchQuery && searchQuery.trim() !== '') {
      results = this.fuzzySearch(results, searchQuery.trim());
    }

    // Limit results
    const limitedResults = results.slice(0, maxResults);

    return {
      plugins: limitedResults,
      count: limitedResults.length,
      totalCount,
      source,
      searchQuery: searchQuery || undefined,
      cachePaths: {
        vst: this.vstIniPath,
        au: this.auIniPath
      }
    };
  }

  /**
   * Parse all plugins from VST and AU cache files
   */
  private async parseAllPlugins(): Promise<string[]> {
    const plugins = new Set<string>();

    try {
      // Parse VST plugins
      const vstPlugins = await this.parseVstIni();
      vstPlugins.forEach(p => plugins.add(p));
      console.error(`[PluginParser] Parsed ${vstPlugins.length} VST plugins from ${this.vstIniPath}`);
    } catch (error) {
      console.error(`[PluginParser] Failed to parse VST plugins from ${this.vstIniPath}:`, error);
    }

    try {
      // Parse AU plugins
      const auPlugins = await this.parseAuIni();
      auPlugins.forEach(p => plugins.add(p));
      console.error(`[PluginParser] Parsed ${auPlugins.length} AU plugins from ${this.auIniPath}`);
    } catch (error) {
      console.error(`[PluginParser] Failed to parse AU plugins from ${this.auIniPath}:`, error);
    }

    // Sort alphabetically
    const sorted = Array.from(plugins).sort();
    console.error(`[PluginParser] Total unique plugins: ${sorted.length}`);
    return sorted;
  }

  /**
   * Parse VST plugin cache file
   * Format examples:
   * - Acme_Opticom_XLA_3.vst=80E201F591ABDA01,1095713624,Acme Opticom XLA-3 (Plugin Alliance)
   * - Acme_Opticom_XLA_3.vst3=00799AF591ABDA01,2021102403{565354414F435861636D65206F707469,Acme Opticom XLA-3 (Plugin Alliance)
   * - ADPTR_Hype.vst=00A6CBF691ABDA01 (no name)
   */
  private async parseVstIni(): Promise<string[]> {
    try {
      const content = await fs.readFile(this.vstIniPath, 'utf-8');
      const plugins: string[] = [];
      
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines, comments, and section headers
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('[')) {
          continue;
        }

        // Parse format: filename.vst/vst3=...
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) continue;

        // Get filename (before =) to determine type
        const filename = trimmed.substring(0, equalIndex).toLowerCase();
        const afterEqual = trimmed.substring(equalIndex + 1);
        
        // Determine prefix based on file extension
        let prefix = 'VST:';
        if (filename.endsWith('.vst3')) {
          prefix = 'VST3:';
        } else if (filename.endsWith('.vst')) {
          prefix = 'VST:';
        }

        // Extract plugin name
        // Try multiple patterns
        let pluginName: string | null = null;

        // Pattern 1: ,Name (Developer) at the end
        const matchWithParens = afterEqual.match(/,([^,]+?\s*\([^)]+\))$/);
        if (matchWithParens) {
          pluginName = matchWithParens[1].trim();
        }

        // Pattern 2: Look for comma-separated parts, take the last one that looks like a name
        if (!pluginName) {
          const parts = afterEqual.split(',');
          // Find the last part that contains a space (likely a name, not just an ID)
          for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i].trim();
            // Skip if it's just an ID (contains only hex or digits)
            if (part && !/^[\dA-Fa-f{}]+$/.test(part) && part.length > 2) {
              // Remove any trailing hex data in braces
              const cleanPart = part.replace(/\{[0-9A-Fa-f]+\}/, '').trim();
              if (cleanPart && cleanPart.length > 2) {
                pluginName = cleanPart;
                break;
              }
            }
          }
        }

        if (pluginName) {
          plugins.push(`${prefix} ${pluginName}`);
        }
      }

      return plugins;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.error(`[PluginParser] VST plugin cache not found: ${this.vstIniPath}`);
      }
      throw error;
    }
  }

  /**
   * Parse AU plugin cache file
   * Format: Apple: AUAudioFilePlayer=<!inst> or Developer: Name=<inst>
   */
  private async parseAuIni(): Promise<string[]> {
    try {
        const content = await fs.readFile(this.auIniPath, 'utf-8');
      const plugins: string[] = [];
      
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines, comments, and section headers
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('[')) {
          continue;
        }

        // Parse format: Developer: PluginName=<inst> or =<!inst>
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) continue;

        const beforeEqual = trimmed.substring(0, equalIndex).trim();
        
        // The part before = is "Developer: PluginName"
        if (beforeEqual && beforeEqual.includes(':')) {
          plugins.push(`AU: ${beforeEqual}`);
        }
      }

      return plugins;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.error(`[PluginParser] AU plugin cache not found: ${this.auIniPath}`);
      }
      throw error;
    }
  }

  /**
   * Fuzzy search through plugin list
   */
  private fuzzySearch(plugins: string[], query: string): string[] {
    const queryLower = query.toLowerCase();
    const queryParts = queryLower.split(/\s+/).filter(p => p.length > 0);
    
    // Score each plugin
    const scored = plugins.map(plugin => {
      const pluginLower = plugin.toLowerCase();
      let score = 0;
      
      // Exact match gets highest score
      if (pluginLower === queryLower) {
        score = 1000;
      }
      // Starts with query gets high score
      else if (pluginLower.startsWith(queryLower)) {
        score = 500;
      }
      // Contains query as substring
      else if (pluginLower.includes(queryLower)) {
        score = 300;
      }
      // All query parts match (in any order)
      else {
        const allPartsMatch = queryParts.every(part => pluginLower.includes(part));
        if (allPartsMatch) {
          score = 200;
        }
        // Some parts match
        else {
          const matchingParts = queryParts.filter(part => pluginLower.includes(part));
          score = matchingParts.length * 50;
        }
      }
      
      // Bonus for common plugin keywords
      const commonKeywords = ['eq', 'compressor', 'reverb', 'delay', 'limiter', 'gate', 'filter'];
      for (const keyword of commonKeywords) {
        if (queryLower.includes(keyword) && pluginLower.includes(keyword)) {
          score += 25;
        }
      }
      
      return { plugin, score };
    });
    
    // Filter out zero scores and sort by score descending
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.plugin);
  }

  /**
   * Fallback plugin list when cache files are not available
   */
  private getFallbackPlugins(): string[] {
    return [
      'ReaEQ (Cockos)',
      'ReaComp (Cockos)',
      'ReaXComp (Cockos)',
      'ReaGate (Cockos)',
      'ReaLimit (Cockos)',
      'ReaFIR (Cockos)',
      'ReaVerb (Cockos)',
      'ReaDelay (Cockos)',
      'ReaPitch (Cockos)',
      'ReaTune (Cockos)',
    ];
  }

  /**
   * Clear the plugin cache (useful for forcing a re-parse)
   */
  clearCache(): void {
    this.pluginCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get cache file paths (for debugging)
   */
  getCachePaths(): { vst: string; au: string } {
    return {
      vst: this.vstIniPath,
      au: this.auIniPath
    };
  }
}