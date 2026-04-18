/**
 * Subtitle (ASS) generator — TikTok-style karaoke captions
 *
 * Converts per-clip Lemonfox word timestamps into a single ASS subtitle file
 * that ffmpeg burns into the video via the `ass=` filter.
 *
 * Karaoke approach:
 *   - Words are grouped into small chunks (wordsPerGroup)
 *   - For each active word window, a Dialogue line is emitted
 *   - The active word is coloured with `caption_active_color`
 *   - Inactive words use `caption_text_color`
 *   - ASS BorderStyle=3 + BackColour gives an opaque rounded box background
 */

import fs from 'node:fs';
import path from 'node:path';
import type { VideoConfig, CaptionWord } from '../models.js';

// ── Caption config ────────────────────────────────────────────────────────────

export interface CaptionConfig {
  fontName: string;
  fontSize: number;
  primaryColour: string;   // text (inactive words) — ASS &H00BBGGRR
  activeColour: string;    // active word highlight
  backColour: string;      // box background — ASS &HAABBGGRR (AA = alpha 0=opaque)
  outlineColour: string;
  outline: number;
  shadow: number;
  bold: number;
  marginV: number;
  wordsPerGroup: number;
  uppercase: boolean;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/** #RRGGBB → &H00BBGGRR  (no transparency) */
function hexToAss(hex: string): string {
  if (hex.startsWith('&H')) return hex;
  const h = hex.replace('#', '');
  if (h.length < 6) return '&H00FFFFFF';
  const r = h.slice(0, 2); const g = h.slice(2, 4); const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`;
}

/** #RRGGBB + opacity 0-255 → &HAABBGGRR  (AA: 0=opaque, FF=transparent) */
function hexToAssWithAlpha(hex: string, opacity: number): string {
  if (hex.startsWith('&H')) return hex;
  const h = hex.replace('#', '');
  if (h.length < 6) return `&H80000000`;
  const r = h.slice(0, 2); const g = h.slice(2, 4); const b = h.slice(4, 6);
  // ASS alpha is INVERTED: 0=fully opaque, FF=fully transparent
  const alpha = Math.round(255 - Math.min(255, Math.max(0, opacity)));
  const aa = alpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${aa}${b}${g}${r}`;
}

/** Convert caption_position (0-100% from top) to ASS marginV (pixels from bottom).
 *  caption_position=75 → 75% from top → 25% from bottom.
 *  On 1080p: 25% * 1080 ≈ 270px from bottom.
 *  On 1920x1080: typical safe zone is 50-200px from bottom.
 */
function positionToMarginV(positionPct: number, resH: number): number {
  const pct = Math.max(5, Math.min(95, positionPct));
  // distance from bottom = (100 - pct) / 100 * resH
  return Math.round(((100 - pct) / 100) * resH);
}

function defaultCaptionConfig(vc: VideoConfig, resH: number): CaptionConfig {
  const opacity = vc.caption_bg_opacity ?? 180;
  const posPct  = vc.caption_position  ?? 75;
  return {
    fontName:      vc.caption_font         ?? 'Inter',
    fontSize:      vc.caption_font_size    ?? 60,
    primaryColour: hexToAss(vc.caption_text_color    ?? '#FFFFFF'),
    activeColour:  hexToAss(vc.caption_active_color  ?? '#FFFF32'),
    backColour:    hexToAssWithAlpha(vc.caption_bg_color ?? '#1A0033', opacity),
    outlineColour: hexToAss('#000000'),
    outline:       0,
    shadow:        0,
    bold:          1,
    marginV:       positionToMarginV(posPct, resH),
    wordsPerGroup: 5,
    uppercase:     vc.caption_uppercase   ?? true,
  };
}

// ── ASS timestamp ─────────────────────────────────────────────────────────────

function toAssTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.floor((secs % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ── Caption clip descriptor ───────────────────────────────────────────────────

export interface CaptionClip {
  offset: number;
  duration: number;
  label: string;
  words: CaptionWord[];
}

// ── ASS file builder ──────────────────────────────────────────────────────────

/**
 * Build karaoke-style ASS subtitle file.
 *
 * Strategy:
 * - Group words into chunks of `wordsPerGroup`
 * - For each word position in the group, emit one Dialogue line covering
 *   that word's time window, with inline colour tags:
 *     active word → activeColour
 *     others      → primaryColour (text)
 */
export function buildAssFile(
  clips: CaptionClip[],
  outputPath: string,
  videoConfig: VideoConfig,
  resolution: [number, number] = [1920, 1080],
): string {
  const [resW, resH] = resolution;
  const cfg = defaultCaptionConfig(videoConfig, resH);

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
    // BorderStyle=3 → opaque box background using BackColour
    // Alignment=2 → bottom-center
    `Style: Default,${cfg.fontName},${cfg.fontSize},${cfg.primaryColour},${cfg.primaryColour},${cfg.outlineColour},${cfg.backColour},${cfg.bold},0,0,0,100,100,0,0,3,${cfg.outline},${cfg.shadow},2,20,20,${cfg.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogueLines: string[] = [];

  for (const clip of clips) {
    if (clip.words.length === 0) continue;

    // Group words into chunks
    for (let i = 0; i < clip.words.length; i += cfg.wordsPerGroup) {
      const group = clip.words.slice(i, i + cfg.wordsPerGroup);
      if (group.length === 0) continue;

      // Prepare display text for each word in the group
      const texts = group.map(w => {
        let t = w.word.trim();
        if (cfg.uppercase) t = t.toUpperCase();
        return t;
      });

      // Emit one Dialogue line per active word
      for (let activeIdx = 0; activeIdx < group.length; activeIdx++) {
        const activeWord = group[activeIdx];
        const start = clip.offset + activeWord.start;
        const end   = clip.offset + activeWord.end;

        const clampedStart = Math.max(0, start);
        const clampedEnd   = Math.min(clip.offset + clip.duration, end + 0.05);
        if (clampedEnd <= clampedStart) continue;

        // Build inline-coloured text
        // {\c&Hcolor&} changes primary colour for subsequent text
        // {\r} resets to Style default (= primaryColour)
        const parts = texts.map((t, idx) => {
          if (idx === activeIdx) {
            return `{\\c${cfg.activeColour}}${t}{\\c${cfg.primaryColour}}`;
          }
          return t;
        });
        const text = parts.join(' ');

        dialogueLines.push(
          `Dialogue: 0,${toAssTime(clampedStart)},${toAssTime(clampedEnd)},Default,,0,0,0,,${text}`,
        );
      }
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, header + '\n' + dialogueLines.join('\n') + '\n', 'utf8');

  return outputPath;
}