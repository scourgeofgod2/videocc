// REST API + SSE routes for video generation runs
// Mounts at /api/runs

import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {
  createRun,
  getRun,
  getAllRuns,
  updateRun,
  deleteRun,
  makeLogger,
  subscribeToLogs,
  type RunState,
  type PipelineOpts,
} from '../state.js';
import {
  generateScript,
  generateVoiceovers,
  generateMedia,
  generateSubtitles,
  assembleVideo,
  createRunDir,
  saveScript,
  loadScript,
  regenerateSingleImage,
} from '../pipeline.js';
import type { AppConfig } from '../models.js';
import { defaultVideoConfig } from '../models.js';
import { getAvailableFormats } from '../prompts/formatPrompts.js';
import { GOOGLE_TTS_VOICES } from '../providers/googleTtsProvider.js';

export function runsRouter(config: AppConfig): Router {
  const router = Router();

  // ── GET /api/runs ─────────────────────────────────────────────────────────
  router.get('/', (_req: Request, res: Response) => {
    res.json({ runs: getAllRuns() });
  });

  // ── GET /api/runs/formats ─────────────────────────────────────────────────
  router.get('/formats', (_req: Request, res: Response) => {
    res.json({ formats: getAvailableFormats() });
  });

  // ── GET /api/runs/voices/google ───────────────────────────────────────────
  router.get('/voices/google', (_req: Request, res: Response) => {
    res.json({ voices: GOOGLE_TTS_VOICES });
  });

  // ── GET /api/runs/ideas?topic=&format=&language= ─────────────────────────
  router.get('/ideas', async (req: Request, res: Response) => {
    const topic = String(req.query['topic'] ?? '').trim();
    const format = String(req.query['format'] ?? 'listicle');
    const language = String(req.query['language'] ?? 'en');
    const apiKey = process.env[config.llm.api_key_env] ?? '';
    const model = config.llm.model ?? 'claude-sonnet-4-6';

    if (!topic || !apiKey) {
      return res.json({ ideas: [] });
    }

    const langHint = language === 'tr' ? 'Turkish' : 'English';
    const prompt =
      `Generate 6 creative, specific, clickbait-style YouTube video topic ideas inspired by "${topic}". ` +
      `Format: ${format}. Language: ${langHint}. ` +
      `Return ONLY a JSON array of 6 strings, nothing else. Example: ["idea 1","idea 2","idea 3","idea 4","idea 5","idea 6"]`;

    try {
      const { OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, baseURL: 'https://claude.gg/v1' });
      const completion = await client.chat.completions.create({
        model,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = completion.choices[0]?.message?.content ?? '[]';
      // Parse JSON array
      const match = raw.match(/\[[\s\S]*\]/);
      const ideas = match ? JSON.parse(match[0]) as string[] : [];
      return res.json({ ideas });
    } catch (e) {
      console.error('[ideas]', e);
      return res.json({ ideas: [] });
    }
  });

  // ── GET /api/runs/:id ─────────────────────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(run);
  });

  // ── GET /api/runs/:id/logs (SSE stream) ───────────────────────────────────
  router.get('/:id/logs', (req: Request, res: Response) => {
    const runId = req.params['id'];
    const run = getRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send existing logs
    for (const line of run.logs) {
      res.write(`data: ${JSON.stringify({ log: line })}\n\n`);
    }

    // If already done/error, close immediately
    if (run.status === 'done' || run.status === 'error') {
      res.write(`data: ${JSON.stringify({ done: true, status: run.status })}\n\n`);
      res.end();
      return;
    }

    // Subscribe to future logs
    const unsubscribe = subscribeToLogs(runId, (line: string) => {
      res.write(`data: ${JSON.stringify({ log: line })}\n\n`);
    });

    // Poll for completion and send done event
    // Also fires when reaching awaiting_approval or awaiting_image_approval
    const PAUSE_STATUSES = new Set(['done', 'error', 'awaiting_approval', 'awaiting_image_approval']);
    const checkDone = setInterval(() => {
      const r = getRun(runId);
      if (!r || PAUSE_STATUSES.has(r.status)) {
        clearInterval(checkDone);
        unsubscribe();
        res.write(`data: ${JSON.stringify({ done: true, status: r?.status ?? 'error' })}\n\n`);
        res.end();
      }
    }, 1000);

    req.on('close', () => {
      clearInterval(checkDone);
      unsubscribe();
    });

    return;
  });

  // ── POST /api/runs ────────────────────────────────────────────────────────
  // Body: { topic, numSections, scriptFormat?, videoLength?, customInstructions?,
  //         subtitles?, language?, aspectRatio?, voiceId?, voiceProvider?,
  //         captionFont?, captionFontSize?, captionTextColor?, captionActiveColor?,
  //         captionBgColor?, captionBgOpacity?, captionUppercase?, captionPosition? }
  router.post('/', (req: Request, res: Response) => {
    const {
      topic,
      numSections = 5,
      scriptFormat = 'listicle',
      videoLength = 'medium',
      customInstructions,
      rawText,
      subtitles,
      language = 'en',
      aspectRatio = '16:9',
      voiceId,
      voiceProvider,
      useGpu,
      gpuEncoder,
      imageModel,
      imagesPerSection,
      mediaSource,
      captionFont,
      captionFontSize,
      captionTextColor,
      captionActiveColor,
      captionBgColor,
      captionBgOpacity,
      captionUppercase,
      captionPosition,
    } = req.body as {
      topic?: string;
      numSections?: number;
      scriptFormat?: string;
      videoLength?: string;
      customInstructions?: string;
      rawText?: string;
      subtitles?: string[];
      language?: 'en' | 'tr';
      aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      voiceId?: string;
      voiceProvider?: string;
      useGpu?: boolean;
      gpuEncoder?: 'nvenc' | 'amf' | 'qsv';
      imageModel?: 'kie' | 'nano-banana';
      imagesPerSection?: number;
      mediaSource?: 'ai_generate' | 'pexels_photo' | 'pexels_video' | 'ddg_image' | 'google_image';
      captionFont?: string;
      captionFontSize?: number;
      captionTextColor?: string;
      captionActiveColor?: string;
      captionBgColor?: string;
      captionBgOpacity?: number;
      captionUppercase?: boolean;
      captionPosition?: number;
    };

    // In rawText mode, topic is derived from the first line of the text if not provided
    const effectiveTopic = topic?.trim()
      ? topic.trim()
      : rawText
        ? rawText.split('\n')[0].trim().substring(0, 120) || 'Raw Text'
        : undefined;
    if (!effectiveTopic) return res.status(400).json({ error: 'topic or rawText is required' });

    const run = createRun({
      topic: effectiveTopic,
      numSections: Number(numSections),
      scriptFormat,
      videoLength,
      language,
      aspectRatio,
      voiceId,
    });

    // Start pipeline asynchronously
    const outputBase = process.env['OUTPUT_DIR'] ?? 'output';
    void runPipeline(run, config, outputBase, {
      scriptFormat,
      videoLength: videoLength as 'micro' | 'short' | 'medium' | 'long',
      customInstructions,
      rawText,
      subtitles,
      language,
      aspectRatio,
      voiceId,
      voiceProvider,
      useGpu,
      gpuEncoder,
      imageModel,
      imagesPerSection: imagesPerSection ? Number(imagesPerSection) : undefined,
      mediaSource,
      captionFont,
      captionFontSize,
      captionTextColor,
      captionActiveColor,
      captionBgColor,
      captionBgOpacity,
      captionUppercase,
      captionPosition,
    });

    return res.status(202).json(run);
  });

  // ── POST /api/runs/:id/approve-script ────────────────────────────────────
  router.post('/:id/approve-script', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Run is not awaiting script approval' });
    }
    if (!run.outputDir || !run.script) {
      return res.status(400).json({ error: 'No script to approve' });
    }
    const outputBase = process.env['OUTPUT_DIR'] ?? 'output';
    const opts = run.pipelineOpts ?? {};
    updateRun(run.id, { status: 'running' });
    void runProductionPhase(run, config, outputBase, opts);
    return res.status(202).json(getRun(run.id));
  });

  // ── POST /api/runs/:id/regenerate-script ─────────────────────────────────
  router.post('/:id/regenerate-script', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Run is not awaiting script approval' });
    }
    const outputBase = process.env['OUTPUT_DIR'] ?? 'output';
    const opts = run.pipelineOpts ?? {};
    updateRun(run.id, { status: 'running', script: undefined, error: undefined });
    void runScriptPhase(run, config, outputBase, opts);
    return res.status(202).json(getRun(run.id));
  });

  // ── POST /api/runs/:id/approve-images ───────────────────────────────────
  router.post('/:id/approve-images', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'awaiting_image_approval') {
      return res.status(400).json({ error: 'Run is not awaiting image approval' });
    }
    if (!run.outputDir || !run.script) {
      return res.status(400).json({ error: 'No images to approve' });
    }
    const outputBase = process.env['OUTPUT_DIR'] ?? 'output';
    const opts = run.pipelineOpts ?? {};
    updateRun(run.id, { status: 'running' });
    void runFinalPhase(run, config, outputBase, opts);
    return res.status(202).json(getRun(run.id));
  });

  // ── POST /api/runs/:id/regenerate-images ─────────────────────────────────
  router.post('/:id/regenerate-images', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'awaiting_image_approval') {
      return res.status(400).json({ error: 'Run is not awaiting image approval' });
    }
    const outputBase = process.env['OUTPUT_DIR'] ?? 'output';
    const opts = run.pipelineOpts ?? {};
    // Delete existing images so they get re-generated
    if (run.outputDir) {
      const imgDir = path.join(run.outputDir, 'images');
      if (fs.existsSync(imgDir)) {
        for (const f of fs.readdirSync(imgDir)) {
          fs.unlinkSync(path.join(imgDir, f));
        }
      }
    }
    updateRun(run.id, { status: 'running' });
    void runVoiceoverMediaPhase(run, config, outputBase, opts);
    return res.status(202).json(getRun(run.id));
  });

  // ── GET /api/runs/:id/images ──────────────────────────────────────────────
  // Returns a list of all generated image filenames for this run
  router.get('/:id/images', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!run.outputDir) return res.json({ images: [] });

    const imgDir = path.join(run.outputDir, 'images');
    if (!fs.existsSync(imgDir)) return res.json({ images: [] });

    const images = fs.readdirSync(imgDir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => `/api/runs/${run.id}/images/${f}`);
    return res.json({ images });
  });

  // ── GET /api/runs/:id/images/:filename ───────────────────────────────────
  router.get('/:id/images/:filename', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run || !run.outputDir) return res.status(404).json({ error: 'Not found' });

    const filename = path.basename(req.params['filename']); // prevent path traversal
    const imgPath = path.join(run.outputDir, 'images', filename);
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Image not found' });

    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(imgPath).pipe(res);
    return;
  });

  // ── POST /api/runs/:id/images/:filename/regenerate ───────────────────────
  // Regenerate a single image by filename (e.g. "intro.png", "section_01.png")
  router.post('/:id/images/:filename/regenerate', async (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!run.outputDir || !run.script) return res.status(400).json({ error: 'No script/outputDir' });

    const filename = path.basename(req.params['filename']);
    const imgPath = path.join(run.outputDir, 'images', filename);
    const script = run.script;

    // Derive prompt from filename
    let prompt: string | undefined;
    if (filename.startsWith('intro')) {
      prompt = script.intro_image_prompt;
    } else if (filename.startsWith('outro')) {
      prompt = script.outro_image_prompt;
    } else if (filename.startsWith('section_')) {
      // section_01.png → section number 1, section_01_b.png → idx b
      const m = filename.match(/^section_(\d+)(?:_([a-z]))?\.(?:png|jpg|jpeg|webp)$/i);
      if (m) {
        const sectionNum = parseInt(m[1], 10);
        const imgIdx = m[2] ? m[2].charCodeAt(0) - 97 : 0;
        const sec = script.sections.find((s: { number: number }) => s.number === sectionNum);
        if (sec) {
          const prompts: string[] = (sec.image_prompts?.length ? sec.image_prompts : [sec.image_prompt]) as string[];
          prompt = prompts[imgIdx] ?? prompts[0];
        }
      }
    }

    if (!prompt) return res.status(400).json({ error: 'Could not find prompt for image: ' + filename });

    const cfg = makeImageConfig(config, run.pipelineOpts ?? {});
    const log = makeLogger(run.id);
    try {
      await regenerateSingleImage(cfg, prompt, imgPath, log, run.pipelineOpts?.mediaSource);
      const url = `/api/runs/${run.id}/images/${filename}`;
      return res.json({ url, filename });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // ── POST /api/runs/:id/reassemble ─────────────────────────────────────────
  router.post('/:id/reassemble', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!run.outputDir) return res.status(400).json({ error: 'No output directory' });

    const scriptPath = path.join(run.outputDir, 'script.json');
    if (!fs.existsSync(scriptPath)) return res.status(400).json({ error: 'script.json not found' });

    const aspectRatio = (req.body as Record<string, string>)?.['aspectRatio'] ?? '16:9';
    updateRun(run.id, { status: 'running' });
    void reassembleRun(run, config, scriptPath, aspectRatio);

    return res.status(202).json(getRun(run.id));
  });

  // ── PUT /api/runs/:id/script ──────────────────────────────────────────────
  // Allows editing the script JSON and saving it back
  router.put('/:id/script', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!run.outputDir) return res.status(400).json({ error: 'No output directory' });

    const script = req.body;
    if (!script) return res.status(400).json({ error: 'script body required' });

    try {
      const scriptPath = path.join(run.outputDir, 'script.json');
      fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
      updateRun(run.id, { script });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // ── DELETE /api/runs/:id ──────────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    const deleted = deleteRun(req.params['id']);
    if (!deleted) return res.status(404).json({ error: 'Run not found' });
    return res.json({ ok: true });
  });

  // ── GET /api/runs/:id/video ───────────────────────────────────────────────
  // Stream the final video file
  router.get('/:id/video', (req: Request, res: Response) => {
    const run = getRun(req.params['id']);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!run.videoPath || !fs.existsSync(run.videoPath)) {
      return res.status(404).json({ error: 'Video not ready' });
    }

    const stat = fs.statSync(run.videoPath);
    const fileSize = stat.size;
    const range = req.headers['range'];

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(run.videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(run.videoPath).pipe(res);
    }

    return;
  });

  return router;
}

