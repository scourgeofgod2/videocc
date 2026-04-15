// Video effects & ffmpeg helpers
// Exports used by composer.ts

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require('ffprobe-static') as { path: string };

if (ffmpegStatic) Ffmpeg.setFfmpegPath(ffmpegStatic);
Ffmpeg.setFfprobePath(ffprobeStatic.path);

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────────────────────

export const FPS = 25;
export const OUTPUT_WIDTH  = 1920;
export const OUTPUT_HEIGHT = 1080;

// ── ffprobe helper ────────────────────────────────────────────────────────────

export interface ProbeResult {
  duration: number;  // seconds
  width: number;
  height: number;
  codec: string;
}

/** Run ffprobe on a media file, return basic metadata. */
export async function probe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const vStream = data.streams.find(s => s.codec_type === 'video');
      const aStream = data.streams.find(s => s.codec_type === 'audio');
      const duration = parseFloat(String(data.format.duration ?? '0'));
      resolve({
        duration,
        width:  vStream?.width  ?? 0,
        height: vStream?.height ?? 0,
        codec:  vStream?.codec_name ?? aStream?.codec_name ?? '',
      });
    });
  });
}

// ── Run ffmpeg command ────────────────────────────────────────────────────────

/** Run an ffmpeg command given as an arg array (without the binary itself). */
export async function runFfmpeg(
  args: string[],
  log?: (msg: string) => void,
): Promise<void> {
  const bin = ffmpegStatic ?? 'ffmpeg';
  log?.(`ffmpeg ${args.join(' ')}`);
  const { stderr } = await execFileAsync(bin, args);
  if (stderr) log?.(stderr.slice(-400)); // tail of stderr for diagnostics
}

// ── Resize to fill ────────────────────────────────────────────────────────────

/**
 * Resize+crop image to exactly OUTPUT_WIDTH×OUTPUT_HEIGHT using sharp.
 * Returns outputPath.
 */
export async function resizeToFill(
  inputPath: string,
  outputPath: string,
  width  = OUTPUT_WIDTH,
  height = OUTPUT_HEIGHT,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(inputPath)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(outputPath);
  return outputPath;
}

// ── Image → silent video clip (Ken Burns) ────────────────────────────────────

/**
 * Convert a single image to a silent MP4 clip with optional Ken Burns zoom.
 * @param imagePath  source image
 * @param outputPath destination MP4
 * @param duration   clip length in seconds
 * @param clipIndex  used to vary pan direction (0=top-left→bottom-right, 1=top-right→bottom-left, …)
 * @param width      output width  (default OUTPUT_WIDTH)
 * @param height     output height (default OUTPUT_HEIGHT)
 * @param kenBurns   enable Ken Burns (default true)
 */
export async function imageToClip(
  imagePath: string,
  outputPath: string,
  duration: number,
  clipIndex = 0,
  width  = OUTPUT_WIDTH,
  height = OUTPUT_HEIGHT,
  kenBurns = true,
): Promise<string> {
  const w  = width;
  const h  = height;
  const dur = duration;
  const totalFrames = Math.ceil(dur * FPS);
  const zs = 1.05;
  const ze = 1.20;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let vf: string;
  if (kenBurns) {
    const zStep = ((ze - zs) / totalFrames).toFixed(6);
    // zoompan: zoom from zs to ze, keep centred
    vf = [
      `scale=${w * 2}:${h * 2}`,
      `zoompan=z='min(zoom+${zStep},${ze})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${FPS}`,
      `scale=${w}:${h}`,
    ].join(',');
  } else {
    vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  }

  await runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-vf', vf,
    '-t', String(dur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-an',
    outputPath,
  ]);

  return outputPath;
}

// ── Aspect ratio helpers ──────────────────────────────────────────────────────

/**
 * Resolve pixel resolution from aspect ratio string.
 * Base long-edge = 1920.
 */
export function resolutionFromAspectRatio(ar: string): [number, number] {
  switch (ar) {
    case '16:9':  return [1920, 1080];
    case '9:16':  return [1080, 1920];
    case '1:1':   return [1080, 1080];
    case '4:3':   return [1440, 1080];
    case '3:4':   return [1080, 1440];
    default:      return [1920, 1080];
  }
}