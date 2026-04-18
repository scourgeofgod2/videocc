// Google Images Provider — scrapes Google Images using browser cookies
// Requires GOOGLE_COOKIES env variable (copy Cookie header from DevTools)
import fetch from 'node-fetch';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import type { ImageProvider } from './base.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

interface GoogleImageResult {
  url: string;
  width: number;
  height: number;
}

function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function searchGoogleImages(query: string, cookies: string): Promise<GoogleImageResult[]> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2&hl=en&gl=us`;

  const res = await fetch(searchUrl, {
    redirect: 'follow',
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-encoding': 'identity',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'max-age=0',
      'cookie': cookies,
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': UA,
    },
  });

  if (!res.ok) {
    throw new Error(`Google Images returned HTTP ${res.status}`);
  }

  const html = await res.text();

  if (html.includes("If you're having trouble") || html.includes('g-recaptcha')) {
    throw new Error('Google Images bot challenge — update GOOGLE_COOKIES env variable');
  }

  // Extract image URLs from the JSON array pattern: ["https://...",width,height]
  const results: GoogleImageResult[] = [];
  const seen = new Set<string>();

  const arrayPattern = /\["(https?:\/\/(?!encrypted-tbn)[^"]{20,}\.(?:jpg|jpeg|png|webp|gif)[^"]{0,300})",(\d+),(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayPattern.exec(html)) !== null && results.length < 30) {
    const rawUrl = unescapeUnicode(m[1]);
    const w = parseInt(m[2]);
    const h = parseInt(m[3]);
    // Skip tiny images and duplicates
    if (!seen.has(rawUrl) && w >= 300 && h >= 200) {
      seen.add(rawUrl);
      results.push({ url: rawUrl, width: w, height: h });
    }
  }

  return results;
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    proto.get(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.google.com/' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function loadCookies(cookies: string): string {
  if (cookies) return cookies;
  // Fallback: try reading from google-cookies.txt in cwd
  try {
    const txt = fs.readFileSync('google-cookies.txt', 'utf8').trim();
    if (txt) return txt;
  } catch { /* file doesn't exist */ }
  return '';
}

export class GoogleImageProvider implements ImageProvider {
  private cookies: string;

  constructor(cookies: string) {
    this.cookies = loadCookies(cookies);
  }

  async generateImage(prompt: string, outputPath: string, aspectRatio?: string): Promise<string> {
    // Clean AI image-gen jargon before using as a search query
    const query = prompt
      .replace(/\b(cinematic|photorealistic|4k|ultra hd|hd|detailed|vivid|dramatic|high quality|8k|hyperrealistic|sharp focus|bokeh|professional photo|wide shot|close.up|golden hour|ultra detailed)\b/gi, '')
      .replace(/[,.:;!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100) || 'nature landscape';

    console.log(`[Google Images] searching: "${query}"`);
    const results = await searchGoogleImages(query, this.cookies);

    if (results.length === 0) {
      throw new Error(`Google Images: no results for "${query}"`);
    }

    // Pick best match by aspect ratio if specified
    let chosen = results[0];
    if (aspectRatio) {
      const [aw, ah] = aspectRatio.split(':').map(Number);
      const targetRatio = aw / ah;
      chosen = results.reduce((best, r) => {
        const ratioDiff = Math.abs(r.width / r.height - targetRatio);
        const bestDiff = Math.abs(best.width / best.height - targetRatio);
        return ratioDiff < bestDiff ? r : best;
      });
    }

    await downloadFile(chosen.url, outputPath);
    return outputPath;
  }
}