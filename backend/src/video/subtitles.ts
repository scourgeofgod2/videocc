/**
 * Subtitle (ASS) generator
 *
 * Converts per-clip Lemonfox word timestamps into a single ASS (Advanced SubStation Alpha)
 * subtitle file that ffmpeg can burn into the video with a drawtext/ass filter.
 *
 * ASS is chosen over SRT because it supports fine-grained styling:
 *   - custom font, size, colour, bold
 *   - vertical position (bottom of frame with margin)
 *   - outline/shadow for readability
 *   - per-word karaoke timing (optional, not used here — we do phrase-groups)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { VideoConfig, CaptionWord } from '../models.js';

// ── Caption config defaults ───────────────────────────────────────────────────

export interface CaptionConfig {
  /** Font family name (must be available on the system or in ffmpeg) */
  fontName: string;
  /** Font size in pixels (relative to 1080p — scaled by ffmpeg) */
  fontSize: number;
  /** Primary colour: &HAABBGGRR in ASS format, or hex #RRGGBB converted internally */
  primaryColour: string;
  /** Outline colour */
  outlineColour: string;
  /** Outline thickness */
  outline: number;
  /** Shadow depth */
  shadow: number;
  /** Bold (1 = bold) */
  bold: number;
  /** Vertical margin from bottom of frame (pixels) */
  marginV: number;
  /** Max words per caption group */
  wordsPerGroup: number;
  /** Convert text to UPPERCASE */
  uppercase: boolean;
}

function resolveColour(hex: string): string {
  // Accepts #RRGGBB → &H00BBGGRR  (ASS format, no alpha = 00)
  // Also passes through &HAABBGGRR as-is
  if (hex.startsWith('&H')) return hex;
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`;
}

function defaultCaptionConfig(vc: VideoConfig): CaptionConfig {
  return {
    fontName:      vc.caption_font      ?? 'Arial',
    fontSize:      vc.caption_font_size ?? 60,
    primaryColour: resolveColour(vc.caption_text_color ?? '#FFFFFF'),
    outlineColour: resolveColour('#000000'),
    outline:       2,
    shadow:        1,
    bold:          1,
    marginV:       vc.caption_position  ?? 80,
    wordsPerGroup: 5,
    uppercase:     vc.caption_uppercase ?? true,
  };
}

// ── ASS timestamp helper ──────────────────────────────────────────────────────

/** Convert seconds to ASS timestamp: H:MM:SS.cc */
function toAssTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.floor((secs % 1) * 100); // centiseconds
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ── Caption clip descriptor ───────────────────────────────────────────────────

export interface CaptionClip {
  /** Offset of this clip's audio within the final concatenated video (seconds) */
  offset: number;
  /** Duration of this clip (seconds) — for safety clamping */
  duration: number;
  /** Label for debug */
  label: string;
  /** Word-level timestamps (from Lemonfox, stored as CaptionWord in models) */
  words: CaptionWord[];
}

// ── ASS file builder ──────────────────────────────────────────────────────────

/**
 * Build an ASS subtitle file from multiple caption clips (each with a time offset).
 *
 * @param clips      Caption clips with word timestamps and offsets
 * @param outputPath Where to write the ASS file
 * @param videoConfig VideoConfig for style settings
 * @param resolution [width, height] of the output video
 * @returns          Path to the written ASS file
 */
export function buildAssFile(
  clips: CaptionClip[],
  outputPath: string,
  videoConfig: VideoConfig,
  resolution: [number, number] = [1920, 1080],
): string {
  const cfg = defaultCaptionConfig(videoConfig);
  const [resW, resH] = resolution;

  // ── ASS header ──
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${resW}`,
    `PlayResY: ${resH}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment=2 → bottom-center
    `Style: Default,${cfg.fontName},${cfg.fontSize},${cfg.primaryColour},${cfg.primaryColour},${cfg.outlineColour},&H00000000,${cfg.bold},0,0,0,100,100,0,0,1,${cfg.outline},${cfg.shadow},2,10,10,${cfg.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogueLines: string[] = [];

  for (const clip of clips) {
    if (clip.words.length === 0) continue;

    // Group words into chunks of cfg.wordsPerGroup
    for (let i = 0; i < clip.words.length; i += cfg.wordsPerGroup) {
      const group = clip.words.slice(i, i + cfg.wordsPerGroup);
      const start = clip.offset + group[0].start;
      const end   = clip.offset + group[group.length - 1].end;

      // Clamp to clip boundary
      const clampedStart = Math.max(0, start);
      const clampedEnd   = Math.min(clip.offset + clip.duration, end + 0.05); // +50ms grace

      let text = group.map(w => w.word.trim()).join(' ');
      if (cfg.uppercase) text = text.toUpperCase();

      dialogueLines.push(
        `Dialogue: 0,${toAssTime(clampedStart)},${toAssTime(clampedEnd)},Default,,0,0,0,,${text}`,
      );
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, header + '\n' + dialogueLines.join('\n') + '\n', 'utf8');

  return outputPath;
}