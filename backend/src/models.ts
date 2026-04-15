// Clipmatic Video - TypeScript Models
// Ported from Python src/models.py

export interface CaptionWord {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface CaptionSegment {
  text: string;
  start: number;
  end: number;
  words: CaptionWord[];
}

export interface Section {
  number: number;
  heading: string;
  narration: string;
  image_prompt: string;
  image_prompts: string[];
  video_prompts: string[];
  video_prompt: string;
  audio_path?: string;
  image_path?: string;
  image_paths: string[];
  video_path?: string;
  video_paths: string[];
  duration?: number;
  audio_cdn_url?: string;
  captions: CaptionSegment[];
}

export interface Script {
  title: string;
  format: string;
  intro_narration: string;
  intro_image_prompt: string;
  sections: Section[];
  outro_narration: string;
  outro_image_prompt: string;
  intro_audio_path?: string;
  outro_audio_path?: string;
  intro_image_path?: string;
  intro_image_paths: string[];
  intro_video_paths: string[];
  outro_image_path?: string;
  intro_duration?: number;
  outro_duration?: number;
  intro_audio_cdn_url?: string;
  outro_audio_cdn_url?: string;
  intro_captions: CaptionSegment[];
  outro_captions: CaptionSegment[];
}

export interface VideoConfig {
  resolution: [number, number];
  fps: number;
  transition: string;
  transition_duration: number;
  section_gap: number;
  ken_burns: boolean;
  encoding_preset: string;
  font: string;
  images_per_section: number;
  section_media_type: string;
  videos_per_section: number;
  video_gen_duration: number;
  intro_image_count: number;
  intro_video_count: number;
  captions_enabled: boolean;
  caption_font: string;
  caption_font_size: number;
  caption_text_color: string;
  caption_active_color: string;
  caption_bg_color: string;
  caption_bg_opacity: number;
  caption_uppercase: boolean;
  caption_position: number;
}

export interface ProviderConfig {
  provider: string;
  model?: string;
  api_key_env: string;
  voice_id?: string;
  size?: string;
  extra: Record<string, string>;
}

export interface AppConfig {
  llm: ProviderConfig;
  voice: ProviderConfig;
  image: ProviderConfig;
  video_gen?: ProviderConfig;
  video: VideoConfig;
}

export function defaultVideoConfig(): VideoConfig {
  return {
    resolution: [1920, 1080],
    fps: 30,
    transition: 'crossfade',
    transition_duration: 0.8,
    section_gap: 0.5,
    ken_burns: true,
    encoding_preset: 'fast',
    font: 'assets/fonts/Montserrat-Bold.ttf',
    images_per_section: 1,
    section_media_type: 'image',
    videos_per_section: 1,
    video_gen_duration: 5,
    intro_image_count: 1,
    intro_video_count: 2,
    captions_enabled: true,
    caption_font: 'assets/fonts/Montserrat-Bold.ttf',
    caption_font_size: 0,
    caption_text_color: '#FFFFFF',
    caption_active_color: '#FFFF32',
    caption_bg_color: '#000000',
    caption_bg_opacity: 160,
    caption_uppercase: true,
    caption_position: 75,
  };
}

export function createEmptySection(number: number): Section {
  return {
    number,
    heading: '',
    narration: '',
    image_prompt: '',
    image_prompts: [],
    video_prompts: [],
    video_prompt: '',
    image_paths: [],
    video_paths: [],
    captions: [],
  };
}

export function createEmptyScript(title: string): Script {
  return {
    title,
    format: 'listicle',
    intro_narration: '',
    intro_image_prompt: '',
    sections: [],
    outro_narration: '',
    outro_image_prompt: '',
    intro_image_paths: [],
    intro_video_paths: [],
    intro_captions: [],
    outro_captions: [],
  };
}

// Run state for API
export type RunStatus = 'pending' | 'running' | 'done' | 'error';

export type Language = 'en' | 'tr';
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export interface RunState {
  id: string;
  status: RunStatus;
  topic?: string;
  numSections?: number;
  scriptFormat?: string;
  videoLength?: string;
  language?: Language;
  aspectRatio?: AspectRatio;
  script?: Script;
  outputDir?: string;
  videoPath?: string;
  error?: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}