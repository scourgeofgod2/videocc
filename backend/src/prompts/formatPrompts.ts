// Format-specific LLM prompt templates — TypeScript port of Python src/providers/format_prompts.py

// Formats that tell a continuous story — visual continuity across sections
const CONTINUOUS_FORMATS = new Set(['true_crime', 'history', 'story']);

// Shared JSON schema template
const JSON_SCHEMA = `{
  "title": "catchy video title",
  "intro_narration": "intro narration following the length guidelines above",
  "intro_image_prompt": "{intro_image_style}",
  "sections": [
    {
      "number": 1,
      "heading": "section heading",
      "narration": "{narration_example}",
      "image_prompts": [
        "{first_image_style}",
        "{second_image_style}"
      ],
      "video_prompts": [
        "{first_video_style}",
        "{second_video_style}"
      ]
    }
  ],
  "outro_narration": "outro narration following the length guidelines above",
  "outro_image_prompt": "{outro_image_style}"
}`;

const IMAGE_NARRATIVE_BEATS = (imagesPerSection: number) =>
  `- image_prompts: REQUIRED array of exactly ${imagesPerSection} prompts per section
  - When multiple images per section, they must follow narrative beats:
    - Image 1: ESTABLISH the subject or scene (the setup)
    - Image 2: ZOOM INTO a key detail, reaction, or turning point (the focus)
    - Image 3+: Show the RESULT, consequence, or aftermath (the payoff)
  - Each prompt must be a single detailed sentence, unique and strictly relevant`;

const VIDEO_MOTION_RULES = (videosPerSection: number) =>
  `- video_prompts: REQUIRED array of exactly ${videosPerSection} prompts per section
  - Every video prompt MUST describe camera movement and action — NEVER a static scene, NO TEXT or words in any video
  - Use cinematic language: 'Slow dolly forward revealing...', 'Tracking shot following...', 'Aerial pull-back showing...', 'Time-lapse of...', 'Push-in close-up on...'
  - Within a section, video clips must form a CONTINUOUS VISUAL SEQUENCE:
    - Clip 1 sets up the scene with an establishing movement
    - Clip 2 pushes deeper into a detail or follows the action
    - Clip 3+ reveals the outcome or transitions to the next beat
  - Each clip should feel like the NEXT SHOT in a film, not a disconnected scene`;

const CONTINUITY_RULES =
  `- CROSS-SECTION VISUAL CONTINUITY (critical):
  - This is a continuous story — all image and video prompts must share a coherent visual world
  - Maintain the SAME characters, locations, and visual motifs across sections
  - Each section's visuals should feel like the next scene in a film, not a separate shoot
  - Evolve lighting and mood across the story arc:
    - Early sections: neutral or warm tones, establishing atmosphere
    - Middle sections: rising tension — darker, more dramatic lighting, tighter framing
    - Climax sections: peak intensity — harsh contrast, extreme angles, saturated color
    - Final sections: resolution — softer light, wider shots, calmer palette`;

const PACING_RULES =
  `- EMOTIONAL PACING in visuals:
  - Intro: curiosity and intrigue — wide establishing shots, mysterious or inviting mood
  - Early sections: build familiarity — medium shots, steady camera, warm tones
  - Mid sections: escalate tension — tighter framing, dynamic angles, cooler/darker tones
  - Late sections: climax — dramatic close-ups, high contrast, intense color
  - Outro: resolution — return to wide shots, golden/warm lighting, sense of closure`;

// ── Per-format configuration ─────────────────────────────────────────────────

interface FormatConfig {
  label: string;
  continuous: boolean;
  systemPrompt: string;
  narrationExample: string;
  introImageStyle: string;
  firstImageStyle: string;
  secondImageStyle: string;
  firstVideoStyle: string;
  secondVideoStyle: string;
  outroImageStyle: string;
  rules: string;
}

