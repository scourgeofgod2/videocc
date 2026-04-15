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

  const sampleNarration = [
    script.intro_narration,
    ...(script.sections?.slice(0, 2).map((s) => s.narration) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 800);

  const langLabel = language === 'tr' ? 'Turkish' : 'English';

  const systemPrompt = `You are a voice direction expert. Given a video script's title, format, and sample narration, write a concise 1–2 sentence voice style instruction for a text-to-speech engine.

Rules:
- Write in ${langLabel} (the TTS language)
- Use imperative form, e.g. "Speak with a warm, excited tone..." or "Read as a calm documentary narrator..."
- Be specific: mention pace, emotion, energy level, and delivery style
- Keep it under 150 characters
- Do NOT mention the topic or any nouns — only describe the voice style
- Output ONLY the style prompt, nothing else`;

  const userMsg = `Video title: "${script.title}"
Format: ${script.format}
Sample narration: "${sampleNarration}"`;

  console.log(`[tts/style] generating style prompt for "${script.title.slice(0, 60)}"`);

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
      max_tokens: 80,
      temperature: 0.4,
    });

    const prompt = resp.choices[0]?.message?.content?.trim() ?? '';
    if (!prompt) throw new Error('empty response');

    // Sanity: truncate to 200 chars
    const final = prompt.slice(0, 200);
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