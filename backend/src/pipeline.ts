// Main pipeline orchestrator — TypeScript port of Python src/pipeline.py
// Sequence: generateScript → generateVoiceovers → generateMedia → assembleVideo

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { AppConfig, Script } from './models.js';
import type { LLMProvider, VoiceProvider, ImageProvider } from './providers/base.js';
import { ClaudeGGProvider } from './providers/claudeGGProvider.js';
import { InworldVoiceProvider } from './providers/inworldVoiceProvider.js';
import { CortexAiVoiceProvider } from './providers/cortexAiVoiceProvider.js';
import { GoogleTtsProvider } from './providers/googleTtsProvider.js';
import { ZImageProvider } from './providers/zImageProvider.js';
import { ClaudeGGImageProvider } from './providers/claudeGGImageProvider.js';
import { PexelsImageProvider } from './providers/pexelsImageProvider.js';
import { fetchPexelsVideo } from './providers/pexelsVideoProvider.js';
import { DuckDuckGoImageProvider } from './providers/duckduckgoImageProvider.js';
import { GoogleImageProvider } from './providers/googleImageProvider.js';
import { composeVideo } from './video/composer.js';
import { generateTtsStylePrompt } from './prompts/ttsStylePrompt.js';
import { transcribeAudio, toLemonfoxLang } from './providers/lemonfoxSttProvider.js';

// ── Provider registry ─────────────────────────────────────────────────────────

function getLLMProvider(config: AppConfig): LLMProvider {
  switch (config.llm.provider) {
    case 'claudegg':
    case 'claude_gg':
    case 'claude.gg':
      return new ClaudeGGProvider(config.llm);
    default:
      throw new Error(`Unknown LLM provider: ${config.llm.provider}`);
  }
}

/**
 * voiceProvider routing:
 *   'google_tts' → Vertex AI TTS (CORTEX_API_KEY), tr-TR or en-US
 *   'cortexai'   → CortexAI router.claude.gg (tr default)
 *   'inworld'    → Inworld AI (en default)
 *   auto-detect: language='tr' defaults to cortexai, 'en' to inworld
 *
 * @param stylePrompt  Optional TTS style instruction for Google TTS input.prompt
 */
function getVoiceProvider(
  config: AppConfig,
  language: 'en' | 'tr' = 'en',
  voiceId?: string,
  voiceProvider?: string,
  stylePrompt?: string,
): VoiceProvider {
  // Explicit Google TTS selection
  if (voiceProvider === 'google_tts' || voiceProvider === 'google') {
    const googleConfig = {
      ...config.voice,
      provider: 'google_tts',
      api_key_env: config.voice.extra?.['cortex_key_env'] ?? 'CORTEXAI_API_KEY',
      model: config.voice.extra?.['google_tts_model'] ?? 'gemini-2.5-flash-tts',
    };
    const langCode = language === 'tr' ? 'tr-TR' : 'en-US';
    return new GoogleTtsProvider(googleConfig, voiceId, langCode, stylePrompt);
  }

  // Explicit CortexAI selection
  if (voiceProvider === 'cortexai' || voiceProvider === 'cortex_ai') {
    const cortexConfig = {
      ...config.voice,
      provider: 'cortexai',
      api_key_env: config.voice.extra?.['cortexai_key_env'] ?? 'CORTEXAI_API_KEY',
    };
    return new CortexAiVoiceProvider(cortexConfig, voiceId);
  }

  // Auto-detect by language
  if (language === 'tr') {
    // Turkish default: CortexAI
    const cortexConfig = {
      ...config.voice,
      provider: 'cortexai',
      api_key_env: config.voice.extra?.['cortexai_key_env'] ?? 'CORTEXAI_API_KEY',
    };
    return new CortexAiVoiceProvider(cortexConfig, voiceId);
  }

  // English: provider from config
  switch (config.voice.provider) {
    case 'inworld':
    case 'inworld_ai':
      return new InworldVoiceProvider(config.voice);
    case 'cortexai':
    case 'cortex_ai':
    case 'cortex.ai':
      return new CortexAiVoiceProvider(config.voice, voiceId);
    case 'google_tts':
    case 'google': {
      const googleConfig = {
        ...config.voice,
        api_key_env: config.voice.extra?.['cortex_key_env'] ?? 'CORTEXAI_API_KEY',
        model: config.voice.extra?.['google_tts_model'] ?? 'gemini-2.5-flash-tts',
      };
      return new GoogleTtsProvider(googleConfig, voiceId, 'en-US', stylePrompt);
    }
    default:
      throw new Error(`Unknown voice provider: ${config.voice.provider}`);
  }
}

