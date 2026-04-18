import { useEffect, useRef, useState } from "react"
import { api } from "../api/client"
import type { RunState } from "../api/client"
import { ImageApprovalPanel } from "./ImageApprovalPanel"
import { WizardNav } from "./TopicForm"

interface Props {
  run: RunState
  onDelete: () => void
  onReassemble: () => void
  onRunUpdated: (run: RunState) => void
}

interface ScriptData {
  title?: string
  format?: string
  language?: string
  intro_narration?: string
  outro_narration?: string
  sections?: Array<{
    heading?: string
    title?: string
    narration: string
  }>
}

/** Maps run status to wizard step index (steps 0-3 are in TopicForm, 4-6 are here) */
function statusToStep(status: string): number {
  switch (status) {
    case "pending":
    case "running":
      return 4 // İnceleme — actively processing
    case "awaiting_approval":
      return 4 // Script review
    case "awaiting_image_approval":
      return 5 // Image review
    case "done":
      return 6 // Video
    case "error":
      return 4
    default:
      return 4
  }
}

export function RunDetail({ run, onDelete, onReassemble, onRunUpdated }: Props) {
  const [logs, setLogs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<"logs" | "script" | "images" | "video">("logs")
  const [script, setScript] = useState<ScriptData | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLogs([])
    setScript(null)
    setActiveTab("logs")
    if (unsubRef.current) unsubRef.current()

    if (run.status === "running" || run.status === "pending") {
      unsubRef.current = api.streamLogs(
        run.id,
        (line) => setLogs((prev) => [...prev, line]),
        (s) => {
          if (s === "awaiting_approval") setActiveTab("script")
          if (s === "awaiting_image_approval") setActiveTab("images")
          if (s === "done") setActiveTab("video")
        }
      )
    } else if (run.status === "awaiting_approval") {
      setActiveTab("script")
    } else if (run.status === "awaiting_image_approval") {
      setActiveTab("images")
    } else if (run.status === "done") {
      setActiveTab("video")
    }

    if (run.script) {
      setScript(run.script as ScriptData)
    }

    return () => { if (unsubRef.current) unsubRef.current() }
  }, [run.id])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  // Sync tab when run.status changes externally (polling)
  useEffect(() => {
    if (run.status === "awaiting_approval" && activeTab === "logs") setActiveTab("script")
    if (run.status === "awaiting_image_approval" && activeTab !== "images") setActiveTab("images")
    if (run.status === "done" && activeTab !== "video") setActiveTab("video")
  }, [run.status])

  useEffect(() => {
    if (run.script) {
      setScript(run.script as ScriptData)
    }
  }, [run.script])

  const handleApprove = async () => {
    const res = await api.approveScript(run.id)
    onRunUpdated(res)
    setActiveTab("logs")
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = api.streamLogs(
      run.id,
      (line) => setLogs((prev) => [...prev, line]),
      (s) => {
        if (s === "awaiting_image_approval") setActiveTab("images")
        if (s === "done") setActiveTab("video")
      }
    )
  }

  const handleRegenerate = async () => {
    const res = await api.regenerateScript(run.id)
    onRunUpdated(res)
    setActiveTab("logs")
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = api.streamLogs(
      run.id,
      (line) => setLogs((prev) => [...prev, line]),
      (s) => {
        if (s === "awaiting_approval") setActiveTab("script")
        if (s === "awaiting_image_approval") setActiveTab("images")
        if (s === "done") setActiveTab("video")
      }
    )
  }

  const wizardStep = statusToStep(run.status)

  // Allow clicking completed wizard steps to switch tabs
  const handleWizardStepClick = (i: number) => {
    if (i === 4 && (run.status === "awaiting_approval" || run.status === "done" || run.status === "awaiting_image_approval")) {
      setActiveTab("script")
    } else if (i === 5 && (run.status === "awaiting_image_approval" || run.status === "done")) {
      setActiveTab("images")
    } else if (i === 6 && run.status === "done") {
      setActiveTab("video")
    }
  }

  const statusLabel: Record<string, string> = {
    pending: "⏳ Bekliyor",
    running: "🔄 Çalışıyor",
    awaiting_approval: "✍️ Onay Bekliyor",
    awaiting_image_approval: "🖼️ Görsel Onayı",
    done: "✅ Tamamlandı",
    error: "❌ Hata",
  }

  return (
    <div className="run-detail">
      {/* Unified wizard nav — steps 0-3 are "done" (form submitted), 4-6 are active/pending */}
      <WizardNav step={wizardStep} onStepClick={handleWizardStepClick} />

      <div className="run-detail__header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="run-detail__title">{run.topic}</span>
          <span className="run-detail__status">{statusLabel[run.status] ?? run.status}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {run.status === "done" && (
            <button className="btn btn--ghost btn--sm" onClick={onReassemble}>
              🔄 Yeniden Birleştir
            </button>
          )}
          <button className="btn btn--ghost btn--sm btn--danger" onClick={onDelete}>
            🗑️ Sil
          </button>
        </div>
      </div>

      {/* Secondary tab nav for within-step navigation */}
      <div className="run-detail__tabs">
        <button
          className={`run-detail__tab${activeTab === "logs" ? " run-detail__tab--active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          📋 Loglar
        </button>
        {(run.status === "awaiting_approval" || script) && (
          <button
            className={`run-detail__tab${activeTab === "script" ? " run-detail__tab--active" : ""}`}
            onClick={() => setActiveTab("script")}
          >
            ✍️ Script İncele
          </button>
        )}
        {(run.status === "awaiting_image_approval" || run.status === "done") && (
          <button
            className={`run-detail__tab${activeTab === "images" ? " run-detail__tab--active" : ""}`}
            onClick={() => setActiveTab("images")}
          >
            🖼️ Görseller
          </button>
        )}
        {run.status === "done" && (
          <button
            className={`run-detail__tab${activeTab === "video" ? " run-detail__tab--active" : ""}`}
            onClick={() => setActiveTab("video")}
          >
            🎬 Video
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="run-detail__content">
        {activeTab === "images" && (
          <ImageApprovalPanel
            runId={run.id}
            onApprove={async () => {
              const res = await api.approveImages(run.id)
              onRunUpdated(res)
              setActiveTab("logs")
              if (unsubRef.current) unsubRef.current()
              unsubRef.current = api.streamLogs(
                run.id,
                (line) => setLogs((prev) => [...prev, line]),
                (s) => { if (s === "done") setActiveTab("video") }
              )
            }}
            onRegenerate={async () => {
              const res = await api.regenerateImages(run.id)
              onRunUpdated(res)
              setActiveTab("logs")
              if (unsubRef.current) unsubRef.current()
              unsubRef.current = api.streamLogs(
                run.id,
                (line) => setLogs((prev) => [...prev, line]),
                (s) => {
                  if (s === "awaiting_image_approval") setActiveTab("images")
                  if (s === "done") setActiveTab("video")
                }
              )
            }}
          />
        )}

        {activeTab === "script" && (
          <div className="script-review">
            <div className="script-review__actions">
              <button className="btn btn--primary" onClick={handleApprove} disabled={run.status !== "awaiting_approval"}>
                ✅ Onayla & Devam Et
              </button>
              <button className="btn btn--ghost" onClick={handleRegenerate} disabled={run.status !== "awaiting_approval"}>
                🔄 Yeniden Oluştur
              </button>
            </div>
            {script ? (
              <div className="script-review__content">
                <h2>{script.title}</h2>
                <p style={{ opacity: 0.6, fontSize: 13 }}>{script.format} · {script.language}</p>
                {script.intro_narration && (
                  <div className="script-section script-section--intro">
                    <h3>🎬 Giriş (Intro)</h3>
                    <p>{script.intro_narration}</p>
                  </div>
                )}
                {script.sections?.map((sec, i) => (
                  <div key={i} className="script-section">
                    <h3>{sec.heading ?? sec.title ?? `Bölüm ${i + 1}`}</h3>
                    <p>{sec.narration}</p>
                  </div>
                ))}
                {script.outro_narration && (
                  <div className="script-section script-section--outro">
                    <h3>🎬 Kapanış (Outro)</h3>
                    <p>{script.outro_narration}</p>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ opacity: 0.5 }}>Script yükleniyor...</p>
            )}
          </div>
        )}

        {activeTab === "video" && (
          <div className="video-tab">
            {run.videoPath ? (
              <video
                src={`/api/runs/${run.id}/video`}
                controls
                style={{ width: "100%", maxWidth: 720, borderRadius: 12 }}
              />
            ) : (
              <p style={{ opacity: 0.5 }}>Video henüz hazır değil.</p>
            )}
          </div>
        )}

        {activeTab === "logs" && (
          <div className="logs-panel">
            {/* Running indicator */}
            {(run.status === "running" || run.status === "pending") && (
              <div className="logs-panel__running">
                <span className="logs-panel__dot" />
                {run.status === "pending" ? "İşlem kuyruğa alındı, başlatılıyor…" : "İşlem devam ediyor…"}
              </div>
            )}

            {run.status === "error" && (
              <div className="logs-panel__error-banner">
                ❌ Hata: {run.error ?? "Bilinmeyen hata"}
              </div>
            )}

            <div className="logs">
              {logs.length === 0 && run.status !== "error" ? (
                <p style={{ opacity: 0.4, fontSize: 13, padding: "8px 0" }}>Log bekleniyor…</p>
              ) : (
                logs.map((line, i) => {
                  const isErr = line.startsWith("[ERROR]") || line.toLowerCase().includes("error")
                  const isWarn = line.startsWith("[WARN]")
                  const isStep = /^step \d+\/\d+:/i.test(line)
                  const isDone = /^(all media generated|all voiceovers|video assembled|done|tamamlandı)/i.test(line)
                  const isImgDone = /^image done:/i.test(line)
                  const isImgStart = /^image start:/i.test(line)
                  const isMediaSrc = /^media source:/i.test(line)
                  const isSkip = /^skip /i.test(line)

                  let cls = "log-line"
                  let prefix = ""
                  if (isErr) { cls += " log-line--error"; prefix = "❌ " }
                  else if (isWarn) { cls += " log-line--warn"; prefix = "⚠️ " }
                  else if (isStep) { cls += " log-line--step"; prefix = "▶ " }
                  else if (isDone) { cls += " log-line--done"; prefix = "✅ " }
                  else if (isImgDone) { cls += " log-line--img-done"; prefix = "🖼️ " }
                  else if (isImgStart) { cls += " log-line--img-start"; prefix = "⬇️ " }
                  else if (isMediaSrc) { cls += " log-line--media-src"; prefix = "📌 " }
                  else if (isSkip) { cls += " log-line--skip" }

                  return (
                    <div key={i} className={cls}>
                      {prefix}{line}
                    </div>
                  )
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
