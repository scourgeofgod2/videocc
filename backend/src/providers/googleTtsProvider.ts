// Google Vertex AI TTS Provider
// POST https://texttospeech.vertexapis.com/v1/text:synthesize
// Auth: Bearer CORTEX_API_KEY  (same key reused)
// Response: { audioContent: "<base64 MP3>" }  — synchronous, no polling needed
//
// Supports tr-TR and en-US, Gemini 2.5 Flash/Pro TTS voices

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { VoiceProvider } from './base.js';
import type { ProviderConfig } from '../models.js';

const TTS_ENDPOINT = 'https://texttospeech.vertexapis.com/v1/text:synthesize';
const DEFAULT_MODEL = 'gemini-2.5-flash-tts';

const execAsync = promisify(exec);

/** Probe real audio duration via ffprobe; fallback to size estimate */
async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const d = parseFloat(stdout.trim());
    return isNaN(d) ? estimateDuration(fs.statSync(filePath).size) : d;
  } catch {
    return estimateDuration(fs.statSync(filePath).size);
  }
}

function estimateDuration(bytes: number): number {
  // 128 kbps MP3 ≈ 16 KB/s
  return Math.max(1, bytes / (128 * 1024 / 8));
}

// ── Voice catalogue (subset of Gemini TTS voices) ──────────────────────────

export interface GoogleTtsVoice {
  name: string;           // API voice name  e.g. 'Kore'
  gender: 'female' | 'male';
  label: string;          // display label
  description: string;
}

export const GOOGLE_TTS_VOICES: GoogleTtsVoice[] = [
  // Female
  { name: 'Kore',          gender: 'female', label: 'Kore — Kararlı',        description: 'Kararlı ve güçlü' },
  { name: 'Aoede',         gender: 'female', label: 'Aoede — Ferah',          description: 'Ferah ve doğal' },
  { name: 'Leda',          gender: 'female', label: 'Leda — Genç',            description: 'Genç ve enerjik' },
  { name: 'Zephyr',        gender: 'female', label: 'Zephyr — Parlak',        description: 'Parlak ve canlı' },
  { name: 'Achernar',      gender: 'female', label: 'Achernar — Yumuşak',     description: 'Yumuşak ve sakin' },
  { name: 'Autonoe',       gender: 'female', label: 'Autonoe — Canlı',        description: 'Canlı ve neşeli' },
  { name: 'Despina',       gender: 'female', label: 'Despina — Akıcı',        description: 'Akıcı ve net' },
  { name: 'Gacrux',        gender: 'female', label: 'Gacrux — Olgun',         description: 'Olgun ve otoriter' },
  { name: 'Sulafat',       gender: 'female', label: 'Sulafat — Sıcak',        description: 'Sıcak ve samimi' },
  // Male
  { name: 'Charon',        gender: 'male',   label: 'Charon — Bilgilendirici',description: 'Bilgilendirici ve net' },
  { name: 'Achird',        gender: 'male',   label: 'Achird — Samimi',        description: 'Samimi ve sıcak' },
  { name: 'Fenrir',        gender: 'male',   label: 'Fenrir — Heyecanlı',     description: 'Heyecanlı ve dinamik' },
  { name: 'Puck',          gender: 'male',   label: 'Puck — Neşeli',          description: 'Neşeli ve enerjik' },
  { name: 'Algenib',       gender: 'male',   label: 'Algenib — Kalın',        description: 'Kalın ve güçlü' },
  { name: 'Alnilam',       gender: 'male',   label: 'Alnilam — Kararlı',      description: 'Kararlı ve otoriter' },
  { name: 'Iapetus',       gender: 'male',   label: 'Iapetus — Net',          description: 'Net ve profesyonel' },
  { name: 'Orus',          gender: 'male',   label: 'Orus — Sert',            description: 'Sert ve dramatik' },
  { name: 'Rasalgethi',    gender: 'male',   label: 'Rasalgethi — Derin',     description: 'Derin ve anlatıcı' },
  { name: 'Sadachbia',     gender: 'male',   label: 'Sadachbia — Canlı',      description: 'Canlı ve hareketli' },
  { name: 'Schedar',       gender: 'male',   label: 'Schedar — Dengeli',      description: 'Dengeli ve güvenilir' },
  { name: 'Umbriel',       gender: 'male',   label: 'Umbriel — Rahat',        description: 'Rahat ve akıcı' },
  { name: 'Zubenelgenubi', gender: 'male',   label: 'Zubenelgenubi — Günlük', description: 'Günlük ve doğal' },
];

// ── Provider ──────────────────────────────────────────────────────────────────

export class GoogleTtsProvider implements VoiceProvider {
  private apiKey: string;
  private model: string;
  private voiceName: string;

  /**
   * @param config            Provider config — reads api_key_env, model
   * @param voiceNameOverride Gemini voice name (e.g. 'Kore'). Overrides config.voice_id.
   * @param languageCode      BCP-47 language code: 'tr-TR' | 'en-US' | ... (default 'tr-TR')
   * @param stylePrompt       Optional TTS style instruction (Google TTS input.prompt)
   *                          e.g. "Read with a dramatic, suspenseful narrator tone."
   */
  constructor(
    config: ProviderConfig,
    voiceNameOverride?: string,
    private readonly languageCode: string = 'tr-TR',
    private readonly stylePrompt?: string,
  ) {
    // Support both CORTEXAI_API_KEY (shared with CortexAI) and CORTEX_API_KEY
    const key = process.env[config.api_key_env]
              ?? process.env['CORTEXAI_API_KEY']
              ?? '';
    if (!key) throw new Error(`${config.api_key_env} (or CORTEXAI_API_KEY) env var not set`);
    this.apiKey    = key;
    this.model     = config.model ?? DEFAULT_MODEL;
    this.voiceName = voiceNameOverride ?? config.voice_id ?? 'Kore';
  }

  async generateSpeech(text: string, outputPath: string): Promise<[number, string | null]> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Build input — Google TTS accepts an optional `prompt` alongside `text`
    // to control voice style (tone, pace, emotion)
    const input: Record<string, string> = { text: text.trim() };
    if (this.stylePrompt?.trim()) {
      input['prompt'] = this.stylePrompt.trim();
    }

    const body = {
      input,
      voice: {
        languageCode: this.languageCode,
        name: this.voiceName,
        model_name: this.model,
      },
      audioConfig: {
        audioEncoding: 'MP3',
      },
    };

    console.log(`[tts/google] voice=${this.voiceName} model=${this.model} lang=${this.languageCode} chars=${text.length}${this.stylePrompt ? ' (with style prompt)' : ''}`);

    const resp = await fetch(TTS_ENDPOINT, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Google TTS HTTP ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as { audioContent?: string };
    const audioContent = data.audioContent;
    if (!audioContent) {
      throw new Error(`Google TTS: no audioContent in response: ${JSON.stringify(data)}`);
    }

    // Decode base64 → MP3
    const buffer = Buffer.from(audioContent, 'base64');
    fs.writeFileSync(outputPath, buffer);

    const duration = await probeDuration(outputPath);
    console.log(`[tts/google] saved ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB, ${duration.toFixed(1)}s)`);

    return [duration, null];
  }
}