// ── Pipeline orchestration ────────────────────────────────────────────────────

/** Phase 1: Generate script → pause at awaiting_approval (or skip if rawText provided) */
async function runScriptPhase(
  run: RunState,
  config: AppConfig,
  outputBase: string,
  opts: PipelineOpts,
): Promise<void> {
  const log = makeLogger(run.id);
  updateRun(run.id, { status: 'running' });

  try {
    // Ensure runDir exists (may already be set if regenerating)
    let runDir = run.outputDir;
    if (!runDir) {
      runDir = createRunDir(outputBase);
      updateRun(run.id, { outputDir: runDir });
    }
    log(`run directory: ${runDir}`);

    if (opts.rawText) {
      // rawText mode: send raw text to LLM so it generates intro/outro + image prompts
      // then skip approval and go straight to production
      log('raw text mode — sending text to LLM for intro/outro + image prompts...');
      const script = await generateScript(config, run.topic, run.numSections, {
        rawText: opts.rawText,
        scriptFormat: opts.scriptFormat,
        imagesPerSection: opts.imagesPerSection,
        language: opts.language,
        mediaSource: opts.mediaSource,
      }, log);
      saveScript(script, runDir);
      updateRun(run.id, { script, outputDir: runDir, pipelineOpts: opts });
      log('✅ Raw text processed — skipping script approval, moving to production');
      // Skip awaiting_approval — go straight to voiceovers + media
      await runVoiceoverMediaPhase(run, config, outputBase, opts);
    } else {
      log('generating script...');
      const script = await generateScript(config, run.topic, run.numSections, opts, log);
      saveScript(script, runDir);
      // Pause — waiting for user approval
      updateRun(run.id, { script, status: 'awaiting_approval', pipelineOpts: opts });
      log('✅ Script ready — awaiting approval');
    }
  } catch (e) {
    const errMsg = String(e);
    log(`SCRIPT ERROR: ${errMsg}`);
    updateRun(run.id, { status: 'error', error: errMsg });
  }
}