function getImageProvider(config: AppConfig, pexelsApiKey?: string): ImageProvider {
  switch (config.image.provider) {
    case 'zimage':
    case 'z_image':
    case 'z-image':
    case 'kieai':
    case 'kie.ai':
      return new ZImageProvider(config.image);
    case 'claudegg_image':
    case 'claudegg-image':
    case 'nano-banana':
    case 'nano_banana':
      return new ClaudeGGImageProvider(config.image);
    case 'pexels':
    case 'pexels_photo':
      return new PexelsImageProvider(pexelsApiKey ?? process.env['PEXELS_API_KEY'] ?? '');
    case 'ddg':
    case 'ddg_image':
    case 'duckduckgo':
      return new DuckDuckGoImageProvider();
    case 'google':
    case 'google_image':
    case 'google_images':
      return new GoogleImageProvider(process.env['GOOGLE_COOKIES'] ?? '');
    default:
      throw new Error(`Unknown image provider: ${config.image.provider}`);
  }
}

// ── Audio duration helper ────────────────────────────────────────────────────

const execAsync = promisify(exec);

/** Probe audio duration in seconds using ffprobe */
async function probeAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const dur = parseFloat(stdout.trim());
    return isNaN(dur) ? 5 : dur;
  } catch {
    return 5; // fallback if ffprobe fails
  }
}

// ── Run directory ─────────────────────────────────────────────────────────────

