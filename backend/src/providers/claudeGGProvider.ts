// Claude.gg LLM Provider — OpenAI-compatible API
// Ports Python src/providers/wiro_llm_provider.py (JSON repair, retry, format support)

import OpenAI from 'openai';
import { buildUserPrompt, buildCustomPrompt, getSystemPrompt } from '../prompts/formatPrompts.js';
import type { LLMProvider } from './base.js';
import type { Script, Section, ProviderConfig } from '../models.js';

const MAX_RETRIES = 2;

const VIDEO_LENGTH_INSTRUCTIONS: Record<string, string> = {
  short: `
VIDEO LENGTH: SHORT (1.5–3 minutes total)
- intro_narration: 2 concise sentences — quick hook, no fluff
- Each section narration: 2-3 short punchy sentences, get straight to the point
- outro_narration: 1 sentence call to action
- Overall tone: fast-paced, snappy, no filler words`,
  medium: `
VIDEO LENGTH: MEDIUM (3–6 minutes total)
- intro_narration: 4-5 sentences that hook the viewer and tease what's coming
- Each section narration: 5-7 detailed sentences with interesting facts and smooth transitions
- outro_narration: 2-3 sentences wrapping up with a call to action
- Overall tone: conversational, informative, well-paced`,
  long: `
VIDEO LENGTH: LONG (6–10 minutes total)
- intro_narration: 5-7 sentences — deep hook, build anticipation, set context
- Each section narration: 8-12 detailed sentences with in-depth analysis, examples, comparisons, and storytelling
- outro_narration: 3-4 sentences with recap and strong call to action
- Overall tone: thorough, educational, engaging storytelling`,
};

// ── JSON repair utilities (ported from Python) ──────────────────────────────

function repairTruncatedJson(text: string): string {
  // Check if we're inside an unterminated string
  let inString = false;
  let escape = false;
  for (const ch of text) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) text += '"';

  // Remove trailing comma
  text = text.trimEnd();
  if (text.endsWith(',')) text = text.slice(0, -1);

  // Count open braces/brackets
  const opens: Record<string, number> = { '[': 0, '{': 0 };
  const closes: Record<string, string> = { ']': '[', '}': '{' };
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch in opens) opens[ch]++;
    else if (ch in closes) opens[closes[ch]]--;
  }

  text += ']'.repeat(Math.max(0, opens['[']));
  text += '}'.repeat(Math.max(0, opens['{']));
  return text;
}

