// DuckDuckGo Image Provider — searches DDG Images and downloads a result (no API key needed)
// Uses the DDG undocumented image search API directly (bypasses the broken duckduckgo-images-api npm package)

import fetch from 'node-fetch';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import type { ImageProvider } from './base.js';

interface DDGImageResult {
  image: string;
  title: string;
  thumbnail: string;
  url: string;
  height: number;
  width: number;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Fetch VQD token + cookies from DuckDuckGo homepage for a given query. */
async function getDDGSession(query: string): Promise<{ token: string; cookieString: string }> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!res.ok) throw new Error(`DDG session fetch failed: HTTP ${res.status}`);

  const html = await res.text();

  // Extract VQD token — DDG uses this to validate subsequent API requests
  const patterns = [
    /vqd=([\d-]+)&/,
    /vqd=([\d-]+)/,
    /"vqd":"([^"]+)"/,
    /vqd=([^&"'\s<>]{4,80})/,
  ];

  let token: string | undefined;
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) { token = m[1]; break; }
  }
  if (!token) throw new Error('Could not extract DDG VQD token from page');

  // Forward cookies from the page response to the API request
  const rawCookies: string[] = (res.headers as unknown as { raw(): Record<string, string[]> }).raw()['set-cookie'] ?? [];
  const cookieString = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

  return { token, cookieString };
}

/** Search DuckDuckGo Images and return the results array. */
async function searchDDGImages(query: string): Promise<DDGImageResult[]> {
  const { token, cookieString } = await getDDGSession(query);

  const params = new URLSearchParams({
    l: 'us-en',
    o: 'json',
    q: query,
    vqd: token,
    f: ',,,',
    p: '-1',
  });

  const apiUrl = `https://duckduckgo.com/i.js?${params.toString()}`;
  const apiRes = await fetch(apiUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'X-Requested-With': 'XMLHttpRequest',
      'Connection': 'keep-alive',
      ...(cookieString ? { 'Cookie': cookieString } : {}),
    },
  });

  if (!apiRes.ok) {
    const body = await apiRes.text().catch(() => '');
    throw new Error(`DDG image search failed: HTTP ${apiRes.status} — ${body.substring(0, 200)}`);
  }

  const data = await apiRes.json() as { results?: DDGImageResult[] };
  return data.results ?? [];
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
        downloadFile(res.headers.location!, outputPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (e) => { try { fs.unlinkSync(outputPath); } catch { /* ignore */ } reject(e); });
    }).on('error', (e) => { try { fs.unlinkSync(outputPath); } catch { /* ignore */ } reject(e); });
  });
}

export class DuckDuckGoImageProvider implements ImageProvider {
  async generateImage(prompt: string, outputPath: string, _aspectRatio?: string): Promise<string> {
    // Strip AI image generation jargon, keep meaningful natural-language search terms
    const query = prompt
      .replace(/\b(cinematic|photorealistic|4k|ultra hd|hd|detailed|vivid|dramatic|high quality|8k|hyperrealistic|sharp focus|bokeh|professional photo)\b/gi, '')
      .replace(/[,.:;!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80) || 'nature landscape';

    console.log(`[DuckDuckGo Images] searching: "${query}"`);
    const results = await searchDDGImages(query);

    if (!results || results.length === 0) {
      throw new Error(`DuckDuckGo: no images found for query "${query}"`);
    }

    // Prefer results with a known image extension
    const pick = results.find(r =>
      r.image && /\.(jpe?g|png|webp)(\?|$)/i.test(r.image),
    ) ?? results[0];

    const imgUrl = pick.image;

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Determine final extension from URL
    const urlExt = imgUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
    const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(urlExt) ? urlExt : 'jpg';
    const finalPath = outputPath.replace(/\.\w+$/, `.${ext}`);

    await downloadFile(imgUrl, finalPath);
    return finalPath;
  }
}
