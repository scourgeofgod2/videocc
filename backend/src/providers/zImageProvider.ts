// Z-Image Provider via kie.ai
// POST https://api.kie.ai/api/v1/jobs/createTask
//   → { code:200, msg:"success", data: { taskId, recordId } }
// GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<id>
//   → { code:200, msg:"success", data: { state, resultJson, ... } }
// Authorization: Bearer <ZIMAGE_API_KEY>

import fs from 'node:fs';
import path from 'node:path';
import type { ImageProvider } from './base.js';
import type { ProviderConfig } from '../models.js';

const CREATE_TASK_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const RECORD_INFO_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';

const POLL_INTERVAL_MS = 10_000; // 10 s as documented
const MAX_POLLS = 60;            // ~10 minutes

interface KieApiEnvelope {
  code: number;
  msg: string;
  data: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ZImageProvider implements ImageProvider {
  private apiKey: string;
  private model: string;
  private aspectRatio: string;

  constructor(config: ProviderConfig) {
    const key = process.env[config.api_key_env] ?? '';
    if (!key) throw new Error(`${config.api_key_env} env var not set`);
    this.apiKey = key;
    this.model = config.model ?? 'z-image';
    this.aspectRatio = config.extra?.['aspect_ratio'] ?? '16:9';
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Submit task and return taskId.
   *  aspectRatio parameter overrides the config default for this call. */
  private async createTask(prompt: string, aspectRatio?: string): Promise<string> {
    const body = {
      model: this.model,
      input: {
        prompt,
        aspect_ratio: aspectRatio ?? this.aspectRatio,
      },
    };

    const resp = await fetch(CREATE_TASK_URL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Z-Image createTask HTTP ${resp.status}: ${errText}`);
    }

    const envelope = await resp.json() as KieApiEnvelope;
    if (envelope.code !== 200) {
      throw new Error(`Z-Image createTask error: ${envelope.msg}`);
    }

    // taskId lives inside data.taskId (or data.recordId as fallback)
    const taskId = (envelope.data.taskId ?? envelope.data.recordId) as string | undefined;
    if (!taskId) {
      throw new Error(`Z-Image: no taskId in response data: ${JSON.stringify(envelope.data)}`);
    }
    console.log(`[image] task ${taskId} submitted`);
    return taskId;
  }

  /** Poll recordInfo until state=success, return first resultUrl */
  private async pollTask(taskId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      const url = `${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`;
      const resp = await fetch(url, {
        headers: this.headers,
      });

      if (!resp.ok) {
        console.warn(`[image] poll ${taskId}: HTTP ${resp.status}, retrying…`);
        continue;
      }

      const envelope = await resp.json() as KieApiEnvelope;
      if (envelope.code !== 200) {
        console.warn(`[image] poll ${taskId}: api code ${envelope.code} ${envelope.msg}`);
        continue;
      }

      const data = envelope.data;
      const state = ((data.state ?? data.status ?? '') as string).toLowerCase();

      if (i % 3 === 0) console.log(`[image] task ${taskId}: ${state}`);

      if (state === 'success' || state === 'completed' || state === 'done') {
        // resultJson is a JSON string: { resultUrls: [...] }
        const imageUrl = this.extractImageUrl(data);
        if (!imageUrl) {
          throw new Error(`Z-Image: task done but no URL in: ${JSON.stringify(data)}`);
        }
        console.log(`[image] task ${taskId} done → ${imageUrl.slice(0, 80)}…`);
        return imageUrl;
      }

      if (state === 'failed' || state === 'error' || state === 'cancelled') {
        throw new Error(`Z-Image: task ${taskId} ${state}: ${data.failMsg ?? JSON.stringify(data)}`);
      }
      // else: still running, keep polling
    }

    throw new Error(`Z-Image: task ${taskId} timed out after ${MAX_POLLS} polls`);
  }

  private extractImageUrl(data: Record<string, unknown>): string | null {
    // resultJson: '{"resultUrls":["https://..."]}'
    if (typeof data.resultJson === 'string' && data.resultJson) {
      try {
        const parsed = JSON.parse(data.resultJson) as { resultUrls?: string[] };
        if (parsed.resultUrls && parsed.resultUrls.length > 0) {
          return parsed.resultUrls[0];
        }
      } catch { /* ignore */ }
    }

    // Direct fields as fallback
    if (typeof data.imageUrl === 'string') return data.imageUrl;
    if (typeof data.url === 'string') return data.url;

    return null;
  }

  async generateImage(prompt: string, outputPath: string, aspectRatio?: string): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Strip any hardcoded ratio that may have been baked into the prompt template
    const cleanPrompt = prompt.replace(/,?\s*\b(16:9|9:16|1:1|4:3|3:4)\b\s*/g, ', ').replace(/,\s*$/, '').trim();

    const taskId = await this.createTask(cleanPrompt, aspectRatio);
    const imageUrl = await this.pollTask(taskId);

    // Download image
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      throw new Error(`Z-Image: failed to download from ${imageUrl}: ${imgResp.status}`);
    }

    const buffer = Buffer.from(await imgResp.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`[image] saved ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);

    return outputPath;
  }
}