const FORMATS: Record<string, FormatConfig> = {
  listicle: {
    label: 'Listicle',
    continuous: false,
    systemPrompt:
      'You are an engaging YouTube script writer. Output ONLY valid JSON, nothing else.\n' +
      'Write narration that sounds natural when read aloud — conversational, vivid, and entertaining.\n' +
      'Image prompts should be one detailed sentence each.\n' +
      'Video prompts must always describe camera movement and action.',
    narrationExample: "Start with 'Number One, heading!' then narration following the length guidelines above",
    introImageStyle: 'eye-catching YouTube thumbnail with short catchy bold white text in the center of the image related to the topic, vibrant colorful background, dramatic lighting, high contrast, clickbait style, 16:9',
    firstImageStyle: 'detailed image with bold text overlay reading the section heading in the center, cinematic lighting, high quality',
    secondImageStyle: 'close-up detail shot revealing a key aspect of the subject, NO TEXT, purely visual, cinematic lighting',
    firstVideoStyle: 'Slow push-in on the subject establishing the scene, cinematic lighting, smooth camera movement',
    secondVideoStyle: 'Orbiting tracking shot around the subject revealing details from a new angle, dynamic camera, cinematic',
    outroImageStyle: 'cinematic image relevant to the video topic with a semi-transparent subscribe button and like/thumbs-up button overlaid in the bottom corner, 16:9',
    rules:
      '- Each section narration MUST begin with announcing the number and heading like "Number One, FlowState AI!" or "Number Three, CodeWhisper Pro!"\n' +
      '- The FIRST image_prompt per section MUST include bold readable text overlay of the section heading\n' +
      '- All OTHER image prompts must have NO TEXT — purely visual imagery',
  },
  true_crime: {
    label: 'True Crime',
    continuous: true,
    systemPrompt:
      'You are a compelling true-crime documentary narrator. Output ONLY valid JSON, nothing else.\n' +
      'Write narration that is suspenseful, gripping, and mysterious — like a Netflix documentary.\n' +
      'Use dramatic pauses, rhetorical questions, and cliffhangers between sections.\n' +
      'Image prompts should describe dark, moody, cinematic scenes.\n' +
      'Video prompts must describe camera movement — tracking shots, slow reveals, push-ins — never static.',
    narrationExample: 'Suspenseful narration that flows naturally into the next chapter, building tension',
    introImageStyle: 'dark cinematic thumbnail with mysterious shadowy figure or crime scene tape, bold white text hook in center, noir lighting, 16:9',
    firstImageStyle: 'dark moody establishing shot of the scene — a dimly lit location tied to the chapter, noir shadows, atmospheric fog, NO TEXT',
    secondImageStyle: 'tight close-up on a critical detail or piece of evidence from the scene, shallow depth of field, dramatic shadows, NO TEXT',
    firstVideoStyle: 'Slow tracking shot through the dimly lit scene, camera creeping forward, noir shadows, building suspense',
    secondVideoStyle: 'Gradual push-in close-up on a key piece of evidence or a shadowy figure, rack focus, tension building',
    outroImageStyle: 'haunting cinematic wide shot, dim lighting, unresolved atmosphere, subscribe overlay in corner, 16:9',
    rules:
      '- Narration should flow like a documentary — NO numbered announcements\n' +
      '- Each section is a chapter in the story, building suspense toward the next\n' +
      '- End each section with a cliffhanger or dramatic question to keep viewers hooked\n' +
      '- ALL image and video prompts must be atmospheric, moody, cinematic — NO TEXT in any image',
  },
  history: {
    label: 'History / Documentary',
    continuous: true,
    systemPrompt:
      'You are an authoritative yet engaging history documentary narrator. Output ONLY valid JSON, nothing else.\n' +
      'Write narration that is educational, rich with historical detail, and tells a compelling story.\n' +
      'Use vivid descriptions to bring historical events to life.\n' +
      'Image prompts should describe historical scenes, archival-style imagery, or cinematic recreations.\n' +
      'Video prompts must describe camera movement through historical settings — pans across battlefields, slow reveals of monuments, tracking shots through period locations.',
    narrationExample: 'Historically accurate narration that flows chronologically, rich with period detail and storytelling',
    introImageStyle: 'epic cinematic historical scene with bold title text overlay, dramatic lighting, period-accurate, 16:9',
    firstImageStyle: 'wide cinematic establishing shot of the historical setting for this chapter, period-accurate architecture and atmosphere, dramatic lighting, NO TEXT',
    secondImageStyle: 'close-up on a historically significant detail — a document, weapon, face, or artifact from this chapter, period-accurate, NO TEXT',
    firstVideoStyle: 'Sweeping aerial or dolly shot establishing the historical location, period-accurate environment, golden hour lighting',
    secondVideoStyle: 'Slow push-in on a historically significant artifact or figure, shallow depth of field, dramatic period lighting',
    outroImageStyle: 'sweeping cinematic historical landscape or monument, golden hour lighting, subscribe overlay in corner, 16:9',
    rules:
      '- Narration should flow chronologically like a documentary — NO numbered announcements\n' +
      '- Each section covers a key period, event, or figure in the story\n' +
      '- Use transitions between sections that connect historical events naturally\n' +
      '- ALL image and video prompts must be historically themed, cinematic — NO TEXT in any image',
  },
  tutorial: {
    label: 'Tutorial / How-To',
    continuous: false,
    systemPrompt:
      'You are a clear, friendly, and expert tutorial presenter. Output ONLY valid JSON, nothing else.\n' +
      "Write narration that is instructional, easy to follow, and encouraging.\n" +
      "Break complex topics into simple steps. Use direct language like 'First, you'll want to...'.\n" +
      'Image prompts should describe clean, well-lit instructional visuals.\n' +
      'Video prompts must describe camera movement showing the process — top-down shots, push-ins on details, smooth pans across workspaces.',
    narrationExample: 'Clear step-by-step instruction following the length guidelines, friendly and encouraging tone',
    introImageStyle: 'clean modern thumbnail with bold text showing the tutorial topic, bright professional lighting, 16:9',
    firstImageStyle: 'clean overhead or medium shot showing the setup for this step, bright even lighting, professional, NO TEXT',
    secondImageStyle: 'close-up on the key detail or result of this step, sharp focus, clean background, NO TEXT',
    firstVideoStyle: 'Smooth overhead tracking shot showing hands performing this step, bright even lighting, clean workspace',
    secondVideoStyle: 'Push-in close-up on the result or key detail of this step, shallow depth of field, professional lighting',
    outroImageStyle: 'polished final result shot with subscribe and like buttons overlaid in corner, bright lighting, 16:9',
    rules:
      '- Narration should be step-by-step — NO numbered countdown announcements\n' +
      "- Use natural transitions like 'Next, we'll...' or 'Now that we have that set up...'\n" +
      '- Each section is a logical step in the process\n' +
      '- ALL image and video prompts must be clean, instructional visuals — NO TEXT in any image',
  },
  story: {
    label: 'Story / Narrative',
    continuous: true,
    systemPrompt:
      'You are a masterful storyteller and YouTube narrator. Output ONLY valid JSON, nothing else.\n' +
      'Write narration that is immersive, vivid, and emotionally engaging — like a great audiobook.\n' +
      'Use descriptive language, character development, and dramatic pacing.\n' +
      'Image prompts should describe cinematic, story-driven visuals with consistent characters and settings.\n' +
      'Video prompts must describe camera movement that follows the action — tracking characters, revealing environments, building tension through motion.',
    narrationExample: 'Immersive narrative that draws the viewer into the story, vivid and emotionally engaging',
    introImageStyle: 'cinematic widescreen thumbnail with dramatic scene and bold hook text in center, atmospheric lighting, 16:9',
    firstImageStyle: 'wide cinematic establishing shot capturing the setting and mood of this chapter, atmospheric lighting, NO TEXT',
    secondImageStyle: "intimate close-up on a character's expression or a pivotal story moment, emotional lighting, shallow depth of field, NO TEXT",
    firstVideoStyle: "Slow cinematic establishing shot of the chapter's setting, atmospheric lighting, steady camera revealing the scene",
    secondVideoStyle: 'Tracking shot following the main action or character, dynamic camera matching the emotional intensity of the moment',
    outroImageStyle: 'atmospheric closing shot with reflective mood, subscribe overlay in corner, cinematic lighting, 16:9',
    rules:
      '- Narration should flow as continuous storytelling — NO numbered announcements\n' +
      '- Each section is a chapter that advances the narrative arc\n' +
      '- Build emotional tension and release across chapters\n' +
      '- ALL image and video prompts must be cinematic, story-driven — NO TEXT in any image\n' +
      '- Describe the SAME characters and settings consistently across all sections',
  },
  essay: {
    label: 'Video Essay',
    continuous: false,
    systemPrompt:
      'You are a thoughtful, analytical video essayist. Output ONLY valid JSON, nothing else.\n' +
      'Write narration that is intellectual, persuasive, and thought-provoking.\n' +
      'Present arguments, counterarguments, and insights with a clear thesis.\n' +
      'Image prompts should describe conceptual, artistic, or symbolic visuals.\n' +
      'Video prompts must describe camera movement through visual metaphors — slow reveals of symbols, abstract transitions, contemplative camera work.',
    narrationExample: "Analytical narration that builds an argument, thought-provoking and well-structured",
    introImageStyle: 'artistic conceptual thumbnail with bold thesis text in center, modern design, thought-provoking imagery, 16:9',
    firstImageStyle: 'conceptual or symbolic wide shot representing this argument point, artistic lighting, NO TEXT',
    secondImageStyle: 'different visual metaphor — an abstract or symbolic close-up reinforcing the argument, NO TEXT, artistic composition',
    firstVideoStyle: 'Slow contemplative dolly shot establishing a visual metaphor for this point, artistic lighting, moody atmosphere',
    secondVideoStyle: 'Smooth push-in on a symbolic detail that reinforces the argument, shallow depth of field, artistic composition',
    outroImageStyle: 'thought-provoking closing visual with subscribe overlay in corner, artistic composition, 16:9',
    rules:
      '- Narration should flow as a cohesive essay — NO numbered announcements\n' +
      '- Each section presents a key argument, point, or perspective\n' +
      '- Use intellectual transitions that connect ideas logically\n' +
      '- ALL image and video prompts must be conceptual, artistic, or symbolic — NO TEXT in any image',
  },
};

