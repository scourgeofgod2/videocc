// Video composer — assembles clips + audio into final MP4
// Ported from Python src/video/composer.py
// Approach: per-section clip (image → Ken Burns video clip) + audio → concat → final video

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import type { Script, VideoConfig, CaptionWord } from '../models.js';
import { imageToClip, resizeToFill, runFfmpeg, FPS, OUTPUT_WIDTH, OUTPUT_HEIGHT, probe, resolutionFromAspectRatio } from './effects.js';
import { buildAssFile, type CaptionClip } from './subtitles.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require('ffprobe-static') as { path: string };
if (ffmpegStatic) Ffmpeg.setFfmpegPath(ffmpegStatic);
Ffmpeg.setFfprobePath(ffprobeStatic.path);

const execAsync = promisify(exec);

// ── GPU codec helpers ─────────────────────────────────────────────────────────

/**
 * Returns ffmpeg output option pairs for H.264 encoding.
 * Falls back to CPU libx264 when use_gpu is false/undefined.
 */
function videoCodecArgs(vc: VideoConfig): string[] {
  if (!vc.use_gpu) {
    return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'];
  }
  switch (vc.gpu_encoder) {
    case 'nvenc':
      // NVIDIA NVENC
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-pix_fmt', 'yuv420p'];
    case 'amf':
      // AMD AMF
      return ['-c:v', 'h264_amf', '-quality', 'speed', '-qp_i', '20', '-pix_fmt', 'yuv420p'];
    case 'qsv':
      // Intel Quick Sync
      return ['-c:v', 'h264_qsv', '-preset', 'fast', '-global_quality', '20', '-pix_fmt', 'yuv420p'];
    default:
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'];
  }
}

// ── Clip descriptor ───────────────────────────────────────────────────────────