export function createRunDir(outputBase: string = 'output'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(outputBase, `run_${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Script persistence ────────────────────────────────────────────────────────

export function saveScript(script: Script, runDir: string): string {
  const scriptPath = path.join(runDir, 'script.json');
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  return scriptPath;
}

export function loadScript(scriptPath: string): Script {
  return JSON.parse(fs.readFileSync(scriptPath, 'utf8')) as Script;
}

// ── Step 1: Generate script ───────────────────────────────────────────────────

/**
 * Parse user-supplied raw text directly into a Script — no LLM script generation.
 * The text is split into numSections chunks; LLM is called ONLY to produce image prompts.
 */
export async function parseRawTextToScript(
  config: AppConfig,
  rawText: string,
  numSections: number,
  opts: { imageStyle?: string; aspectRatio?: string; imagesPerSection?: number; mediaSource?: string } = {},
  log: (msg: string) => void = console.log,
): Promise<Script> {
  log('parsing raw text into script sections...');

  // Split into non-empty paragraphs
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Derive title from first line
  const firstLine = rawText.split('\n')[0].trim();
  const title = firstLine.length > 80 ? firstLine.substring(0, 80) + '…' : firstLine;

  // Group paragraphs into numSections chunks
  const effectiveSections = Math.max(1, Math.min(numSections, paragraphs.length));
  const chunkSize = Math.ceil(paragraphs.length / effectiveSections);
  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += chunkSize) {
    chunks.push(paragraphs.slice(i, i + chunkSize).join('\n\n'));
  }
  while (chunks.length < effectiveSections) {
    chunks.push('…');
  }

  const imagesPerSection = opts.imagesPerSection ?? 1;
  const imageStyle = opts.imageStyle ?? '';

  // For Pexels / DDG modes, skip LLM image prompt generation entirely.
  // These providers use the narration text directly as a search query.
  const isPexels = opts.mediaSource === 'pexels_photo' || opts.mediaSource === 'pexels_video' || opts.mediaSource === 'ddg_image';

  // Default: use first sentence of each chunk as the search/prompt text
  let imagePrompts: string[][] = chunks.map((chunk) => {
    const query = chunk.split(/[.\n]/)[0].trim().substring(0, 100) || 'nature scene';
    return Array(imagesPerSection).fill(query);
  });

  if (!isPexels) {
    // Generate cinematic image prompts via LLM — only needed for AI image generation
    log('generating image prompts for sections...');
    const apiKey = process.env[config.llm.api_key_env] ?? '';
    const model = config.llm.model ?? 'claude-sonnet-4-6';

    if (apiKey) {
      try {
        const { OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey, baseURL: 'https://claude.gg/v1' });
        const styleHint = imageStyle ? ` Style: ${imageStyle}.` : '';
        const sectionList = chunks
          .map((c, i) => `Section ${i + 1}: "${c.substring(0, 300)}"`)
          .join('\n\n');
        const completion = await client.chat.completions.create({
          model,
          max_tokens: 1200,
          messages: [{
            role: 'user',
            content:
              `For each section below, generate ${imagesPerSection} vivid cinematic image generation prompt(s).${styleHint}\n` +
              `Return ONLY a JSON array of arrays, one inner array per section, e.g.:\n` +
              `[["prompt1a","prompt1b"],["prompt2a"]]\n\n${sectionList}`,
          }],
        });
        const raw = completion.choices[0]?.message?.content ?? '[]';
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as string[][];
          imagePrompts = parsed.map((p, i) =>
            Array.isArray(p) && p.length > 0 ? p : imagePrompts[i],
          );
        }
      } catch (e) {
        log(`[warn] image prompt generation failed: ${String(e)}`);
      }
    }
  } else {
    log(`${opts.mediaSource} mode — skipping LLM image prompt generation, using section text as search queries`);
  }

  // Build Script object
  const sections = chunks.map((chunk, i) => ({
    number: i + 1,
    heading: `Bölüm ${i + 1}`,
    narration: chunk,
    image_prompt: imagePrompts[i]?.[0] ?? 'cinematic scene',
    image_prompts: imagePrompts[i] ?? ['cinematic scene'],
    audio_path: undefined,
    duration: undefined,
  }));

  const script = {
    title,
    intro_narration: '',
    intro_image_prompt: imagePrompts[0]?.[0] ?? 'cinematic opening scene',
    sections,
    outro_narration: '',
    outro_image_prompt: imagePrompts[imagePrompts.length - 1]?.[0] ?? 'cinematic closing scene',
  } as unknown as Script;

  log(`raw text parsed: "${title}" (${sections.length} sections)`);
  return script;
}

export async function generateScript(
  config: AppConfig,
  topic: string,
  numSections: number,
  opts: {
    subtitles?: string[];
    customInstructions?: string;
    rawText?: string;
    videoLength?: 'micro' | 'short' | 'medium' | 'long';
    scriptFormat?: string;
    imagesPerSection?: number;
    videosPerSection?: number;
    language?: 'en' | 'tr';
    mediaSource?: string;
  } = {},
  log: (msg: string) => void = console.log,
): Promise<Script> {
  log('step 1/4: generating script...');
  const llm = getLLMProvider(config);
  const imageStyle = config.image.extra?.['image_style'] ?? '';
  const imagesPerSection = opts.imagesPerSection ?? config.video.images_per_section ?? 1;
  const videosPerSection = opts.videosPerSection ?? config.video.videos_per_section ?? 1;

  const script = await llm.generateScript(topic, numSections, {
    subtitles: opts.subtitles,
    imageStyle,
    imagesPerSection,
    customInstructions: opts.customInstructions,
    rawText: opts.rawText,
    videoLength: opts.videoLength ?? 'medium',
    scriptFormat: opts.scriptFormat ?? 'listicle',
    videosPerSection,
    language: opts.language ?? 'en',
    mediaSource: opts.mediaSource ?? 'ai_generate',
  });

  log(`script done: "${script.title}" (${script.sections.length} sections)`);
  return script;
}

// ── Step 2: Generate voiceovers ───────────────────────────────────────────────

export async function generateVoiceovers(
  config: AppConfig,
  script: Script,
  runDir: string,
  log: (msg: string) => void = console.log,
  onProgress?: (script: Script) => void,
  language: 'en' | 'tr' = 'en',
  voiceId?: string,
  voiceProvider?: string,
): Promise<Script> {
  log(`step 2/4: generating voiceovers (lang=${language}, provider=${voiceProvider ?? 'auto'}${voiceId ? ', voice=' + voiceId : ''})...`);

  // For Google TTS, generate a style prompt via LLM based on the script content
  let stylePrompt: string | undefined;
  const isGoogleTts = voiceProvider === 'google_tts' || voiceProvider === 'google' ||
    (!voiceProvider && config.voice.provider === 'google_tts');
  if (isGoogleTts) {
    const claudeKey = process.env[config.llm.api_key_env] ?? '';
    const llmModel  = config.llm.model ?? 'claude-sonnet-4-5';
    if (claudeKey) {
      stylePrompt = await generateTtsStylePrompt(script, language, claudeKey, llmModel);
      log(`[tts] style prompt: "${stylePrompt}"`);
    }
  }

  const voice = getVoiceProvider(config, language, voiceId, voiceProvider, stylePrompt);
  const audioDir = path.join(runDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  type VoiceTask = { label: string; text: string; outputPath: string; assign: (dur: number) => void };
  const tasks: VoiceTask[] = [];

  // Intro — skip if text is empty (e.g. rawText mode)
  const introPath = path.join(audioDir, 'intro.mp3');
  if (script.intro_narration?.trim()) {
    if (!fs.existsSync(introPath)) {
      tasks.push({
        label: 'Intro',
        text: script.intro_narration,
        outputPath: introPath,
        assign: (dur) => { script.intro_audio_path = introPath; script.intro_duration = dur; },
      });
    } else {
      script.intro_audio_path = introPath;
      const dur = await probeAudioDuration(introPath);
      script.intro_duration = dur;
      log(`skip intro voice (exists, ${dur.toFixed(1)}s)`);
    }
  } else {
    log('skip intro voice (no text)');
  }

  // Sections
  for (const section of script.sections) {
    const secPath = path.join(audioDir, `section_${String(section.number).padStart(2, '0')}.mp3`);
    if (!fs.existsSync(secPath)) {
      const sec = section; // closure capture
      tasks.push({
        label: `Section ${section.number}`,
        text: section.narration,
        outputPath: secPath,
        assign: (dur) => { sec.audio_path = secPath; sec.duration = dur; },
      });
    } else {
      section.audio_path = secPath;
      // Probe existing audio for duration
      const dur = await probeAudioDuration(secPath);
      section.duration = dur;
      log(`skip section ${section.number} voice (exists, ${dur.toFixed(1)}s)`);
    }
  }

  // Outro — skip if text is empty
  const outroPath = path.join(audioDir, 'outro.mp3');
  if (script.outro_narration?.trim()) {
    if (!fs.existsSync(outroPath)) {
      tasks.push({
        label: 'Outro',
        text: script.outro_narration,
        outputPath: outroPath,
        assign: (dur) => { script.outro_audio_path = outroPath; script.outro_duration = dur; },
      });
    } else {
      script.outro_audio_path = outroPath;
      const dur = await probeAudioDuration(outroPath);
      script.outro_duration = dur;
      log(`skip outro voice (exists, ${dur.toFixed(1)}s)`);
    }
  } else {
    log('skip outro voice (no text)');
  }

  log(`launching ${tasks.length} voice task(s) in parallel...`);

  // Run all voice tasks in parallel
  let errors = 0;
  await Promise.all(
    tasks.map(async (task) => {
      try {
        log(`voice start: ${task.label}`);
        const [dur] = await voice.generateSpeech(task.text, task.outputPath);
        task.assign(dur);
        log(`voice done: ${task.label} (${dur.toFixed(1)}s)`);
        onProgress?.(script);
      } catch (e) {
        errors++;
        log(`voice error (${task.label}): ${e}`);
      }
    }),
  );

  if (errors) log(`voiceovers done with ${errors} error(s)`);
  else log('all voiceovers generated');
  return script;
}

// ── Step 3: Generate media (images) ──────────────────────────────────────────

export async function generateMedia(
  config: AppConfig,
  script: Script,
  runDir: string,
  log: (msg: string) => void = console.log,
  opts: { force?: boolean; aspectRatio?: string; mediaSource?: string; imagesPerSection?: number } = {},
  onProgress?: (script: Script) => void,
): Promise<Script> {
  log('step 3/4: generating media...');
  const pexelsKey = process.env['PEXELS_API_KEY'] ?? '';
  const isPexelsVideo = opts.mediaSource === 'pexels_video';
  const isPexelsPhoto = opts.mediaSource === 'pexels_photo';
  const isDdgImage = opts.mediaSource === 'ddg_image';
  const isGoogleImage = opts.mediaSource === 'google_image';
  let effectiveProvider = config.image.provider;
  if (isPexelsVideo) { log('media source: Pexels Video 🎬'); }
  else if (isPexelsPhoto) { effectiveProvider = 'pexels'; log('media source: Pexels Photos 📷'); }
  else if (isDdgImage) { effectiveProvider = 'ddg_image'; log('media source: DuckDuckGo Images 🦆'); }
  else if (isGoogleImage) { effectiveProvider = 'google_image'; log('media source: Google Images 🔍'); }
  else { log(`media source: AI Image Generation (${config.image.provider}) 🤖`); }
  const effectiveConfig = (isPexelsPhoto || isDdgImage || isGoogleImage)
    ? { ...config, image: { ...config.image, provider: effectiveProvider } }
    : config;
  const imageGen = getImageProvider(effectiveConfig, pexelsKey);
  const aspectRatio = opts.aspectRatio;
  const imagesDir = path.join(runDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  type ImgTask = { label: string; prompt: string; outputPath: string; assign: (p: string) => void };
  const tasks: ImgTask[] = [];

  const imagesPerSection = opts.imagesPerSection ?? config.video.images_per_section ?? 1;
  const forceRegen = opts.force ?? false;

  // Intro image(s)
  for (let idx = 0; idx < (config.video.intro_image_count ?? 1); idx++) {
    const suffix = idx === 0 ? '' : `_${String.fromCharCode(97 + idx)}`;
    const imgPath = path.join(imagesDir, `intro${suffix}.png`);
    if (script.intro_image_prompt && (forceRegen || !fs.existsSync(imgPath))) {
      const capturedIdx = idx;
      const capturedPath = imgPath;
      tasks.push({
        label: `Intro img ${idx + 1}`,
        prompt: script.intro_image_prompt,
        outputPath: imgPath,
        assign: (p) => {
          if (capturedIdx === 0) script.intro_image_path = p;
          if (!script.intro_image_paths.includes(p)) script.intro_image_paths.push(p);
          onProgress?.(script);
        },
      });
    } else if (fs.existsSync(imgPath)) {
      if (idx === 0) script.intro_image_path = imgPath;
      if (!script.intro_image_paths.includes(imgPath)) script.intro_image_paths.push(imgPath);
      log(`skip intro img ${idx + 1} (exists)`);
    }
  }

  // Section images
  for (const section of script.sections) {
    const prompts = section.image_prompts.length ? section.image_prompts : [section.image_prompt];
    const count = Math.min(prompts.length, imagesPerSection);
    for (let idx = 0; idx < count; idx++) {
      const suffix = idx === 0 ? '' : `_${String.fromCharCode(97 + idx)}`;
      const imgPath = path.join(imagesDir, `section_${String(section.number).padStart(2, '0')}${suffix}.png`);
      if (forceRegen || !fs.existsSync(imgPath)) {
        const sec = section;
        const capturedIdx = idx;
        const capturedPath = imgPath;
        tasks.push({
          label: `Section ${section.number} img ${idx + 1}`,
          prompt: prompts[idx] ?? prompts[0],
          outputPath: imgPath,
          assign: (p) => {
            if (capturedIdx === 0) sec.image_path = p;
            if (!sec.image_paths.includes(p)) sec.image_paths.push(p);
            onProgress?.(script);
          },
        });
      } else {
        if (idx === 0) section.image_path = imgPath;
        if (!section.image_paths.includes(imgPath)) section.image_paths.push(imgPath);
        log(`skip section ${section.number} img ${idx + 1} (exists)`);
      }
    }
  }

  // Outro image
  const outroImgPath = path.join(imagesDir, 'outro.png');
  if (script.outro_image_prompt && (forceRegen || !fs.existsSync(outroImgPath))) {
    tasks.push({
      label: 'Outro',
      prompt: script.outro_image_prompt,
      outputPath: outroImgPath,
      assign: (p) => { script.outro_image_path = p; onProgress?.(script); },
    });
  } else if (fs.existsSync(outroImgPath)) {
    script.outro_image_path = outroImgPath;
    log('skip outro image (exists)');
  }

  log(`launching ${tasks.length} image task(s) in parallel...`);
  let errors = 0;
  await Promise.all(
    tasks.map(async (task) => {
      try {
        log(`image start: ${task.label}`);
        let p: string;
        if (isPexelsVideo) {
          const videoPath = task.outputPath.replace(/\.\w+$/, '.mp4');
          p = await fetchPexelsVideo(pexelsKey, task.prompt, videoPath, aspectRatio);
        } else {
          p = await imageGen.generateImage(task.prompt, task.outputPath, aspectRatio);
        }
        task.assign(p);
        log(`image done: ${task.label}`);
      } catch (e) {
        errors++;
        log(`image error (${task.label}): ${e}`);
      }
    }),
  );

  if (errors) log(`media done with ${errors} error(s)`);
  else log('all media generated');
  return script;
}

// ── Step 2.5: Generate subtitles (STT via Lemonfox) ──────────────────────────

/**
 * Transcribe all voiceover files and store word-level timestamps into script.
 * Only runs when `LEMONFOX_API_KEY` is set and `config.video.captions_enabled` is true.
 */
export async function generateSubtitles(
  config: AppConfig,
  script: Script,
  log: (msg: string) => void = console.log,
  language: 'en' | 'tr' = 'en',
): Promise<void> {
  const apiKey = process.env['LEMONFOX_API_KEY'] ?? '';
  if (!apiKey) {
    log('[captions] LEMONFOX_API_KEY not set — skipping subtitles');
    return;
  }
  if (!config.video.captions_enabled) {
    log('[captions] captions_enabled=false — skipping subtitles');
    return;
  }

  log('[captions] step 2.5: generating subtitles (Lemonfox STT)...');
  const lfLang = toLemonfoxLang(language);

  // Helper: transcribe a file and return CaptionWord[] (or [] on error)
  async function transcribeFile(audioPath: string | undefined, label: string): Promise<import('./models.js').CaptionWord[]> {
    if (!audioPath || !fs.existsSync(audioPath)) return [];
    try {
      const transcript = await transcribeAudio(audioPath, lfLang, apiKey);
      // Flatten all word-level timestamps across segments
      const words: import('./models.js').CaptionWord[] = [];
      for (const seg of transcript.segments ?? []) {
        for (const w of seg.words ?? []) {
          words.push({ word: w.word, start: w.start, end: w.end });
        }
      }
      log(`[captions] ${label}: ${words.length} words transcribed`);
      return words;
    } catch (e) {
      log(`[captions] warn: ${label} transcription failed: ${e}`);
      return [];
    }
  }

  // Intro
  if (script.intro_audio_path) {
    const words = await transcribeFile(script.intro_audio_path, 'intro');
    script.intro_captions = words.length > 0 ? [{ text: words.map(w => w.word).join(' '), start: words[0].start, end: words[words.length - 1].end, words }] : [];
  }

  // Sections
  for (const section of script.sections) {
    const words = await transcribeFile(section.audio_path, `section_${section.number}`);
    section.captions = words.length > 0 ? [{ text: words.map(w => w.word).join(' '), start: words[0].start, end: words[words.length - 1].end, words }] : [];
  }

  // Outro
  if (script.outro_audio_path) {
    const words = await transcribeFile(script.outro_audio_path, 'outro');
    script.outro_captions = words.length > 0 ? [{ text: words.map(w => w.word).join(' '), start: words[0].start, end: words[words.length - 1].end, words }] : [];
  }

  log('[captions] subtitles done');
}

// ── Step 4: Assemble video ────────────────────────────────────────────────────

export async function assembleVideo(
  config: AppConfig,
  script: Script,
  runDir: string,
  log: (msg: string) => void = console.log,
  aspectRatio = '16:9',
): Promise<string> {
  log('step 4/4: assembling video...');
  const outputPath = path.join(runDir, 'final_video.mp4');
  await composeVideo(script, config.video, outputPath, log, aspectRatio);
  return outputPath;
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

export async function runFullPipeline(
  config: AppConfig,
  topic: string,
  numSections: number,
  outputBase: string = 'output',
  opts: {
    scriptFormat?: string;
    videoLength?: 'micro' | 'short' | 'medium' | 'long';
    customInstructions?: string;
    subtitles?: string[];
  } = {},
  log: (msg: string) => void = console.log,
  onProgress?: (script: Script) => void,
): Promise<{ videoPath: string; script: Script; runDir: string }> {
  const runDir = createRunDir(outputBase);
  log(`run directory: ${runDir}`);

  // Step 1
  const script = await generateScript(config, topic, numSections, opts, log);
  saveScript(script, runDir);

  // Step 2
  await generateVoiceovers(config, script, runDir, log, onProgress);
  saveScript(script, runDir);

  // Step 3
  await generateMedia(config, script, runDir, log, {}, onProgress);
  saveScript(script, runDir);

  // Step 4
  const videoPath = await assembleVideo(config, script, runDir, log);

  log(`pipeline complete! video: ${videoPath}`);
  return { videoPath, script, runDir };
}

// ── Re-assemble only ──────────────────────────────────────────────────────────

export async function runAssembleOnly(
  config: AppConfig,
  scriptPath: string,
  log: (msg: string) => void = console.log,
): Promise<string> {
  const script = loadScript(scriptPath);
  const runDir = path.dirname(scriptPath);
  log(`re-assembling: "${script.title}"`);
  const videoPath = await assembleVideo(config, script, runDir, log);
  log(`assembly complete: ${videoPath}`);
  return videoPath;
}

// ── Regenerate single image ───────────────────────────────────────────────────

export async function regenerateSingleImage(
  config: AppConfig,
  prompt: string,
  outputPath: string,
  log: (msg: string) => void = console.log,
  mediaSource?: string,
): Promise<string> {
  // Resolve config with correct provider based on mediaSource
  let effectiveConfig = config;
  if (mediaSource === 'pexels_photo') {
    effectiveConfig = { ...config, image: { ...config.image, provider: 'pexels' as const } };
  } else if (mediaSource === 'ddg_image') {
    effectiveConfig = { ...config, image: { ...config.image, provider: 'ddg_image' as const } };
  } else if (mediaSource === 'google_image' || mediaSource === 'google_images') {
    effectiveConfig = { ...config, image: { ...config.image, provider: 'google_image' as const } };
  }

  const pexelsKey = process.env['PEXELS_API_KEY'] ?? '';
  const imageGen = getImageProvider(effectiveConfig, pexelsKey);
  log(`regenerating image: ${path.basename(outputPath)}`);
  const p = await imageGen.generateImage(prompt, outputPath);
  log(`image regenerated: ${path.basename(outputPath)}`);
  return p;
}