// ── Builders ──────────────────────────────────────────────────────────────────

function buildJsonBlock(f: FormatConfig): string {
  return JSON_SCHEMA
    .replace('{intro_image_style}', f.introImageStyle)
    .replace('{narration_example}', f.narrationExample)
    .replace('{first_image_style}', f.firstImageStyle)
    .replace('{second_image_style}', f.secondImageStyle)
    .replace('{first_video_style}', f.firstVideoStyle)
    .replace('{second_video_style}', f.secondVideoStyle)
    .replace('{outro_image_style}', f.outroImageStyle);
}

function buildMediaRules(f: FormatConfig, imagesPerSection: number, videosPerSection: number): string {
  const parts = [
    IMAGE_NARRATIVE_BEATS(imagesPerSection),
    VIDEO_MOTION_RULES(videosPerSection),
  ];
  if (f.continuous) parts.push(CONTINUITY_RULES);
  parts.push(PACING_RULES);
  return parts.join('\n');
}

export function buildUserPrompt(opts: {
  fmt: string;
  topic: string;
  numSections: number;
  styleInstruction: string;
  lengthInstruction: string;
  imagesPerSection: number;
  videosPerSection?: number;
}): string {
  const { fmt, topic, numSections, styleInstruction, lengthInstruction, imagesPerSection, videosPerSection = 1 } = opts;
  const f = FORMATS[fmt] ?? FORMATS['listicle'];
  const jsonBlock = buildJsonBlock(f);
  const mediaRules = buildMediaRules(f, imagesPerSection, videosPerSection);
  const sectionLabel = fmt === 'listicle' ? 'sections' : 'chapters';

  return (
    `Create a ${f.label.toLowerCase()} script about: "${topic}"\n` +
    `${styleInstruction}\n` +
    `${lengthInstruction}\n\n` +
    `Return ONLY this JSON (no other text):\n` +
    `${jsonBlock}\n\n` +
    `Rules:\n` +
    `- Exactly ${numSections} ${sectionLabel}\n` +
    `- STRICTLY follow the VIDEO LENGTH guidelines above for narration length in intro, sections, and outro\n` +
    `- intro_image_prompt: must be an eye-catching YouTube thumbnail with short catchy bold text centered in the image\n` +
    `${f.rules}\n` +
    `${mediaRules}\n` +
    `- outro_image_prompt: must be a visually striking image RELEVANT to the video topic, with subscribe and like buttons overlaid in a corner\n` +
    `- All narration should sound natural when spoken aloud`
  );
}

