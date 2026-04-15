/**
 * Lemonfox STT (Speech-to-Text) provider
 * OpenAI-compatible API: https://api.lemonfox.ai/v1/audio/transcriptions
 *
 * Supports word-level timestamps via `timestamp_granularities[]=word`
 */

import fs from 'node:fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const BASE_URL = 'https://api.lemonfox.ai/v1/audio/transcriptions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LemonfoxWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface LemonfoxSegment {
  id: number;
  text: string;
  start: number;
  end: number;
  language?: string;
  speaker?: string;
  words?: LemonfoxWord[];
}

export interface LemonfoxTranscript {
  task: string;
  language: string;
  duration: number;
  text: string;
  segments: LemonfoxSegment[];
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Transcribe an audio file using Lemonfox STT API.
 *
 * @param audioPath  Local path to the MP3/WAV/etc. file
 * @param language   Language code, e.g. 'turkish' or 'english' (Lemonfox uses full names)
 * @param apiKey     LEMONFOX_API_KEY
 * @returns          Full transcript with word-level timestamps
 */
export async function transcribeAudio(
  audioPath: string,
  language: 'english' | 'turkish' | string,
  apiKey: string,
): Promise<LemonfoxTranscript> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Lemonfox STT error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as LemonfoxTranscript;
  return data;
}

/**
 * Map a voiceover language code ('tr' | 'en') to Lemonfox language string.
 */
export function toLemonfoxLang(lang: 'tr' | 'en' | string): string {
  return lang === 'tr' ? 'turkish' : 'english';
}