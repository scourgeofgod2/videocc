// RunState store — in-memory + disk persistence
// Ports the concept from Python pipeline.py run tracking

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Script } from './models.js';

export type RunStatus = 'pending' | 'running' | 'done' | 'error';

export interface RunState {
  id: string;
  status: RunStatus;
  topic: string;
  numSections: number;
  scriptFormat: string;
  videoLength: string;
  language: 'en' | 'tr';
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  voiceId?: string;
  script?: Script;
  outputDir?: string;
  videoPath?: string;
  error?: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const runs = new Map<string, RunState>();

// ── SSE subscribers: runId → set of writer callbacks ─────────────────────────

type LogWriter = (msg: string) => void;
const logSubscribers = new Map<string, Set<LogWriter>>();

export function subscribeToLogs(runId: string, writer: LogWriter): () => void {
  if (!logSubscribers.has(runId)) logSubscribers.set(runId, new Set());
  logSubscribers.get(runId)!.add(writer);
  return () => logSubscribers.get(runId)?.delete(writer);
}

// ── State directory ───────────────────────────────────────────────────────────

const OUTPUT_BASE = process.env['OUTPUT_DIR'] ?? 'output';
const STATE_FILE = path.join(OUTPUT_BASE, 'state.json');

function persistState(): void {
  try {
    fs.mkdirSync(OUTPUT_BASE, { recursive: true });
    const arr = Array.from(runs.values());
    fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[state] persist error:', e);
  }
}

export function loadPersistedState(): void {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const arr = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as RunState[];
    for (const run of arr) {
      // Mark any "running" runs from before restart as error
      if (run.status === 'running') {
        run.status = 'error';
        run.error = 'Server restarted while running';
        run.logs.push('[state] Run interrupted by server restart');
      }
      runs.set(run.id, run);
    }
    console.log(`[state] loaded ${runs.size} run(s) from disk`);
  } catch (e) {
    console.error('[state] load error:', e);
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createRun(opts: {
  topic: string;
  numSections: number;
  scriptFormat?: string;
  videoLength?: string;
  language?: 'en' | 'tr';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  voiceId?: string;
}): RunState {
  const id = uuidv4();
  const now = new Date().toISOString();
  const run: RunState = {
    id,
    status: 'pending',
    topic: opts.topic,
    numSections: opts.numSections,
    scriptFormat: opts.scriptFormat ?? 'listicle',
    videoLength: opts.videoLength ?? 'medium',
    language: opts.language ?? 'en',
    aspectRatio: opts.aspectRatio ?? '16:9',
    voiceId: opts.voiceId,
    logs: [],
    createdAt: now,
    updatedAt: now,
  };
  runs.set(id, run);
  persistState();
  return run;
}

export function getRun(id: string): RunState | undefined {
  return runs.get(id);
}

export function getAllRuns(): RunState[] {
  return Array.from(runs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function updateRun(id: string, patch: Partial<RunState>): RunState {
  const run = runs.get(id);
  if (!run) throw new Error(`Run ${id} not found`);
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  persistState();
  return run;
}

export function deleteRun(id: string): boolean {
  const deleted = runs.delete(id);
  if (deleted) persistState();
  return deleted;
}

/** Append a log line to the run and broadcast to SSE subscribers. */
export function appendLog(id: string, message: string): void {
  const run = runs.get(id);
  if (!run) return;
  const line = `[${new Date().toISOString()}] ${message}`;
  run.logs.push(line);
  run.updatedAt = new Date().toISOString();
  persistState();
  // Broadcast to SSE listeners
  logSubscribers.get(id)?.forEach(writer => {
    try { writer(line); } catch { /* ignore closed connections */ }
  });
}

/** Create a logger function scoped to a specific run. */
export function makeLogger(runId: string): (msg: string) => void {
  return (msg: string) => {
    console.log(`[run:${runId.slice(0, 8)}] ${msg}`);
    appendLog(runId, msg);
  };
}