export function buildCustomPrompt(opts: {
  fmt: string;
  topic: string;
  numSections: number;
  styleInstruction: string;
  lengthInstruction: string;
  imagesPerSection: number;
  customInstructions: string;
  videosPerSection?: number;
}): string {
  const { fmt, topic, numSections, styleInstruction, lengthInstruction, imagesPerSection, customInstructions, videosPerSection = 1 } = opts;
  const f = FORMATS[fmt] ?? FORMATS['listicle'];
  const jsonBlock = buildJsonBlock(f);
  const mediaRules = buildMediaRules(f, imagesPerSection, videosPerSection);
  const sectionLabel = fmt === 'listicle' ? 'sections' : 'chapters';

  return (
    `Use the following custom instructions to write the script:\n\n` +
    `--- CUSTOM INSTRUCTIONS ---\n` +
    `${customInstructions}\n` +
    `--- END CUSTOM INSTRUCTIONS ---\n\n` +
    `Topic: "${topic}"\n` +
    `${styleInstruction}\n` +
    `${lengthInstruction}\n\n` +
    `You MUST output ONLY valid JSON in this exact format (no other text):\n` +
    `${jsonBlock}\n\n` +
    `Rules:\n` +
    `- Exactly ${numSections} ${sectionLabel}\n` +
    `- STRICTLY follow the VIDEO LENGTH guidelines above for narration length in intro, sections, and outro\n` +
    `- intro_image_prompt: must be an eye-catching YouTube thumbnail with short catchy bold text centered in the image\n` +
    `${f.rules}\n` +
    `${mediaRules}\n` +
    `- All narration should sound natural when spoken aloud\n` +
    `- Follow the custom instructions above for content, tone, and structure — but always output the JSON format specified`
  );
}

export function getSystemPrompt(fmt: string): string {
  return (FORMATS[fmt] ?? FORMATS['listicle']).systemPrompt;
}

export function getAvailableFormats(): Array<{ key: string; label: string }> {
  return Object.entries(FORMATS).map(([key, f]) => ({ key, label: f.label }));
}