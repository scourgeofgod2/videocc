// CortexAI Voice Provider via router.claude.gg
// Used for Turkish TTS (and any language not covered by Inworld)
//
// Submit:  POST https://router.claude.gg/api/generate
//   body:  { model: 'voiceover', type: 'voiceover', params: { text, voice_id?, stability?, speed? } }
//   auth:  Bearer CORTEXAI_API_KEY
//   resp:  { task_id | id | taskId }
//
// Poll:    GET  https://router.claude.gg/get/:taskId
//   resp:  { status: 'PROCESSING' | 'FINISHED' | 'FAILED', result: [...] | string }

import fs from 'node:fs';
import path from 'node:path';
import type { VoiceProvider } from './base.js';
import type { ProviderConfig } from '../models.js';

/** Estimate audio duration from file size (128 kbps MP3 ≈ 16 KB/s) */
function estimateDuration(bytes: number): number {
  return Math.max(1, bytes / (128 * 1024 / 8));
}

const SUBMIT_URL = 'https://router.claude.gg/api/generate';
const POLL_BASE  = 'https://router.claude.gg/get';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS        = 120; // ~10 minutes

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class CortexAiVoiceProvider implements VoiceProvider {
  private apiKey:  string;
  private voiceId: string;
  private stability: number;
  private speed:     number;

  /**
   * @param config       Provider config (reads api_key_env, voice_id, extra.stability/speed)
   * @param voiceIdOverride  If supplied, overrides config.voice_id (user-selected voice)
   */
  constructor(config: ProviderConfig, voiceIdOverride?: string) {
    const key = process.env[config.api_key_env] ?? '';
    if (!key) throw new Error(`${config.api_key_env} env var not set`);
    this.apiKey    = key;
    this.voiceId   = voiceIdOverride ?? config.voice_id ?? '';
    this.stability = parseFloat(config.extra?.['stability'] ?? '0.5');
    this.speed     = parseFloat(config.extra?.['speed']     ?? '1.0');
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type':  'application/json',
    };
  }

  /** Submit a voiceover task, return taskId */
  private async submit(text: string): Promise<string> {
    const params: Record<string, unknown> = {
      text:      text.trim(),
      stability: Math.min(1, Math.max(0, this.stability)),
      speed:     Math.min(1.2, Math.max(0.7, this.speed)),
    };
    if (this.voiceId) params['voice_id'] = this.voiceId;

    const resp = await fetch(SUBMIT_URL, {
      method:  'POST',
      headers: this.authHeaders,
      body:    JSON.stringify({ model: 'voiceover', type: 'voiceover', params }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`CortexAI TTS submit HTTP ${resp.status}: ${err}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    const taskId = (data['task_id'] ?? data['id'] ?? data['taskId']) as string | undefined;
    if (!taskId) {
      throw new Error(`CortexAI TTS: no taskId in response: ${JSON.stringify(data)}`);
    }
    console.log(`[tts/cortex] task ${taskId} submitted`);
    return taskId;
  }

  /** Poll until FINISHED, return audio URL */
  private async poll(taskId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      const resp = await fetch(`${POLL_BASE}/${taskId}`, {
        headers: this.authHeaders,
      });

      if (!resp.ok) {
        console.warn(`[tts/cortex] poll HTTP ${resp.status}, retrying…`);
        continue;
      }

      const data = await resp.json() as Record<string, unknown>;
      const rawStatus = ((data['status'] ?? 'UNKNOWN') as string).toUpperCase();

      if (i % 5 === 0) console.log(`[tts/cortex] task ${taskId}: ${rawStatus}`);

      if (['FINISHED', 'COMPLETED', 'SUCCESS', 'DONE'].includes(rawStatus)) {
        const audioUrl = this.extractAudioUrl(data);
        if (!audioUrl) {
          throw new Error(`CortexAI TTS: FINISHED but no audio URL: ${JSON.stringify(data)}`);
        }
        console.log(`[tts/cortex] task ${taskId} done`);
        return audioUrl;
      }

      if (['FAILED', 'ERROR', 'CANCELLED'].includes(rawStatus)) {
        const msg = (data['error'] ?? data['message'] ?? rawStatus) as string;
        throw new Error(`CortexAI TTS task ${taskId} ${rawStatus}: ${msg}`);
      }
    }

    throw new Error(`CortexAI TTS: task ${taskId} timed out after ${MAX_POLLS} polls`);
  }

  private extractAudioUrl(data: Record<string, unknown>): string | null {
    const result = data['result'];

    if (Array.isArray(result) && result.length > 0) {
      const first = result[0] as unknown;
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const o = first as Record<string, string>;
        return o['url'] ?? o['audio_url'] ?? null;
      }
    }

    if (typeof result === 'string' && result.startsWith('http')) return result;
    if (typeof data['audio_url'] === 'string') return data['audio_url'];
    if (typeof data['url']       === 'string') return data['url'];

    return null;
  }

  async generateSpeech(text: string, outputPath: string): Promise<[number, string | null]> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const taskId   = await this.submit(text);
    const audioUrl = await this.poll(taskId);

    // Download audio
    const dlResp = await fetch(audioUrl);
    if (!dlResp.ok) {
      throw new Error(`CortexAI TTS: failed to download audio ${audioUrl}: ${dlResp.status}`);
    }

    const buffer = Buffer.from(await dlResp.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    const duration = estimateDuration(buffer.length);
    console.log(`[tts/cortex] saved ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB, ~${duration.toFixed(1)}s)`);

    return [duration, null];
  }
}