/** Helper: build image config from opts */
function makeImageConfig(config: AppConfig, opts: PipelineOpts): AppConfig {
  if (
    opts.mediaSource === 'pexels_photo' ||
    opts.mediaSource === 'pexels_video' ||
    opts.mediaSource === 'ddg_image' ||
    opts.mediaSource === 'google_image'
  ) {
    // Pexels / DDG / Google modes — provider is handled dynamically in generateMedia; just pass base config
    return config;
  }
  return opts.imageModel === 'nano-banana'
    ? {
        ...config,
        image: {
          ...config.image,
          provider: 'claudegg_image' as const,
          api_key_env: 'CLAUDEGG_API_KEY',
          model: 'nano-banana-pro-flash',
          extra: { ...config.image.extra, aspect_ratio: opts.aspectRatio ?? '16:9' },
        },
      }
    : config;
}

/** Helper: build GPU config from opts */
function makeGpuConfig(config: AppConfig, opts: PipelineOpts): AppConfig {
  return {
    ...config,
    video: {
      ...config.video,
      use_gpu:              opts.useGpu              ?? false,
      gpu_encoder:          opts.gpuEncoder          ?? undefined,
      caption_font:         opts.captionFont         ?? config.video.caption_font,
      caption_font_size:    opts.captionFontSize      ?? config.video.caption_font_size,
      caption_text_color:   opts.captionTextColor    ?? config.video.caption_text_color,
      caption_active_color: opts.captionActiveColor  ?? config.video.caption_active_color,
      caption_bg_color:     opts.captionBgColor      ?? config.video.caption_bg_color,
      caption_bg_opacity:   opts.captionBgOpacity    ?? config.video.caption_bg_opacity,
      caption_uppercase:    opts.captionUppercase     ?? config.video.caption_uppercase,
      caption_position:     opts.captionPosition     ?? config.video.caption_position,
    },
  };
}

