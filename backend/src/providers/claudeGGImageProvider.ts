// ClaudeGG Image Provider via router.claude.gg
// POST https://router.claude.gg/api/generate
//   body: { model: 'nano-banana-pro-flash', type: 'text-to-image', params: { prompt, aspect_ratio? } }
//   resp: { taskId: string, status: string }
// GET  https://router.claude.gg/get/<taskId>
//   resp: { status: 'PROCESSING'|'FINISHED'|'FAILED', result: string | [...] }

import fs from 'node:fs';
import path from 'node:path';
import type { ImageProvider } from './base.js';
import type { ProviderConfig } from '../models.js';

const SUBMIT_URL = 'https://router.claude.gg/api/generate';
const POLL_BASE  = 'https://router.claude.gg/get';

const POLL_INTERVAL_MS = 4_000;  // 4 s
const MAX_POLLS = 90;            // ~6 minutes
const SUBMIT_RETRIES = 3;        // retry on upstream 5xx
const SUBMIT_RETRY_DELAY = 5_000; // 5 s between submit retries

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ClaudeGGImageProvider implements ImageProvider {
  private apiKey: string;
  private model: string;
  private aspectRatio: string;

  constructor(config: ProviderConfig) {
    const key = process.env[config.api_key_env] ?? '';
    if (!key) throw new Error(`${config.api_key_env} env var not set`);
    this.apiKey = key;
    // Supported models: 'nano-banana-pro-flash' (fast), 'kie' (quality)
    this.model = config.model ?? 'nano-banana-pro-flash';
    this.aspectRatio = (config.extra?.['aspect_ratio'] as string | undefined) ?? '16:9';
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async submit(prompt: string, aspectRatio?: string): Promise<string> {
    const body = {
      model: this.model,
      type: 'text-to-image',
      params: {
        prompt,
        aspect_ratio: aspectRatio ?? this.aspectRatio,
      },
    };

    let lastErr: Error = new Error('submit failed');
    for (let attempt = 0; attempt <= SUBMIT_RETRIES; attempt++) {
      if (attempt > 0) {
        console.warn(`[image/claudegg] submit retry ${attempt}/${SUBMIT_RETRIES} after ${SUBMIT_RETRY_DELAY / 1000}s…`);
        await sleep(SUBMIT_RETRY_DELAY);
      }

      const resp = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        lastErr = new Error(`ClaudeGG image submit HTTP ${resp.status}: ${txt}`);
        if (resp.status >= 500 && attempt < SUBMIT_RETRIES) continue;
        throw lastErr;
      }

      const data = await resp.json() as Record<string, unknown>;
      const taskId = (data['taskId'] ?? data['task_id'] ?? data['id']) as string | undefined;
      if (!taskId) {
        lastErr = new Error(`ClaudeGG image: no taskId in response: ${JSON.stringify(data)}`);
        if (attempt < SUBMIT_RETRIES) continue;
        throw lastErr;
      }
      console.log(`[image/claudegg] task ${taskId} submitted (model: ${this.model}, attempt: ${attempt + 1})`);
      return taskId;
    }
    throw lastErr;
  }

  private async poll(taskId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      const resp = await fetch(`${POLL_BASE}/${encodeURIComponent(taskId)}`, {
        headers: this.headers,
      });

      if (!resp.ok) {
        console.warn(`[image/claudegg] poll ${taskId}: HTTP ${resp.status}, retrying…`);
        continue;
      }

      const data = await resp.json() as Record<string, unknown>;
      const status = ((data['status'] ?? '') as string).toUpperCase();

      if (i % 5 === 0) console.log(`[image/claudegg] task ${taskId}: ${status}`);

      if (status === 'FINISHED' || status === 'SUCCESS' || status === 'COMPLETED') {
        const url = this.extractUrl(data);
        if (!url) throw new Error(`ClaudeGG image: finished but no URL in: ${JSON.stringify(data)}`);
        console.log(`[image/claudegg] task ${taskId} done → ${url.slice(0, 80)}…`);
        return url;
      }

      if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
        throw new Error(`ClaudeGG image: task ${taskId} ${status}: ${JSON.stringify(data)}`);
      }
    }
    throw new Error(`ClaudeGG image: task ${taskId} timed out after ${MAX_POLLS} polls`);
  }

  private extractUrl(data: Record<string, unknown>): string | null {
    // result may be a direct URL string
    if (typeof data['result'] === 'string' && data['result'].startsWith('http')) {
      return data['result'];
    }
    // result may be an array of URLs
    if (Array.isArray(data['result']) && data['result'].length > 0) {
      const first = data['result'][0] as unknown;
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const obj = first as Record<string, unknown>;
        if (typeof obj['url'] === 'string') return obj['url'];
      }
    }
    // direct url field
    if (typeof data['url'] === 'string') return data['url'];
    if (typeof data['imageUrl'] === 'string') return data['imageUrl'];
    return null;
  }

  async generateImage(prompt: string, outputPath: string, aspectRatio?: string): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Clean inline ratio tokens that sometimes get baked into prompts
    const cleanPrompt = prompt
      .replace(/,?\s*\b(16:9|9:16|1:1|4:3|3:4|5:4|4:5|21:9)\b\s*/g, ', ')
      .replace(/,\s*$/, '')
      .trim();

    const taskId = await this.submit(cleanPrompt, aspectRatio);
    const imageUrl = await this.poll(taskId);

    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      throw new Error(`ClaudeGG image: failed to download from ${imageUrl}: ${imgResp.status}`);
    }

    const buffer = Buffer.from(await imgResp.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`[image/claudegg] saved ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return outputPath;
  }
}