// Backend API client

const BASE = "/api"

export interface RunState {
  id: string
  status: "pending" | "running" | "awaiting_approval" | "awaiting_image_approval" | "done" | "error"
  topic: string
  numSections: number
  scriptFormat: string
  videoLength: string
  language: "en" | "tr"
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
  voiceId?: string
  script?: unknown
  outputDir?: string
  videoPath?: string
  error?: string
  logs: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateRunBody {
  topic: string
  numSections?: number
  scriptFormat?: string
  videoLength?: string
  language?: "en" | "tr"
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
  voiceId?: string
  voiceProvider?: "cortexai" | "google_tts" | "inworld"
  customInstructions?: string
  subtitles?: string[]
  rawText?: string
  useGpu?: boolean
  gpuEncoder?: "nvenc" | "amf" | "qsv"
  imageModel?: "kie" | "nano-banana"
  mediaSource?: "ai_generate" | "pexels_photo" | "pexels_video" | "ddg_image" | "google_image"
  imagesPerSection?: number
  captionFont?: string
  captionFontSize?: number
  captionTextColor?: string
  captionActiveColor?: string
  captionBgColor?: string
  captionBgOpacity?: number
  captionUppercase?: boolean
  captionPosition?: number
}

export interface FormatOption {
  key: string
  label: string
  description: string
}

export interface GoogleTtsVoice {
  name: string
  gender: "female" | "male"
  label: string
  description: string
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${txt}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getRuns: () => req<{ runs: RunState[] }>("/runs").then((r) => r.runs),
  getRun: (id: string) => req<RunState>(`/runs/${id}`),
  createRun: (body: CreateRunBody) =>
    req<RunState>("/runs", { method: "POST", body: JSON.stringify(body) }),
  deleteRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}`, { method: "DELETE" }),
  reassemble: (id: string) => req<RunState>(`/runs/${id}/reassemble`, { method: "POST" }),
  approveScript: (id: string) => req<RunState>(`/runs/${id}/approve-script`, { method: "POST" }),
  regenerateScript: (id: string) => req<RunState>(`/runs/${id}/regenerate-script`, { method: "POST" }),
  approveImages: (id: string) => req<RunState>(`/runs/${id}/approve-images`, { method: "POST" }),
  regenerateImages: (id: string) => req<RunState>(`/runs/${id}/regenerate-images`, { method: "POST" }),
  getImages: (id: string) => req<{ images: string[] }>(`/runs/${id}/images`).then((r) => r.images),
  regenerateSingleImage: (id: string, filename: string) =>
    req<{ url: string; filename: string }>(`/runs/${id}/images/${filename}/regenerate`, { method: "POST" }),
  updateScript: (id: string, script: unknown) =>
    req<{ ok: boolean }>(`/runs/${id}/script`, { method: "PUT", body: JSON.stringify(script) }),
  getFormats: () => req<{ formats: FormatOption[] }>("/runs/formats").then((r) => r.formats),
  getGoogleVoices: () => req<{ voices: GoogleTtsVoice[] }>("/runs/voices/google").then((r) => r.voices),
  getIdeas: (topic: string, format: string, language: string) =>
    req<{ ideas: string[] }>(`/runs/ideas?topic=${encodeURIComponent(topic)}&format=${encodeURIComponent(format)}&language=${encodeURIComponent(language)}`).then((r) => r.ideas),
  streamLogs: (id: string, onLine: (line: string) => void, onDone: (status: string) => void): (() => void) => {
    const es = new EventSource(`/api/runs/${id}/logs`)
    es.onmessage = (e: MessageEvent) => {
      const d = JSON.parse(e.data as string) as { log?: string; done?: boolean; status?: string }
      if (d.log) onLine(d.log)
      if (d.done) {
        onDone(d.status ?? "done")
        es.close()
      }
    }
    es.onerror = () => { es.close(); onDone("error") }
    return () => es.close()
  },
}
