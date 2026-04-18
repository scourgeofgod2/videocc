import { useState, useEffect, useCallback } from "react"
import { api, type RunState, type CreateRunBody } from "./api/client"
import { TopicForm } from "./components/TopicForm"
import { RunList } from "./components/RunList"
import { RunDetail } from "./components/RunDetail"

type View = "new" | "runs"

export default function App() {
  const [runs, setRuns] = useState<RunState[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<View>("new")

  const fetchRuns = useCallback(async () => {
    try {
      const data = await api.getRuns()
      setRuns(data)
    } catch (e) {
      console.error("getRuns failed:", e)
    }
  }, [])

  useEffect(() => {
    void fetchRuns()
    const t = setInterval(fetchRuns, 10_000)
    return () => clearInterval(t)
  }, [fetchRuns])

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null

  const handleCreate = async (body: CreateRunBody) => {
    setCreating(true)
    try {
      const run = await api.createRun(body)
      setRuns((prev) => [...prev, run])
      setSelectedId(run.id)
      setView("runs")
    } catch (e) {
      console.error("createRun failed:", e)
      alert("Video oluşturulamadı: " + String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Bu videoyu silmek istediğinizden emin misiniz?")) return
    try {
      await api.deleteRun(id)
      setRuns((prev) => prev.filter((r) => r.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      console.error("deleteRun failed:", e)
    }
  }

  const handleReassemble = async (id: string) => {
    try {
      const updated = await api.reassemble(id)
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)))
    } catch (e) {
      console.error("reassemble failed:", e)
    }
  }

  const refreshRun = useCallback(async (id: string) => {
    try {
      const updated = await api.getRun(id)
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)))
    } catch {}
  }, [])

  useEffect(() => {
    if (!selectedId) return
    const run = runs.find((r) => r.id === selectedId)
    if (!run || (run.status !== "running" && run.status !== "pending" && run.status !== "awaiting_approval")) return
    const t = setInterval(() => refreshRun(selectedId), 5_000)
    return () => clearInterval(t)
  }, [selectedId, runs, refreshRun])

  const runningCount = runs.filter(r => r.status === "running" || r.status === "pending").length

  return (
    <div className="app-shell">

      {/* NAV */}
      <header>
        <nav className="nav">
          <div className="nav__inner" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
            <a href="/" className="nav__logo" onClick={e => { e.preventDefault(); setView("new"); setSelectedId(null) }} aria-label="videoCC Ana Sayfa">
              <span className="nav__logo-dot" aria-hidden="true" />
              videoCC<span className="text-accent">.ai</span>
            </a>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
              <button
                className={`btn ${view === "new" ? "btn--primary" : "btn--ghost"}`}
                style={{ padding: "7px 16px", fontSize: 12 }}
                onClick={() => { setView("new"); setSelectedId(null) }}
              >
                ✦ Yeni Video
              </button>
              <button
                className={`btn ${view === "runs" ? "btn--primary" : "btn--ghost"}`}
                style={{ padding: "7px 16px", fontSize: 12, position: "relative" }}
                onClick={() => setView("runs")}
              >
                📁 Videolar
                {runs.length > 0 && (
                  <span style={{
                    marginLeft: 6, background: runningCount > 0 ? "var(--accent)" : "var(--border-strong)",
                    color: runningCount > 0 ? "#000" : "var(--text-muted)",
                    borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 800,
                  }}>
                    {runs.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </nav>
      </header>

      {/* BODY */}
      <div className="page-body">

        {/* NEW VIDEO view */}
        {view === "new" && (
          <div className="wizard-container">
            <div className="wizard-panel">
              <TopicForm onSubmit={handleCreate} loading={creating} />
            </div>
          </div>
        )}

        {/* RUNS view */}
        {view === "runs" && (
          <div className="runs-layout">

            {/* Run list column */}
            <div className="runs-list-col">
              <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: "var(--text-muted)" }}>
                  Geçmiş ({runs.length})
                </span>
                {runs.length > 0 && (
                  <button className="btn btn--ghost" style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() => setSelectedId(null)}>
                    Seçimi kaldır
                  </button>
                )}
              </div>
              <RunList
                runs={runs}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>

            {/* Run detail column */}
            <div className="runs-detail-col">
              {selectedRun ? (
                <RunDetail
                    key={selectedRun.id}
                    run={selectedRun}
                    onDelete={() => handleDelete(selectedRun.id)}
                    onReassemble={() => handleReassemble(selectedRun.id)}
                    onRunUpdated={(updated) => setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
                  />
              ) : (
                <div className="empty-state" style={{ marginTop: 100 }}>
                  <div className="empty-state__icon">👈</div>
                  <h2 className="empty-state__title">Bir video seçin</h2>
                  <p className="empty-state__desc">Soldan bir video seçerek detaylarını görün.</p>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
