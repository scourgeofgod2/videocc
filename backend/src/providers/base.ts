// Abstract provider interfaces — TypeScript port of Python src/providers/base.py

import type { Script, ProviderConfig } from '../models.js';

export interface LLMProvider {
  generateScript(
    topic: string,
    numSections: number,
    opts?: {
      subtitles?: string[];
      imageStyle?: string;
      imagesPerSection?: number;
      customInstructions?: string;
      rawText?: string;
      videoLength?: 'micro' | 'short' | 'medium' | 'long';
      scriptFormat?: string;
      videosPerSection?: number;
      language?: 'en' | 'tr';
      mediaSource?: string;
    },
  ): Promise<Script>;
}

export interface VoiceProvider {
  /** Generate speech for text, write MP3 to outputPath.
   *  Returns [durationSeconds, null] — CDN URL not applicable for local TTS. */
  generateSpeech(text: string, outputPath: string): Promise<[number, string | null]>;
}

export interface ImageProvider {
  /** Generate image from prompt, write PNG/JPG to outputPath. Returns outputPath.
   *  aspectRatio overrides the provider's default (e.g. '9:16', '1:1'). */
  generateImage(prompt: string, outputPath: string, aspectRatio?: string): Promise<string>;
}

export interface VideoGenProvider {
  /** Generate video clip from prompt, write MP4 to outputPath. Returns outputPath. */
  generateVideo(prompt: string, outputPath: string, duration?: number): Promise<string>;
}