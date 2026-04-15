// Backend API client

const BASE = "/api"

export interface RunState {
  id: string
  status: "pending" | "running" | "done" | "error"
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
  useGpu?: boolean
  gpuEncoder?: "nvenc" | "amf" | "qsv"
  imageModel?: "kie" | "nano-banana"
}

export interface FormatOption {
  key: string
  label: string
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
  updateScript: (id: string, script: unknown) =>
    req<{ ok: boolean }>(`/runs/${id}/script`, { method: "PUT", body: JSON.stringify(script) }),
  getFormats: () => req<{ formats: FormatOption[] }>("/runs/formats").then((r) => r.formats),
  getGoogleVoices: () => req<{ voices: GoogleTtsVoice[] }>("/runs/voices/google").then((r) => r.voices),
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
