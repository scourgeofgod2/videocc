// TTS Style Prompt Generator
// Analyzes script content via claude.gg and produces a 1–2 sentence
// Google TTS `input.prompt` that controls voice style/tone.
//
// Single LLM call per run — result applied to every TTS segment.

import OpenAI from 'openai';
import type { Script } from '../models.js';

const CLAUDEGG_BASE = 'https://claude.gg/v1';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Given a script, ask the LLM what voice style the TTS should use.
 * Returns a concise imperative prompt suitable for Google TTS `input.prompt`.
 *
 * @param script    The generated script (title, format, intro_narration used)
 * @param language  'tr' | 'en'
 * @param apiKey    claude.gg API key
 * @param model     LLM model (default claude-sonnet-4-5)
 */
export async function generateTtsStylePrompt(
  script: Script,
  language: 'tr' | 'en',
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: CLAUDEGG_BASE,
  });

  // Use only intro + first section (max 500 chars) — enough context for style
  const sampleNarration = [
    script.intro_narration,
    script.sections?.[0]?.narration,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);

  const langLabel = language === 'tr' ? 'Turkish' : 'English';

  const systemPrompt = `You are a TTS voice direction expert. Write exactly 1 imperative sentence in ${langLabel} directing the text-to-speech voice style. Mention pace, tone/emotion, energy level, and delivery style. Never mention the topic or any nouns. Max 130 characters. Output ONLY the instruction sentence, nothing else.`;

  const userMsg = `Title: "${script.title}" | Format: ${script.format}\nSample: "${sampleNarration}"`;

  console.log(`[tts/style] generating style prompt for "${script.title.slice(0, 60)}"`);

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
      max_tokens: 50,
      temperature: 0.3,
    });

    const prompt = resp.choices[0]?.message?.content?.trim() ?? '';
    if (!prompt) throw new Error('empty response');

    // Sanity: truncate to 140 chars (matches the 130-char instruction limit with margin)
    const final = prompt.slice(0, 140);
    console.log(`[tts/style] style prompt: "${final}"`);
    return final;

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tts/style] failed to generate style prompt (${msg}), skipping`);
    // Fallback: sensible defaults per language
    return language === 'tr'
      ? 'Akıcı, etkileyici ve profesyonel bir anlatıcı tonu ile oku.'
      : 'Read with a clear, engaging and professional narrator voice.';
  }
}