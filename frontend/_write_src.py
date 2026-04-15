import os

base = r'c:/Program Files/clipmatic.video/webapp/frontend/src'
os.makedirs(base + '/api', exist_ok=True)
os.makedirs(base + '/components', exist_ok=True)

# ── index.css ────────────────────────────────────────────────────────────────
with open(base + '/index.css', 'w', encoding='utf-8') as f:
    f.write('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n')

# ── src/api/client.ts ────────────────────────────────────────────────────────
with open(base + '/api/client.ts', 'w', encoding='utf-8') as f:
    f.write('''// Backend API client

const BASE = "/api"

export interface RunState {
  id: string
  status: "pending" | "running" | "done" | "error"
  topic: string
  numSections: number
  scriptFormat: string
  videoLength: string
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
  customInstructions?: string
  subtitles?: string[]
}

export interface FormatOption {
  key: string
  label: string
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
''')

# ── src/components/TopicForm.tsx ─────────────────────────────────────────────
with open(base + '/components/TopicForm.tsx', 'w', encoding='utf-8') as f:
    f.write('''import { useState, useEffect } from "react"
import { api, type FormatOption, type CreateRunBody } from "../api/client"

interface Props {
  onSubmit: (body: CreateRunBody) => void
  loading: boolean
}

export function TopicForm({ onSubmit, loading }: Props) {
  const [topic, setTopic] = useState("")
  const [numSections, setNumSections] = useState(5)
  const [scriptFormat, setScriptFormat] = useState("listicle")
  const [videoLength, setVideoLength] = useState("medium")
  const [customInstructions, setCustomInstructions] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [formats, setFormats] = useState<FormatOption[]>([])

  useEffect(() => {
    api.getFormats().then(setFormats).catch(console.error)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!topic.trim()) return
    onSubmit({
      topic: topic.trim(),
      numSections,
      scriptFormat,
      videoLength,
      customInstructions: customInstructions.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Topic</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Top 5 Programming Languages in 2025"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          disabled={loading}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Sections</label>
          <input
            type="number"
            min={3}
            max={15}
            value={numSections}
            onChange={(e) => setNumSections(Number(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Format</label>
          <select
            value={scriptFormat}
            onChange={(e) => setScriptFormat(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            disabled={loading}
          >
            {formats.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Length</label>
          <select
            value={videoLength}
            onChange={(e) => setVideoLength(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            disabled={loading}
          >
            <option value="short">Short (1–3 min)</option>
            <option value="medium">Medium (3–6 min)</option>
            <option value="long">Long (6–10 min)</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-gray-400 hover:text-gray-200 underline"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {showAdvanced && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Custom Instructions</label>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={4}
            placeholder="Optional: override default script generation with custom instructions..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
            disabled={loading}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !topic.trim()}
        className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        {loading ? "Generating…" : "Generate Video"}
      </button>
    </form>
  )
}
''')

# ── src/components/RunList.tsx ───────────────────────────────────────────────
with open(base + '/components/RunList.tsx', 'w', encoding='utf-8') as f:
    f.write('''import { type RunState } from "../api/client"

interface Props {
  runs: RunState[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-yellow-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
}

export function RunList({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) {
    return <p className="text-gray-500 text-sm">No runs yet. Generate your first video!</p>
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            onClick={() => onSelect(run.id)}
            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
              selectedId === run.id
                ? "border-blue-500 bg-gray-700"
                : "border-gray-700 bg-gray-800 hover:bg-gray-750"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[run.status]}`} />
              <span className="text-white text-sm font-medium truncate flex-1">{run.topic}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
              <span>{run.scriptFormat}</span>
              <span>•</span>
              <span>{run.videoLength}</span>
              <span>•</span>
              <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
''')