/** Phase 2a: Voiceovers + Media → pause at awaiting_image_approval */
async function runVoiceoverMediaPhase(
  run: RunState,
  config: AppConfig,
  _outputBase: string,
  opts: PipelineOpts,
): Promise<void> {
  const log = makeLogger(run.id);
  updateRun(run.id, { status: 'running' });

  try {
    const runDir = run.outputDir!;
    const script = run.script!;

    // Step 2: Voiceovers
    log('generating voiceovers...');
    await generateVoiceovers(config, script, runDir, log, (s) => {
      updateRun(run.id, { script: s });
    }, opts.language ?? 'en', opts.voiceId, opts.voiceProvider);
    saveScript(script, runDir);

    // Step 3: Media
    log('generating media...');
    const imageConfig = makeImageConfig(config, opts);
    await generateMedia(imageConfig, script, runDir, log, { aspectRatio: opts.aspectRatio, mediaSource: opts.mediaSource, imagesPerSection: opts.imagesPerSection }, (s) => {
      updateRun(run.id, { script: s });
    });
    saveScript(script, runDir);

    // Pause — waiting for image approval
    updateRun(run.id, { script, status: 'awaiting_image_approval', pipelineOpts: opts });
    log('✅ Görseller hazır — onayınızı bekliyoruz');
  } catch (e) {
    const errMsg = String(e);
    log(`MEDIA ERROR: ${errMsg}`);
    updateRun(run.id, { status: 'error', error: errMsg });
  }
}

