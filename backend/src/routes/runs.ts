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
    const checkDone = setInterval(() => {
      const r = getRun(runId);
      if (!r || r.status === 'done' || r.status === 'error') {
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
  //         subtitles?, language?, aspectRatio?, voiceId?, voiceProvider? }
  router.post('/', (req: Request, res: Response) => {
    const {
      topic,
      numSections = 5,
      scriptFormat = 'listicle',
      videoLength = 'medium',
      customInstructions,
      subtitles,
      language = 'en',
      aspectRatio = '16:9',
      voiceId,
      voiceProvider,
      useGpu,
      gpuEncoder,
      imageModel,
    } = req.body as {
      topic?: string;
      numSections?: number;
      scriptFormat?: string;
      videoLength?: string;
      customInstructions?: string;
      subtitles?: string[];
      language?: 'en' | 'tr';
      aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      voiceId?: string;
      voiceProvider?: string;
      useGpu?: boolean;
      gpuEncoder?: 'nvenc' | 'amf' | 'qsv';
      imageModel?: 'kie' | 'nano-banana';
    };

    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const run = createRun({
      topic,
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
      subtitles,
      language,
      aspectRatio,
      voiceId,
      voiceProvider,
      useGpu,
      gpuEncoder,
      imageModel,
    });

    return res.status(202).json(run);
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

async function runPipeline(
  run: RunState,
  config: AppConfig,
  outputBase: string,
  opts: {
    scriptFormat?: string;
    videoLength?: 'micro' | 'short' | 'medium' | 'long';
    customInstructions?: string;
    subtitles?: string[];
    language?: 'en' | 'tr';
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
    voiceId?: string;
    voiceProvider?: string;
    useGpu?: boolean;
    gpuEncoder?: 'nvenc' | 'amf' | 'qsv';
    imageModel?: 'kie' | 'nano-banana';
  },
): Promise<void> {
  const log = makeLogger(run.id);
  updateRun(run.id, { status: 'running' });

  try {
    const runDir = createRunDir(outputBase);
    updateRun(run.id, { outputDir: runDir });
    log(`run directory: ${runDir}`);

    // Step 1: Script
    const script = await generateScript(config, run.topic, run.numSections, opts, log);
    saveScript(script, runDir);
    updateRun(run.id, { script });
    log('script saved');

    // Step 2: Voiceovers
    await generateVoiceovers(config, script, runDir, log, (s) => {
      updateRun(run.id, { script: s });
    }, opts.language ?? 'en', opts.voiceId, opts.voiceProvider);
    saveScript(script, runDir);

    // Step 3: Media — inject imageModel + aspectRatio
    const imageConfig = opts.imageModel === 'nano-banana'
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

    await generateMedia(imageConfig, script, runDir, log, { aspectRatio: opts.aspectRatio }, (s) => {
      updateRun(run.id, { script: s });
    });
    saveScript(script, runDir);
    updateRun(run.id, { script });

    // Step 2.5: Subtitles (optional, only when LEMONFOX_API_KEY is set)
    await generateSubtitles(config, script, log, opts.language ?? 'en');
    saveScript(script, runDir);
    updateRun(run.id, { script });

    // Step 4: Assemble — inject GPU settings + aspectRatio
    const gpuConfig = {
      ...config,
      video: {
        ...config.video,
        use_gpu:     opts.useGpu     ?? false,
        gpu_encoder: opts.gpuEncoder ?? undefined,
      },
    };
    const videoPath = await assembleVideo(gpuConfig, script, runDir, log, opts.aspectRatio ?? '16:9');
    updateRun(run.id, { status: 'done', videoPath, script });
    log(`done! video: ${videoPath}`);
  } catch (e) {
    const errMsg = String(e);
    log(`PIPELINE ERROR: ${errMsg}`);
    updateRun(run.id, { status: 'error', error: errMsg });
  }
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