import type { RunState } from "../api/client"

interface Props {
  runs: RunState[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "şimdi"
  if (m < 60) return `${m}dk önce`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}sa önce`
  return `${Math.floor(h / 24)}g önce`
}

const STATUS_LABEL: Record<RunState["status"], string> = {
  pending: "Bekliyor",
  running: "Üretiliyor",
  done:    "Tamamlandı",
  error:   "Hata",
}

export function RunList({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "32px 16px" }}>
        <div className="empty-state__icon">🎬</div>
        <p className="empty-state__title">Henüz video yok</p>
        <p className="empty-state__desc">Sol taraftan konu girerek ilk videonuzu oluşturun.</p>
      </div>
    )
  }

  return (
    <div className="run-list">
      {[...runs].reverse().map((run) => (
        <div
          key={run.id}
          className={`run-item${selectedId === run.id ? " active" : ""}`}
          onClick={() => onSelect(run.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onSelect(run.id)}
        >
          <div className="run-item__topic">{run.topic}</div>
          <div className="run-item__meta">
            <span className={`badge badge--${run.status}`}>{STATUS_LABEL[run.status]}</span>
            <span className="run-item__meta-tag">{run.scriptFormat}</span>
            <span className="run-item__meta-tag">{run.videoLength === "short" ? "kısa" : run.videoLength === "medium" ? "orta" : "uzun"}</span>
            <span className="run-item__meta-tag">{run.numSections} bölüm</span>
            <span className="run-item__meta-tag" style={{ marginLeft: "auto" }}>{timeAgo(run.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
