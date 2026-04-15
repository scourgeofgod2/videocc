import { useState, useEffect, useCallback } from "react"
import { api, type RunState, type CreateRunBody } from "./api/client"
import { TopicForm } from "./components/TopicForm"
import { RunList } from "./components/RunList"
import { RunDetail } from "./components/RunDetail"

export default function App() {
  const [runs, setRuns] = useState<RunState[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Fetch all runs on mount and every 10s
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

  // Refresh a single run from backend
  const refreshRun = useCallback(async (id: string) => {
    try {
      const updated = await api.getRun(id)
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)))
    } catch {}
  }, [])

  // Poll selected run if it's running
  useEffect(() => {
    if (!selectedId) return
    const run = runs.find((r) => r.id === selectedId)
    if (!run || (run.status !== "running" && run.status !== "pending")) return
    const t = setInterval(() => refreshRun(selectedId), 5_000)
    return () => clearInterval(t)
  }, [selectedId, runs, refreshRun])

  return (
    <div className="app-shell">

      {/* NAV */}
      <header>
        <nav className="nav">
          <div className="container--wide">
            <div className="nav__inner">
              <a href="/" className="nav__logo" aria-label="videoCC Ana Sayfa">
                <span className="nav__logo-dot" aria-hidden="true" />
                videoCC<span className="text-accent">.ai</span>
              </a>
            </div>
          </div>
        </nav>
      </header>

      {/* BODY */}
      <div className="app-body">

        {/* SIDEBAR */}
        <aside className="sidebar">

          {/* New Video form */}
          <div className="sidebar__section">
            <div className="sidebar__section-header">
              <span className="sidebar__section-title">Yeni Video</span>
            </div>
            <div style={{ padding: 16 }}>
              <TopicForm onSubmit={handleCreate} loading={creating} />
            </div>
          </div>

          {/* Run history */}
          <div className="sidebar__section" style={{ flex: 1 }}>
            <div className="sidebar__section-header">
              <span className="sidebar__section-title">
                Geçmiş ({runs.length})
              </span>
              {runs.length > 0 && (
                <button
                  className="btn btn--ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => setSelectedId(null)}
                >
                  Temizle
                </button>
              )}
            </div>
            <RunList
              runs={runs}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

        </aside>

        {/* MAIN AREA */}
        <main className="main-area">
          {selectedRun ? (
            <RunDetail
              key={selectedRun.id}
              run={selectedRun}
              onDelete={() => handleDelete(selectedRun.id)}
              onReassemble={() => handleReassemble(selectedRun.id)}
            />
          ) : (
            <div className="empty-state" style={{ marginTop: 80 }}>
              <div className="empty-state__icon">🎬</div>
              <h2 className="empty-state__title">Hoş geldiniz!</h2>
              <p className="empty-state__desc">
                Sol taraftan bir konu girin ve AI destekli videonuzu oluşturun.
              </p>
            </div>
          )}
        </main>

      </div>
    </div>
  )
}