# ── src/components/RunDetail.tsx ─────────────────────────────────────────────
with open(base + '/components/RunDetail.tsx', 'w', encoding='utf-8') as f:
    f.write('''import { useEffect, useRef, useState } from "react"
import { api, type RunState } from "../api/client"

interface Props {
  run: RunState
  onRefresh: () => void
  onDelete: (id: string) => void
}

export function RunDetail({ run, onRefresh, onDelete }: Props) {
  const [logs, setLogs] = useState<string[]>(run.logs)
  const [status, setStatus] = useState(run.status)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLogs(run.logs)
    setStatus(run.status)

    if (run.status === "running" || run.status === "pending") {
      const unsub = api.streamLogs(
        run.id,
        (line) => setLogs((prev) => [...prev, line]),
        (s) => {
          setStatus(s as RunState["status"])
          onRefresh()
        }
      )
      return unsub
    }
  }, [run.id, run.status])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const handleReassemble = async () => {
    await api.reassemble(run.id)
    onRefresh()
  }

  const handleDelete = async () => {
    if (!window.confirm("Delete this run?")) return
    await api.deleteRun(run.id)
    onDelete(run.id)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{run.topic}</h2>
          <p className="text-sm text-gray-400">
            {run.scriptFormat} · {run.videoLength} · {run.numSections} sections
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {run.status === "done" && (
            <button
              onClick={handleReassemble}
              className="px-3 py-1 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded"
            >
              Re-assemble
            </button>
          )}
          <button
            onClick={handleDelete}
            className="px-3 py-1 text-sm bg-red-800 hover:bg-red-700 text-white rounded"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Status */}
      <div className={`text-sm font-semibold px-3 py-1 rounded inline-block ${
        status === "done" ? "bg-green-700 text-green-100" :
        status === "error" ? "bg-red-700 text-red-100" :
        status === "running" ? "bg-yellow-700 text-yellow-100" :
        "bg-gray-700 text-gray-100"
      }`}>
        {status.toUpperCase()}
      </div>

      {run.error && (
        <div className="bg-red-900/50 border border-red-700 rounded p-3 text-red-300 text-sm">
          {run.error}
        </div>
      )}

      {/* Video player */}
      {run.status === "done" && run.videoPath && (
        <div className="rounded-lg overflow-hidden bg-black">
          <video
            controls
            className="w-full max-h-72"
            src={`/api/runs/${run.id}/video`}
          />
        </div>
      )}

      {/* Logs */}
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-2">Logs</h3>
        <div className="bg-gray-950 rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
          {logs.length === 0 && <span className="text-gray-600">No logs yet…</span>}
          {logs.map((line, i) => (
            <div key={i} className="leading-relaxed">{line}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}
''')

# ── src/App.tsx ──────────────────────────────────────────────────────────────
with open(base + '/App.tsx', 'w', encoding='utf-8') as f:
    f.write('''import { useEffect, useState } from "react"
import { api, type RunState, type CreateRunBody } from "./api/client"
import { TopicForm } from "./components/TopicForm"
import { RunList } from "./components/RunList"
import { RunDetail } from "./components/RunDetail"

export default function App() {
  const [runs, setRuns] = useState<RunState[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null

  const fetchRuns = async () => {
    try {
      const fetched = await api.getRuns()
      setRuns(fetched)
    } catch (e) {
      console.error("fetchRuns", e)
    }
  }

  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleCreate = async (body: CreateRunBody) => {
    setCreating(true)
    setError(null)
    try {
      const run = await api.createRun(body)
      setRuns((prev) => [run, ...prev])
      setSelectedId(run.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const handleRefresh = async () => {
    await fetchRuns()
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <span className="text-xl font-bold text-blue-400">🎬 Clipmatic</span>
          <span className="text-gray-500 text-sm">AI Video Generator</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: form + run list */}
        <div className="space-y-6">
          {/* New video form */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h2 className="text-base font-semibold text-white mb-4">New Video</h2>
            {error && (
              <div className="mb-3 bg-red-900/50 border border-red-700 rounded p-2 text-red-300 text-sm">
                {error}
              </div>
            )}
            <TopicForm onSubmit={handleCreate} loading={creating} />
          </div>

          {/* Run history */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h2 className="text-base font-semibold text-white mb-4">
              History ({runs.length})
            </h2>
            <RunList runs={runs} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>

        {/* Right column: run detail */}
        <div className="lg:col-span-2">
          {selectedRun ? (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <RunDetail run={selectedRun} onRefresh={handleRefresh} onDelete={handleDelete} />
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex items-center justify-center h-64">
              <p className="text-gray-500">Select a run to see details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
''')

# ── src/main.tsx ─────────────────────────────────────────────────────────────
with open(base + '/main.tsx', 'w', encoding='utf-8') as f:
    f.write('''import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
''')

print('all src files written')