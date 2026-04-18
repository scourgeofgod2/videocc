// Pexels Video Provider — searches Pexels for a video clip and downloads it

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

interface PexelsVideoFile {
  id: number;
  quality: 'hd' | 'sd' | 'hls';
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: PexelsVideoFile[];
  image: string;
}

interface PexelsVideoSearchResponse {
  videos: PexelsVideo[];
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
      file.on('error', (e) => { try { fs.unlinkSync(outputPath); } catch {} reject(e); });
    }).on('error', (e) => { try { fs.unlinkSync(outputPath); } catch {} reject(e); });
  });
}

function pickBestFile(files: PexelsVideoFile[], aspectRatio?: string): PexelsVideoFile | undefined {
  const mp4Files = files.filter(f => f.file_type === 'video/mp4' && f.quality !== 'hls');

  // For portrait (9:16, 3:4), prefer taller videos
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';

  // Sort: prefer hd, then by resolution match
  const sorted = mp4Files.sort((a, b) => {
    if (a.quality === 'hd' && b.quality !== 'hd') return -1;
    if (b.quality === 'hd' && a.quality !== 'hd') return 1;
    if (isPortrait) {
      // prefer taller
      const aRatio = (a.height ?? 0) / (a.width ?? 1);
      const bRatio = (b.height ?? 0) / (b.width ?? 1);
      return bRatio - aRatio;
    }
    // prefer wider for landscape
    return (b.width ?? 0) - (a.width ?? 0);
  });

  return sorted[0];
}

export async function fetchPexelsVideo(
  apiKey: string,
  query: string,
  outputPath: string,
  aspectRatio?: string,
): Promise<string> {
  const orientation = (!aspectRatio || aspectRatio === '16:9' || aspectRatio === '4:3')
    ? 'landscape'
    : (aspectRatio === '9:16' || aspectRatio === '3:4')
      ? 'portrait'
      : 'square';

  // Clean up query
  const cleanQuery = query
    .replace(/\b(cinematic|photorealistic|4k|ultra|hd|detailed|vivid|dramatic|high quality|video|clip)\b/gi, '')
    .replace(/[,.:;!?]+/g, ' ')
    .trim()
    .substring(0, 80);

  const url = `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(cleanQuery)}&per_page=5&orientation=${orientation}`;

  const data = await new Promise<PexelsVideoSearchResponse>((resolve, reject) => {
    https.get(url, {
      headers: { Authorization: apiKey },
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body) as PexelsVideoSearchResponse); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });

  if (!data.videos || data.videos.length === 0) {
    throw new Error(`Pexels video: no results for "${cleanQuery}"`);
  }

  const video = data.videos[0];
  const file = pickBestFile(video.video_files, aspectRatio);
  if (!file) throw new Error('Pexels video: no suitable video file found');

  await downloadFile(file.link, outputPath);
  return outputPath;
}