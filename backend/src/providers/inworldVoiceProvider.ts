// Inworld AI TTS Provider
// POST https://api.inworld.ai/tts/v1/voice
// Authorization: Basic <INWORLD_API_KEY>
// Response: { audioContent: "<base64 mp3>" }

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VoiceProvider } from './base.js';
import type { ProviderConfig } from '../models.js';

// ffprobe-static provides the binary path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require('ffprobe-static') as { path: string };
const execFileAsync = promisify(execFile);

const INWORLD_TTS_URL = 'https://api.inworld.ai/tts/v1/voice';

/** Get audio duration in seconds using ffprobe. */
async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath,
    ]);
    const info = JSON.parse(stdout) as { streams?: Array<{ duration?: string }> };
    const dur = parseFloat(info.streams?.[0]?.duration ?? '0');
    return isNaN(dur) ? 0 : dur;
  } catch {
    return 0;
  }
}

export class InworldVoiceProvider implements VoiceProvider {
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private audioEncoding: string;
  private sampleRateHertz: number;

  constructor(config: ProviderConfig) {
    const key = process.env[config.api_key_env] ?? '';
    if (!key) throw new Error(`${config.api_key_env} env var not set`);
    this.apiKey = key;
    this.voiceId = config.voice_id ?? 'default-8eyfsu-tt4_to1rnu4ew-w__marcus';
    this.modelId = config.model ?? 'inworld-tts-1.5-max';
    this.audioEncoding = config.extra?.['audioEncoding'] ?? 'MP3';
    this.sampleRateHertz = parseInt(config.extra?.['sampleRateHertz'] ?? '24000', 10);
  }

  async generateSpeech(text: string, outputPath: string): Promise<[number, string | null]> {
    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const body = {
      text,
      voiceId: this.voiceId,
      modelId: this.modelId,
      audioConfig: {
        audioEncoding: this.audioEncoding,
        sampleRateHertz: this.sampleRateHertz,
      },
    };

    const resp = await fetch(INWORLD_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Inworld TTS failed: ${resp.status} ${errText}`);
    }

    const data = await resp.json() as { audioContent?: string };
    if (!data.audioContent) {
      throw new Error('Inworld TTS: no audioContent in response');
    }

    // Decode base64 → write MP3
    const audioBuffer = Buffer.from(data.audioContent, 'base64');
    fs.writeFileSync(outputPath, audioBuffer);

    // Get duration via ffprobe
    const duration = await getAudioDuration(outputPath);
    console.log(`[voice] wrote ${path.basename(outputPath)} (${duration.toFixed(1)}s)`);

    return [duration, null]; // No CDN URL for local TTS
  }
}