/** Phase 2b: Subtitles + Assemble → done */
async function runFinalPhase(
  run: RunState,
  config: AppConfig,
  _outputBase: string,
  opts: PipelineOpts,
): Promise<void> {
  const log = makeLogger(run.id);
  updateRun(run.id, { status: 'running' });

  try {
    const runDir = run.outputDir!;
    const script = run.script!;

    // Step 3.5: Subtitles
    log('generating subtitles...');
    await generateSubtitles(config, script, log, opts.language ?? 'en');
    saveScript(script, runDir);
    updateRun(run.id, { script });

    // Step 4: Assemble
    log('assembling video...');
    const gpuConfig = makeGpuConfig(config, opts);
    const videoPath = await assembleVideo(gpuConfig, script, runDir, log, opts.aspectRatio ?? '16:9');
    updateRun(run.id, { status: 'done', videoPath, script });
    log(`done! video: ${videoPath}`);
  } catch (e) {
    const errMsg = String(e);
    log(`PIPELINE ERROR: ${errMsg}`);
    updateRun(run.id, { status: 'error', error: errMsg });
  }
}

/** Phase 2 (combined, for approve-script flow): Voiceovers → Media → pause at image approval */
async function runProductionPhase(
  run: RunState,
  config: AppConfig,
  outputBase: string,
  opts: PipelineOpts,
): Promise<void> {
  return runVoiceoverMediaPhase(run, config, outputBase, opts);
}

/** Entry point: starts with script phase only */
async function runPipeline(
  run: RunState,
  config: AppConfig,
  outputBase: string,
  opts: PipelineOpts,
): Promise<void> {
  return runScriptPhase(run, config, outputBase, opts);
}

async function reassembleRun(
  run: RunState,
  config: AppConfig,
  scriptPath: string,
  aspectRatio = '16:9',
): Promise<void> {
  const log = makeLogger(run.id);
  try {
    const script = loadScript(scriptPath);
    const videoPath = await assembleVideo(config, script, run.outputDir!, log, aspectRatio);
    updateRun(run.id, { status: 'done', videoPath, script });
    log(`reassembly done: ${videoPath}`);
  } catch (e) {
    const errMsg = String(e);
    log(`REASSEMBLE ERROR: ${errMsg}`);
    updateRun(run.id, { status: 'error', error: errMsg });
  }
}