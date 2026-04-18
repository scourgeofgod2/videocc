// Pexels Image Provider — searches Pexels and downloads a photo as the image output

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import type { ImageProvider } from './base.js';

interface PexelsPhoto {
  id: number;
  src: {
    original: string;
    large2x: string;
    large: string;
    portrait: string;
    landscape: string;
    medium: string;
  };
  alt: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(outputPath);
        downloadFile(res.headers.location!, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (e) => { fs.unlinkSync(outputPath); reject(e); });
    }).on('error', (e) => { fs.unlinkSync(outputPath); reject(e); });
  });
}

function pickSrcForAspect(photo: PexelsPhoto, aspectRatio?: string): string {
  // Pick best source based on desired aspect ratio
  if (!aspectRatio || aspectRatio === '16:9' || aspectRatio === '4:3') {
    return photo.src.landscape || photo.src.large2x || photo.src.original;
  }
  if (aspectRatio === '9:16' || aspectRatio === '3:4') {
    return photo.src.portrait || photo.src.large2x || photo.src.original;
  }
  // square
  return photo.src.large2x || photo.src.large || photo.src.original;
}

export class PexelsImageProvider implements ImageProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateImage(prompt: string, outputPath: string, aspectRatio?: string): Promise<string> {
    // Use first ~80 chars of prompt as search query, strip image-generation style words
    const query = prompt
      .replace(/\b(cinematic|photorealistic|4k|ultra|hd|detailed|vivid|dramatic|high quality)\b/gi, '')
      .replace(/[,.:;!?]+/g, ' ')
      .trim()
      .substring(0, 80);

    const orientation = (!aspectRatio || aspectRatio === '16:9' || aspectRatio === '4:3')
      ? 'landscape'
      : (aspectRatio === '9:16' || aspectRatio === '3:4')
        ? 'portrait'
        : 'square';

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${orientation}`;

    const data = await new Promise<PexelsSearchResponse>((resolve, reject) => {
      https.get(url, {
        headers: { Authorization: this.apiKey },
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(body) as PexelsSearchResponse); }
          catch (e) { reject(e); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    if (!data.photos || data.photos.length === 0) {
      throw new Error(`Pexels: no photos found for query "${query}"`);
    }

    const photo = data.photos[0];
    const imgUrl = pickSrcForAspect(photo, aspectRatio);

    // Determine output extension from URL
    const urlExt = imgUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpeg';
    const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(urlExt) ? urlExt : 'jpeg';

    // Adjust outputPath extension if needed
    const finalPath = outputPath.replace(/\.\w+$/, `.${ext}`);

    await downloadFile(imgUrl, finalPath);
    return finalPath;
  }
}