import { useEffect, useRef, useState } from "react"
import { api, type RunState } from "../api/client"

interface Props {
  run: RunState
  onDelete: () => void
  onReassemble: () => void
}

const STATUS_LABEL: Record<RunState["status"], string> = {
  pending: "Bekliyor",
  running: "Üretiliyor",
  done:    "Tamamlandı",
  error:   "Hata",
}

const LENGTH_LABEL: Record<string, string> = {
  micro: "Mikro (<60sn)",
  short: "Kısa",
  medium: "Orta",
  long: "Uzun",
}

export function RunDetail({ run, onDelete, onReassemble }: Props) {
  const [logs, setLogs] = useState<string[]>(run.logs ?? [])
  const [status, setStatus] = useState(run.status)
  const [activeTab, setActiveTab] = useState<"logs" | "video">("logs")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  // Stream logs if running
  useEffect(() => {
    setLogs(run.logs ?? [])
    setStatus(run.status)

    if (run.status === "running" || run.status === "pending") {
      unsubRef.current?.()
      unsubRef.current = api.streamLogs(
        run.id,
        (line) => setLogs((prev) => [...prev, line]),
        (s) => {
          setStatus(s as RunState["status"])
          if (s === "done") setActiveTab("video")
        },
      )
    }

    return () => { unsubRef.current?.() }
  }, [run.id, run.status])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const videoUrl = run.videoPath
    ? `/api/runs/${run.id}/video`
    : null

  return (
    <div className="panel" style={{ height: "100%" }}>

      {/* Header */}
      <div className="detail-header">
        <div>
          <h2 className="detail-title">{run.topic}</h2>
        </div>
        <div className="detail-actions">
          {(status === "done" || status === "error") && (
            <button
              className="btn btn--ghost"
              onClick={onReassemble}
              title="Videoyu yeniden birleştir"
            >
              ↺ Yeniden
            </button>
          )}
          <button className="btn btn--danger" onClick={onDelete}>
            ✕ Sil
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="detail-meta">
        <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>
        <span className="badge">{run.scriptFormat}</span>
        <span className="badge">{LENGTH_LABEL[run.videoLength] ?? run.videoLength}</span>
        <span className="badge">{run.numSections} bölüm</span>
        <span className="badge">{run.language === "tr" ? "🇹🇷 TR" : "🇬🇧 EN"}</span>
        <span className="badge">{run.aspectRatio}</span>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab-btn${activeTab === "logs" ? " active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Loglar
        </button>
        <button
          className={`tab-btn${activeTab === "video" ? " active" : ""}`}
          onClick={() => setActiveTab("video")}
          disabled={!videoUrl}
        >
          Video
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "logs" && (
        <div style={{ padding: 16 }}>
          {/* Running indicator */}
          {status === "running" && (
            <div className="playing-bar active" style={{ marginBottom: 12 }}>
              <div className="playing-bar__waves" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>
              <span className="playing-bar__text">Üretiliyor…</span>
            </div>
          )}

          <div className="log-box">
            {logs.length === 0 ? (
              <span style={{ color: "var(--text-muted)" }}>Henüz log yok…</span>
            ) : (
              logs.map((line, i) => {
                const cls = line.includes("error") || line.includes("hata")
                  ? "log-line--error"
                  : line.includes("done") || line.includes("tamamland")
                    ? "log-line--done"
                    : "log-line--info"
                return (
                  <div key={i} className={`log-line ${cls}`}>{line}</div>
                )
              })
            )}
            <div ref={logsEndRef} />
          </div>

          {status === "error" && run.error && (
            <div style={{ marginTop: 12, padding: "12px 14px", border: "var(--border-w) solid var(--danger)", background: "rgba(255,71,87,0.07)", fontSize: 13, color: "var(--danger)" }}>
              ⚠ {run.error}
            </div>
          )}
        </div>
      )}

      {activeTab === "video" && (
        <div style={{ padding: 16 }}>
          {videoUrl ? (
            <>
              <div className="video-wrap">
                <video controls src={videoUrl} />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <a
                  href={videoUrl}
                  download={`${run.topic}.mp4`}
                  className="btn btn--primary"
                >
                  ↓ MP4 İndir
                </a>
              </div>
            </>
          ) : (
            <div className="video-wrap">
              <div className="video-placeholder">
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
                <p>Video henüz hazır değil</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
