// Clipmatic Backend — Express server entry point
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { runsRouter } from './routes/runs.js';
import { loadPersistedState } from './state.js';
import type { AppConfig } from './models.js';
import { defaultVideoConfig } from './models.js';

// ── Config ────────────────────────────────────────────────────────────────────

function buildConfig(): AppConfig {
  return {
    llm: {
      provider: 'claudegg',
      api_key_env: 'CLAUDEGG_API_KEY',
      model: process.env['CLAUDEGG_MODEL'] ?? 'claude-sonnet-4-6',
      extra: {},
    },
    voice: {
      provider: 'inworld',
      api_key_env: 'INWORLD_API_KEY',
      voice_id: process.env['INWORLD_VOICE_ID'] ?? 'Graham',
      model: process.env['INWORLD_MODEL'] ?? 'inworld-tts-1',
      extra: {
        audioEncoding: 'MP3',
        sampleRateHertz: '24000',
      },
    },
    image: {
      provider: 'zimage',
      api_key_env: 'ZIMAGE_API_KEY',
      model: process.env['ZIMAGE_MODEL'] ?? 'z-image',
      extra: {
        aspect_ratio: '16:9',
        image_style: process.env['IMAGE_STYLE'] ?? '',
      },
    },
    video: {
      ...defaultVideoConfig(),
      images_per_section: parseInt(process.env['IMAGES_PER_SECTION'] ?? '1', 10),
      videos_per_section: parseInt(process.env['VIDEOS_PER_SECTION'] ?? '1', 10),
      transition: process.env['VIDEO_TRANSITION'] ?? 'crossfade',
      transition_duration: parseFloat(process.env['TRANSITION_DURATION'] ?? '0.5'),
    },
  };
}

// ── Server ────────────────────────────────────────────────────────────────────

async function main() {
  const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
  const OUTPUT_DIR = process.env['OUTPUT_DIR'] ?? 'output';

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load persisted run state
  loadPersistedState();

  const config = buildConfig();
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(cors({
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── API routes ──────────────────────────────────────────────────────────────
  app.use('/api/runs', runsRouter(config));

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      providers: {
        llm: config.llm.provider,
        voice: config.voice.provider,
        image: config.image.provider,
      },
    });
  });

  // ── Static output files ─────────────────────────────────────────────────────
  // Serve generated videos/images from the output directory
  app.use('/output', express.static(path.resolve(OUTPUT_DIR)));

  // ── Frontend static serving ─────────────────────────────────────────────────
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`[server] serving frontend from ${frontendDist}`);
  } else {
    app.get('/', (_req, res) => {
      res.json({
        message: 'Clipmatic Backend API',
        docs: 'POST /api/runs to start a video generation run',
      });
    });
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`\n🎬 Clipmatic Backend running on http://localhost:${PORT}`);
    console.log(`   LLM:   ${config.llm.provider} (${config.llm.model})`);
    console.log(`   Voice: ${config.voice.provider} (${config.voice.voice_id})`);
    console.log(`   Image: ${config.image.provider} (${config.image.model})`);
    console.log(`   Output: ${path.resolve(OUTPUT_DIR)}\n`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});