function extractJson(raw: string): Record<string, unknown> {
  let text = raw.trim();
  // Strip markdown fences
  text = text.replace(/```(?:json)?\s*/g, '');

  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in LLM output.');

  // Find matching closing brace
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }

  let jsonStr = end !== -1 ? text.slice(start, end + 1) : repairTruncatedJson(text.slice(start));
  // Remove trailing commas before } or ]
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(jsonStr) as Record<string, unknown>;
}

// ── Provider class ────────────────────────────────────────────────────────────

export class ClaudeGGProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    const apiKey = process.env[config.api_key_env] ?? '';
    if (!apiKey) throw new Error(`${config.api_key_env} env var not set`);
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://claude.gg/v1',
    });
    this.model = config.model ?? 'claude-sonnet-4-6';
  }

  async generateScript(
    topic: string,
    numSections: number,
    opts: {
      subtitles?: string[];
      imageStyle?: string;
      imagesPerSection?: number;
      customInstructions?: string;
      videoLength?: 'short' | 'medium' | 'long';
      scriptFormat?: string;
      videosPerSection?: number;
    } = {},
  ): Promise<Script> {
    const {
      subtitles,
      imageStyle = '',
      imagesPerSection = 1,
      customInstructions = '',
      videoLength = 'medium',
      scriptFormat = 'listicle',
      videosPerSection = 1,
    } = opts;

    const styleInstruction = imageStyle
      ? `\nAll image prompts must be in "${imageStyle}" style. Append ", ${imageStyle} style" to every image_prompt.\n`
      : '';
    const lengthInstruction = VIDEO_LENGTH_INSTRUCTIONS[videoLength] ?? VIDEO_LENGTH_INSTRUCTIONS['medium'];

    let userPrompt: string;
    if (customInstructions) {
      userPrompt = buildCustomPrompt({
        fmt: scriptFormat,
        topic,
        numSections,
        styleInstruction,
        lengthInstruction,
        imagesPerSection: Math.max(1, imagesPerSection),
        customInstructions,
        videosPerSection: Math.max(1, videosPerSection),
      });
    } else {
      userPrompt = buildUserPrompt({
        fmt: scriptFormat,
        topic,
        numSections,
        styleInstruction,
        lengthInstruction,
        imagesPerSection: Math.max(1, imagesPerSection),
        videosPerSection: Math.max(1, videosPerSection),
      });
    }

    if (subtitles && subtitles.length > 0) {
      const numbered = subtitles.map((s, i) => `${i + 1}. ${s}`).join('\n');
      userPrompt +=
        `\n\nYou MUST use these exact section headings (in this order):\n${numbered}\n` +
        `Do NOT rename or reorder them. Write narration and image prompts for each.`;
      numSections = subtitles.length;
    }

    const systemPrompt = getSystemPrompt(scriptFormat);

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[llm] attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
        });

        const content = response.choices[0]?.message?.content ?? '';
        console.log(`[llm] raw output: ${content.length} chars`);

        const data = extractJson(content);
        const stripped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) stripped[k.trim()] = v;

        const rawSections = (stripped['sections'] as unknown[]) ?? [];
        if (!rawSections.length) throw new Error(`No sections in LLM output (keys: ${Object.keys(stripped).join(', ')})`);

        // Enforce numSections: LLM sometimes returns more (or fewer) than requested
        const clampedRaw = rawSections.slice(0, numSections);
        console.log(`[llm] LLM returned ${rawSections.length} sections, using ${clampedRaw.length} (requested: ${numSections})`);

        const sections: Section[] = clampedRaw.map((rawS, idx) => {
          const s: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawS as Record<string, unknown>)) {
            s[k.trim()] = typeof v === 'string' ? v.trim() : v;
          }

          // Normalize heading
          let heading = (s['heading'] as string) || '';
          if (!heading) {
            for (const alt of ['title', 'name', 'subject', 'topic']) {
              if (s[alt]) { heading = s[alt] as string; delete s[alt]; break; }
            }
            if (!heading) heading = `Section ${(s['number'] as number) ?? idx + 1}`;
          }

          // Normalize narration
          let narration = (s['narration'] as string) || '';
          if (!narration) {
            for (const alt of ['script', 'text', 'content', 'description', 'body']) {
              if (s[alt]) { narration = s[alt] as string; delete s[alt]; break; }
            }
            if (!narration) narration = `Let's talk about ${heading}.`;
          }

          // Normalize image_prompts
          let prompts: string[] = (s['image_prompts'] as string[]) ?? [];
          if (typeof prompts === 'string') prompts = [prompts];
          if (!prompts.length && s['image_prompt']) prompts = [s['image_prompt'] as string];
          if (!prompts.length) prompts = [`Cinematic illustration of: ${heading}, dramatic lighting, high detail, 16:9`];

          // Normalize video_prompts
          let vidPrompts: string[] = (s['video_prompts'] as string[]) ?? [];
          if (typeof vidPrompts === 'string') vidPrompts = [vidPrompts];

          return {
            number: (s['number'] as number) ?? idx + 1,
            heading,
            narration,
            image_prompt: prompts[0],
            image_prompts: prompts,
            video_prompts: vidPrompts,
            video_prompt: vidPrompts[0] ?? '',
            image_paths: [],
            video_paths: [],
            captions: [],
          } satisfies Section;
        });

        // Outro
        let outro = (stripped['outro_narration'] as string) ?? '';
        if (!outro || outro.length < 20) {
          outro = `And that wraps up our list! If you enjoyed this video, make sure to like, subscribe, and hit that notification bell so you never miss out on our next one. See you in the next video!`;
        }

        // Intro/outro image prompts
        const titleVal = (stripped['title'] as string) || topic;
        let introImg = (stripped['intro_image_prompt'] as string) ?? '';
        if (!introImg) introImg = `Cinematic wide shot representing: ${titleVal}, dramatic lighting, high detail, 16:9`;
        let outroImg = (stripped['outro_image_prompt'] as string) ?? '';
        if (!outroImg) outroImg = `Cinematic closing shot for a video about: ${titleVal}, warm lighting, high detail, 16:9`;

        let introNarration = (stripped['intro_narration'] as string) ?? '';
        if (!introNarration.trim()) introNarration = `Welcome! Today we're diving into ${titleVal}. Let's get started!`;

        return {
          title: titleVal || topic,
          format: scriptFormat,
          intro_narration: introNarration,
          intro_image_prompt: introImg,
          sections,
          outro_narration: outro,
          outro_image_prompt: outroImg,
          intro_image_paths: [],
          intro_video_paths: [],
          intro_captions: [],
          outro_captions: [],
        } satisfies Script;
      } catch (e) {
        lastError = e;
        console.error(`[llm] attempt ${attempt + 1} failed: ${e}`);
        if (attempt < MAX_RETRIES) continue;
      }
    }

    throw new Error(`Script generation failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
  }
}