interface Clip {
  videoPath: string;  // path to the silent video clip
  audioPath: string;  // path to the narration mp3
  duration: number;   // audio duration (seconds) — clip length
  label: string;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function tmpPath(dir: string, name: string): string {
  return path.join(dir, name);
}

/** Pad/trim silent video clip to exactly `targetDuration` seconds */
async function padClip(inputPath: string, outputPath: string, targetDuration: number): Promise<string> {
  return new Promise((resolve, reject) => {
    Ffmpeg()
      .input(inputPath)
      .videoFilter(`setpts=PTS-STARTPTS`)
      .outputOptions([
        `-t ${targetDuration}`,
        `-c:v libx264`,
        `-preset fast`,
        `-crf 18`,
        `-pix_fmt yuv420p`,
        `-r ${FPS}`,
        `-an`,
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

/** Mix video (silent) + audio → clip with audio */
async function muxVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  duration: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = Ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        `-t ${duration}`,
        `-c:v copy`,
        `-c:a aac`,
        `-b:a 192k`,
        `-shortest`,
        `-movflags +faststart`,
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
    cmd.run();
  });
}

/** Resize image to fill target resolution, save to temp file */
async function prepareImage(imagePath: string, tmpDir: string, idx: number, w = OUTPUT_WIDTH, h = OUTPUT_HEIGHT): Promise<string> {
  const outPath = path.join(tmpDir, `img_resized_${idx}.png`);
  return resizeToFill(imagePath, outPath, w, h);
}

// ── Build clip list from script ───────────────────────────────────────────────

interface RawClipSource {
  label: string;
  imagePath: string;
  audioPath: string;
  duration: number;
}

function buildClipSources(script: Script): RawClipSource[] {
  const sources: RawClipSource[] = [];

  // Intro
  const introImg = script.intro_image_path ?? script.intro_image_paths?.[0];
  if (introImg && script.intro_audio_path && (script.intro_duration ?? 0) > 0) {
    sources.push({
      label: 'intro',
      imagePath: introImg,
      audioPath: script.intro_audio_path,
      duration: script.intro_duration ?? 5,
    });
  }

  // Sections
  for (const section of script.sections) {
    const imgPath = section.image_path ?? section.image_paths?.[0];
    if (imgPath && section.audio_path && (section.duration ?? 0) > 0) {
      sources.push({
        label: `section_${section.number}`,
        imagePath: imgPath,
        audioPath: section.audio_path,
        duration: section.duration ?? 5,
      });
    }
  }

  // Outro
  const outroImg = script.outro_image_path;
  if (outroImg && script.outro_audio_path && (script.outro_duration ?? 0) > 0) {
    sources.push({
      label: 'outro',
      imagePath: outroImg,
      audioPath: script.outro_audio_path,
      duration: script.outro_duration ?? 5,
    });
  }

  return sources;
}

// ── Concat with xfade transitions ─────────────────────────────────────────────

interface MuxedClip {
  path: string;
  duration: number;
  label: string;
}

/**
 * Concatenate muxed clips (each has video + audio) with xfade/acrossfade transitions.
 * Uses a complex filtergraph.
 */
async function concatWithTransitions(
  clips: MuxedClip[],
  outputPath: string,
  transitionDuration = 0.5,
  videoConfig?: VideoConfig,
): Promise<string> {
  if (clips.length === 0) throw new Error('No clips to concat');
  if (clips.length === 1) {
    fs.copyFileSync(clips[0].path, outputPath);
    return outputPath;
  }

  // Build a concat list file (simpler, no transitions)
  // For a production quality output we use an ffmpeg filter_complex with xfade.
  // Note: xfade requires re-encoding.

  // Build filter_complex for N clips
  const inputs = clips.map(c => c.path);
  const n = inputs.length;

  // We'll chain xfade transitions
  // Each clip except the last overlaps with the next by transitionDuration
  // offset for xfade = sum of (dur - transition) for all previous clips

  let filterLines: string[] = [];
  let offset = 0;

  // Video chain
  let prevVideoLabel = '[0:v]';
  let prevAudioLabel = '[0:a]';

  for (let i = 1; i < n; i++) {
    const currVideoLabel = `[${i}:v]`;
    const currAudioLabel = `[${i}:a]`;
    const outVLabel = i < n - 1 ? `[vx${i}]` : '[vout]';
    const outALabel = i < n - 1 ? `[ax${i}]` : '[aout]';

    // Compute offset: sum of previous clip durations minus transition
    offset += Math.max(0, clips[i - 1].duration - transitionDuration);

    filterLines.push(
      `${prevVideoLabel}${currVideoLabel}xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(3)}${outVLabel}`,
    );
    filterLines.push(
      `${prevAudioLabel}${currAudioLabel}acrossfade=d=${transitionDuration}${outALabel}`,
    );

    prevVideoLabel = outVLabel;
    prevAudioLabel = outALabel;
  }

  const filterComplex = filterLines.join(';');

  // Build ffmpeg command
  const cmd = Ffmpeg();
  for (const inputPath of inputs) cmd.input(inputPath);

  const codecOpts1 = videoConfig ? videoCodecArgs(videoConfig) : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'];
  cmd
    .complexFilter(filterComplex)
    .outputOptions([
      `-map [vout]`,
      `-map [aout]`,
      ...codecOpts1,
      `-c:a aac`,
      `-b:a 192k`,
      `-movflags +faststart`,
    ])
    .output(outputPath)
    .on('start', (cl) => console.log(`[ffmpeg concat] ${cl.slice(0, 120)}`))
    .on('end', () => {})
    .on('error', () => {});

  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

// ── Simple concat (no transitions) as fallback ────────────────────────────────

async function simpleConcatClips(clips: MuxedClip[], outputPath: string, videoConfig?: VideoConfig): Promise<string> {
  const listFile = outputPath + '.list.txt';
  const listContent = clips.map(c => `file '${c.path.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  const codecOpts2 = videoConfig ? videoCodecArgs(videoConfig) : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'];

  return new Promise((resolve, reject) => {
    Ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        ...codecOpts2,
        `-c:a aac`,
        `-b:a 192k`,
        `-movflags +faststart`,
      ])
      .output(outputPath)
      .on('start', (cl) => console.log(`[ffmpeg concat] ${cl.slice(0, 120)}`))
      .on('end', () => { fs.unlinkSync(listFile); resolve(outputPath); })
      .on('error', (err) => { try { fs.unlinkSync(listFile); } catch {} reject(err); })
      .run();
  });
}

// ── Main composer ─────────────────────────────────────────────────────────────

export async function composeVideo(
  script: Script,
  videoConfig: VideoConfig,
  outputPath: string,
  log: (msg: string) => void = console.log,
  aspectRatio = '16:9',
): Promise<string> {
  const tmpDir = path.join(path.dirname(outputPath), 'tmp_compose');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Resolve output resolution from aspect ratio
  const [outW, outH] = resolutionFromAspectRatio(aspectRatio);
  log(`video resolution: ${outW}x${outH} (${aspectRatio})`);

  // Default to 'none' — simple concat is more reliable and avoids
  // acrossfade timing issues that clip audio content at segment boundaries.
  // Set transition='crossfade' in config to opt in.
  const useTransitions = (videoConfig.transition ?? 'none') === 'crossfade';
  const transitionDuration = videoConfig.transition_duration ?? 0.5;

  log('building clip list from script...');
  const sources = buildClipSources(script);
  if (sources.length === 0) throw new Error('No clips could be built — check voiceovers and images');
  log(`${sources.length} clip(s) to process`);

  // Step A: For each source, resize image → Ken Burns video → mux with audio
  const muxedClips: MuxedClip[] = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    log(`processing clip ${i + 1}/${sources.length}: ${src.label}`);

    // 1. Resize image to fill
    let resizedImg: string;
    try {
      resizedImg = await prepareImage(src.imagePath, tmpDir, i, outW, outH);
    } catch (e) {
      log(`warn: could not resize image for ${src.label}: ${e}. Using original.`);
      resizedImg = src.imagePath;
    }

    // 2. Ken Burns clip (silent)
    const silentClipPath = tmpPath(tmpDir, `silent_${i}.mp4`);
    try {
      await imageToClip(resizedImg, silentClipPath, src.duration, i, outW, outH);
    } catch (e) {
      log(`error: Ken Burns failed for ${src.label}: ${e}`);
      continue;
    }

    // 3. Mux with audio
    const muxedPath = tmpPath(tmpDir, `muxed_${i}.mp4`);
    try {
      await muxVideoAudio(silentClipPath, src.audioPath, muxedPath, src.duration);
      muxedClips.push({ path: muxedPath, duration: src.duration, label: src.label });
      log(`clip ${i + 1} ready (${src.duration.toFixed(1)}s)`);
    } catch (e) {
      log(`error: mux failed for ${src.label}: ${e}`);
    }
  }

  if (muxedClips.length === 0) throw new Error('All clips failed — cannot compose video');

  log(`concatenating ${muxedClips.length} clip(s)...`);

  // Concat to a temporary file first (we may burn subtitles after)
  const concatOutputPath = videoConfig.captions_enabled
    ? tmpPath(tmpDir, 'concat_noass.mp4')
    : outputPath;

  try {
    if (useTransitions && muxedClips.length > 1) {
      log(`using xfade transitions (${transitionDuration}s)`);
      await concatWithTransitions(muxedClips, concatOutputPath, transitionDuration, videoConfig);
    } else {
      log('using simple concat (no transitions)');
      await simpleConcatClips(muxedClips, concatOutputPath, videoConfig);
    }
  } catch (e) {
    log(`warn: transition concat failed (${e}), falling back to simple concat`);
    await simpleConcatClips(muxedClips, concatOutputPath, videoConfig);
  }

  // ── Subtitle burning ──────────────────────────────────────────────────────
  if (videoConfig.captions_enabled) {
    const hasCaptions =
      (script.intro_captions?.length ?? 0) > 0 ||
      script.sections.some(s => (s.captions?.length ?? 0) > 0) ||
      (script.outro_captions?.length ?? 0) > 0;

    if (hasCaptions) {
      log('[captions] building ASS subtitle file...');

      // Build CaptionClip list with cumulative time offsets
      const captionClips: CaptionClip[] = [];
      let timeOffset = 0;

      // Helper: extract words from CaptionSegments
      function extractWords(segs: import('../models.js').CaptionSegment[]): CaptionWord[] {
        return segs.flatMap(s => s.words ?? []);
      }

      // Intro
      const introWords = extractWords(script.intro_captions ?? []);
      if (introWords.length > 0) {
        captionClips.push({ offset: timeOffset, duration: script.intro_duration ?? 5, label: 'intro', words: introWords });
      }
      timeOffset += script.intro_duration ?? 0;

      // Sections
      for (const section of script.sections) {
        const secWords = extractWords(section.captions ?? []);
        if (secWords.length > 0) {
          captionClips.push({ offset: timeOffset, duration: section.duration ?? 5, label: `section_${section.number}`, words: secWords });
        }
        timeOffset += section.duration ?? 0;
      }

      // Outro
      const outroWords = extractWords(script.outro_captions ?? []);
      if (outroWords.length > 0) {
        captionClips.push({ offset: timeOffset, duration: script.outro_duration ?? 5, label: 'outro', words: outroWords });
      }

      const assPath = tmpPath(tmpDir, 'subtitles.ass');
      buildAssFile(captionClips, assPath, videoConfig, [outW, outH]);

      // Burn ASS into video with ffmpeg ass filter
      log('[captions] burning subtitles into video...');
      // On Windows paths need escaped backslashes for the ass filter
      const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      const burnCodec = videoCodecArgs(videoConfig);
      await runFfmpeg([
        '-y',
        '-i', concatOutputPath,
        '-vf', `ass=${assEscaped}`,
        ...burnCodec,
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ], log);
      log('[captions] subtitle burn complete');
    } else {
      // captions_enabled but no words — just rename concat output
      fs.renameSync(concatOutputPath, outputPath);
      log('[captions] no caption words found, skipping burn');
    }
  }

  // Cleanup tmp
  try {
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  } catch {}

  log(`video assembled: ${path.basename(outputPath)}`);
  return outputPath;
}