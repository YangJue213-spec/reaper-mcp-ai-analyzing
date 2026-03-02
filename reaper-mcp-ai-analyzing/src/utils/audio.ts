// Audio processing utilities

import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { LoudnessData } from '../types/reaper.js';
import { Logger } from './logger.js';

/**
 * Analyze audio file loudness using FFmpeg's loudnorm filter
 */
export async function analyzeLoudness(audioFilePath: string): Promise<LoudnessData> {
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
      try {
        // Extract JSON from stderr
        const jsonMatch = stderr.match(/\{\s*"input_i"[^}]+\}/s);
        if (jsonMatch) {
          const stats = JSON.parse(jsonMatch[0]);
          
          resolve({
            integratedLufs: parseFloat(stats.input_i) || -23.0,
            truePeak: parseFloat(stats.input_tp) || -1.0,
            loudnessRange: parseFloat(stats.input_lra) || 0.0,
            threshold: parseFloat(stats.input_thresh) || -30.0,
          });
        } else {
          // Fallback parsing
          const iMatch = stderr.match(/input_i:\s*([-\d.]+)/);
          if (iMatch) {
            resolve({
              integratedLufs: parseFloat(iMatch[1]),
              truePeak: -1.0,
              loudnessRange: 0.0,
              threshold: -30.0,
            });
          } else {
            resolve({
              integratedLufs: -23.0,
              truePeak: -1.0,
              loudnessRange: 0.0,
              threshold: -30.0,
            });
          }
        }
      } catch (error) {
        reject(error);
      }
    });
    
    ffmpeg.on('error', (error) => {
      Logger.error('FFmpeg spawn error:', error);
      reject(error);
    });
  });
}

/**
 * Convert audio file to base64 for AI analysis
 */
export async function audioToBase64(audioFilePath: string): Promise<string> {
  try {
    const data = await fs.readFile(audioFilePath);
    return data.toString('base64');
  } catch (error) {
    Logger.error('Failed to read audio file:', error);
    throw new Error(`Failed to read audio file: ${error}`);
  }
}

/**
 * Get audio file info using ffprobe
 */
export async function getAudioInfo(audioFilePath: string): Promise<{
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
}> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-show_entries', 'stream=sample_rate,channels',
      '-of', 'json',
      audioFilePath
    ]);
    
    let stdout = '';
    let stderr = '';
    
    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }
      
      try {
        const info = JSON.parse(stdout);
        resolve({
          duration: parseFloat(info.format?.duration || '0'),
          sampleRate: parseInt(info.streams?.[0]?.sample_rate || '44100'),
          channels: parseInt(info.streams?.[0]?.channels || '2'),
          format: info.format?.format_name || 'unknown',
        });
      } catch (error) {
        reject(error);
      }
    });
    
    ffprobe.on('error', reject);
  });
}

/**
 * Convert audio to MP3 for smaller size (for AI upload)
 */
export async function convertToMp3(
  inputPath: string,
  outputPath: string,
  bitrate: string = '128k'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-b:a', bitrate,
      '-y',
      outputPath
    ]);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg conversion failed: ${stderr}`));
      }
    });
    
    ffmpeg.on('error', reject);
  });
}