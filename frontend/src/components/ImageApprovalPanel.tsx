import { useEffect, useState } from "react"
import { api } from "../api/client"

interface Props {
  runId: string
  onApprove: () => Promise<void>
  onRegenerate: () => Promise<void>
}

export function ImageApprovalPanel({ runId, onApprove, onRegenerate }: Props) {
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenMap, setRegenMap] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  // Cache-buster per image
  const [cacheBust, setCacheBust] = useState<Record<string, number>>({})

  useEffect(() => {
    let active = true
    setLoading(true)
    console.log('[ImageApprovalPanel] fetching images for run', runId)
    api.getImages(runId).then((imgs) => {
      console.log('[ImageApprovalPanel] got images:', imgs)
      if (active) {
        setImages(imgs)
        setLoading(false)
      }
    }).catch((err) => {
      console.error('[ImageApprovalPanel] error fetching images:', err)
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [runId])

  const handleApprove = async () => {
    setApproving(true)
    try { await onApprove() } finally { setApproving(false) }
  }

  const handleRegenerate = async () => {
    setRegenerating(true)
    try { await onRegenerate() } finally { setRegenerating(false) }
  }

  const handleRegenSingle = async (url: string) => {
    // Extract filename from URL: /api/runs/:id/images/:filename
    const filename = url.split("/").pop()
    if (!filename) return
    setRegenMap(m => ({ ...m, [url]: true }))
    try {
      await api.regenerateSingleImage(runId, filename)
      // Force re-fetch with cache-buster
      setCacheBust(m => ({ ...m, [url]: Date.now() }))
    } catch (e) {
      console.error('[ImageApprovalPanel] single regen failed:', e)
    } finally {
      setRegenMap(m => ({ ...m, [url]: false }))
    }
  }

  const imageUrl = (url: string) => {
    const bust = cacheBust[url]
    return bust ? `${url}?t=${bust}` : url
  }

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(255,200,80,0.08)", border: "var(--border-w) solid rgba(255,200,80,0.3)", borderRadius: 8, fontSize: 13 }}>
        🖼 <strong>Görseller hazır.</strong> Tek tek yenileyebilir ya da tümünü onaylayabilirsiniz.
      </div>

      {loading && (
        <div style={{ color: "var(--fg-dim)", fontSize: 13, marginBottom: 16 }}>Görseller yükleniyor…</div>
      )}

      {!loading && images.length === 0 && (
        <div style={{ color: "var(--fg-dim)", fontSize: 13, marginBottom: 16 }}>Henüz görsel bulunamadı.</div>
      )}

      {images.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}>
          {images.map((url) => {
            const isRegenning = !!regenMap[url]
            return (
              <div
                key={url}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "var(--border-w) solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{ cursor: "zoom-in" }}
                  onClick={() => setLightbox(imageUrl(url))}
                >
                  <img
                    src={imageUrl(url)}
                    alt=""
                    style={{ width: "100%", display: "block", objectFit: "cover", aspectRatio: "1", opacity: isRegenning ? 0.4 : 1, transition: "opacity 0.2s" }}
                    loading="lazy"
                  />
                </div>
                {/* Per-image regen button */}
                <button
                  onClick={() => handleRegenSingle(url)}
                  disabled={isRegenning || approving || regenerating}
                  title="Bu görseli yenile"
                  style={{
                    position: "absolute",
                    bottom: 6,
                    right: 6,
                    background: "rgba(0,0,0,0.7)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 16,
                    cursor: isRegenning ? "default" : "pointer",
                    padding: "4px 7px",
                    lineHeight: 1,
                  }}
                >
                  {isRegenning ? "⏳" : "🔄"}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={approving || regenerating}
          onClick={handleApprove}
        >
          {approving ? "Onaylanıyor…" : "✅ Onayla & Videoyu Oluştur"}
        </button>
        <button
          className="btn btn--ghost"
          style={{ flex: 1 }}
          disabled={approving || regenerating}
          onClick={handleRegenerate}
        >
          {regenerating ? "Yeniden oluşturuluyor…" : "🔄 Tümünü Yenile"}
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              objectFit: "contain",
              borderRadius: 12,
              boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
            }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute",
              top: 20,
              right: 24,
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 32,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}