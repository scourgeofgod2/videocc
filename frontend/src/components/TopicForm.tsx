import { useState, useEffect, useRef } from "react"
import { api, type FormatOption, type CreateRunBody, type GoogleTtsVoice } from "../api/client"

interface Props {
  onSubmit: (body: CreateRunBody) => void
  loading: boolean
}

// ── Caption theme presets ────────────────────────────────────────────────────
interface CaptionPreset {
  name: string
  textColor: string
  activeColor: string
  bgColor: string
  bgOpacity: number
  uppercase: boolean
}

const CAPTION_PRESETS: CaptionPreset[] = [
  { name: "Classic",   textColor: "#FFFFFF", activeColor: "#FFFF32", bgColor: "#1A0033", bgOpacity: 180, uppercase: true  },
  { name: "Neon",      textColor: "#FFFFFF", activeColor: "#00FF88", bgColor: "#000000", bgOpacity: 200, uppercase: true  },
  { name: "Fire",      textColor: "#FFFFFF", activeColor: "#FF6B00", bgColor: "#1A0000", bgOpacity: 200, uppercase: true  },
  { name: "Ocean",     textColor: "#FFFFFF", activeColor: "#00CFFF", bgColor: "#001A33", bgOpacity: 190, uppercase: false },
  { name: "Minimal",   textColor: "#FFFFFF", activeColor: "#FFFFFF", bgColor: "#000000", bgOpacity: 80,  uppercase: false },
  { name: "Sunset",    textColor: "#FFE066", activeColor: "#FF88B0", bgColor: "#2B0000", bgOpacity: 200, uppercase: false },
  { name: "Lavender",  textColor: "#FFFFFF", activeColor: "#CC99FF", bgColor: "#110022", bgOpacity: 200, uppercase: true  },
  { name: "Matrix",    textColor: "#00FF44", activeColor: "#AAFFCC", bgColor: "#000000", bgOpacity: 220, uppercase: false },
]

// ── Font options ─────────────────────────────────────────────────────────────
const FONTS = [
  { label: "Montserrat Bold",   path: "assets/fonts/Montserrat-Bold.ttf" },
  { label: "Inter Bold",        path: "assets/fonts/Inter-Bold.ttf" },
  { label: "Bebas Neue",        path: "assets/fonts/BebasNeue-Regular.ttf" },
  { label: "Roboto Bold",       path: "assets/fonts/Roboto-Bold.ttf" },
  { label: "Open Sans Bold",    path: "assets/fonts/OpenSans-Bold.ttf" },
]

// ── CortexAI TR voices ───────────────────────────────────────────────────────
const CORTEX_TR_VOICES = [
  { value: "FF7KdobWPaiR0vkcALHF", label: "David — Epic Movie Trailer" },
  { value: "Q2IX97JeHBY3vNGzgM5s", label: "Cavit — News Anchor, TV" },
  { value: "oR4uRy4fHDUGGISL0Rev", label: "Myrddin — Magical Narrator" },
  { value: "Jlv2ZNjZLZxnvSEXE6Oc", label: "Chris — Soft, Natural and Slow" },
  { value: "dNjajZuUYmsgcT357Rhg", label: "Emre Gökçe — Convincing, Warm" },
  { value: "K72v6nhNPFHUbP76lOVL", label: "Onur — Breathy, Smooth and Clear" },
  { value: "jaicbKf2LuAoprMLZ5Gd", label: "Yeşilçam Sevdası" },
  { value: "VtLFdkOJSt8TuXqwEzD8", label: "Yakut Akkaşoğlu — Professional" },
  { value: "WdZjiN0nNcik2LBjOHiv", label: "David — Raspy and Soft" },
]

const ASPECT_RATIOS = [
  { value: "9:16", label: "9:16 Dikey" },
  { value: "16:9", label: "16:9 Yatay" },
  { value: "1:1",  label: "1:1 Kare" },
  { value: "4:3",  label: "4:3" },
  { value: "3:4",  label: "3:4" },
]

// ── Wizard step definitions ──────────────────────────────────────────────────
export const WIZARD_STEPS = ["Konu", "Senaryo", "Seslendirme", "Medya", "İnceleme", "Görsel", "Video"]

export function WizardNav({ step, onStepClick }: { step: number; onStepClick?: (i: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28, overflowX: "auto", paddingBottom: 2 }}>
      {WIZARD_STEPS.map((s, i) => {
        const active = i === step
        const done = i < step
        const clickable = done && !!onStepClick
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
            <div
              onClick={() => clickable && onStepClick(i)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "8px 14px",
                background: active ? "var(--accent)" : done ? "var(--surface-2)" : "var(--surface)",
                border: "var(--border-w) solid " + (active ? "var(--accent)" : "var(--border)"),
                color: active ? "#000" : done ? "var(--text-secondary)" : "var(--text-muted)",
                fontWeight: 700, fontSize: 12, letterSpacing: "0.3px", textTransform: "uppercase",
                cursor: clickable ? "pointer" : "default",
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: active ? "#000" : done ? "var(--border-strong)" : "var(--border)",
                color: active ? "var(--accent)" : "#fff",
                fontSize: 10, fontWeight: 900, flexShrink: 0,
              }}>{done ? "✓" : i + 1}</span>
              {s}
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div style={{ width: 28, height: 2, background: i < step ? "var(--border-strong)" : "var(--border)", flexShrink: 0 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Caption preview ──────────────────────────────────────────────────────────
function CaptionPreview({
  textColor, activeColor, bgColor, bgOpacity, uppercase, fontLabel, position,
}: {
  textColor: string; activeColor: string; bgColor: string; bgOpacity: number
  uppercase: boolean; fontLabel: string; position: number
}) {
  const word1 = uppercase ? "AMAZING" : "Amazing"
  const word2 = uppercase ? "THINGS" : "Things"
  const alpha = (bgOpacity / 255).toFixed(2)
  const r = parseInt(bgColor.slice(1, 3), 16)
  const g = parseInt(bgColor.slice(3, 5), 16)
  const b = parseInt(bgColor.slice(5, 7), 16)
  const bg = `rgba(${r},${g},${b},${alpha})`
  const bottomPct = `${100 - position}%`
  return (
    <div style={{
      width: 130, height: 220, background: "#222", border: "2px solid var(--border)",
      position: "relative", overflow: "hidden", flexShrink: 0,
      backgroundImage: "repeating-linear-gradient(45deg, #2a2a2a 0, #2a2a2a 1px, transparent 0, transparent 50%)",
      backgroundSize: "10px 10px",
    }}>
      <div style={{
        position: "absolute",
        bottom: bottomPct,
        left: 0, right: 0,
        display: "flex", justifyContent: "center",
        padding: "0 8px",
        transform: "translateY(50%)",
      }}>
        <div style={{
          background: bg, padding: "5px 8px", textAlign: "center",
          fontFamily: `'${fontLabel.split(" ")[0]}', sans-serif`,
          fontWeight: 700, fontSize: 13, letterSpacing: "0.5px", lineHeight: 1.3,
        }}>
          <span style={{ color: textColor }}>{word1} </span>
          <span style={{ color: activeColor }}>{word2}</span>
        </div>
      </div>
    </div>
  )
}

// ── Caption style editor ─────────────────────────────────────────────────────
interface CaptionState {
  font: string
  fontSize: number
  textColor: string
  activeColor: string
  bgColor: string
  bgOpacity: number
  uppercase: boolean
  position: number
}

function CaptionStyleEditor({ value, onChange }: { value: CaptionState; onChange: (v: CaptionState) => void }) {
  const currentFontLabel = FONTS.find(f => f.path === value.font)?.label ?? FONTS[0].label

  const applyPreset = (p: CaptionPreset) => {
    onChange({ ...value, textColor: p.textColor, activeColor: p.activeColor, bgColor: p.bgColor, bgOpacity: p.bgOpacity, uppercase: p.uppercase })
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        border: "var(--border-w) solid var(--border-strong)",
        background: "var(--surface)", padding: "18px",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)" }}>Caption Style</span>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {/* Preview */}
          <CaptionPreview
            textColor={value.textColor}
            activeColor={value.activeColor}
            bgColor={value.bgColor}
            bgOpacity={value.bgOpacity}
            uppercase={value.uppercase}
            fontLabel={currentFontLabel}
            position={value.position}
          />

          {/* Controls */}
          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Font + Size row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Font</div>
                <select
                  className="field__select"
                  value={value.font}
                  onChange={e => onChange({ ...value, font: e.target.value })}
                  style={{ fontSize: 12 }}
                >
                  {FONTS.map(f => <option key={f.path} value={f.path}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Boyut (0=Oto)</div>
                <input
                  type="number" min={0} max={120} value={value.fontSize}
                  onChange={e => onChange({ ...value, fontSize: Number(e.target.value) })}
                  style={{ width: "100%", background: "var(--bg)", border: "var(--border-w) solid var(--border-strong)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 12, padding: "8px 10px", outline: "none" }}
                />
              </div>
            </div>

            {/* Colors row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Yazı Rengi", key: "textColor" as const },
                { label: "Aktif Kelime", key: "activeColor" as const },
                { label: "Arka Plan", key: "bgColor" as const },
              ].map(({ label, key }) => (
                <div key={key}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="color" value={value[key]}
                      onChange={e => onChange({ ...value, [key]: e.target.value })}
                      style={{ width: 28, height: 28, padding: 0, border: "2px solid var(--border-strong)", background: "none", cursor: "pointer", borderRadius: 0 }}
                    />
                    <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "monospace" }}>{value[key]}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Position + Opacity row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
                  Konum ({value.position}%)
                </div>
                <input
                  type="range" min={10} max={95} value={value.position}
                  onChange={e => onChange({ ...value, position: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
                  Arka Plan Opaklık ({value.bgOpacity})
                </div>
                <input
                  type="range" min={0} max={255} value={value.bgOpacity}
                  onChange={e => onChange({ ...value, bgOpacity: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
              </div>
            </div>

            {/* Uppercase toggle */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox" checked={value.uppercase}
                onChange={e => onChange({ ...value, uppercase: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: "var(--accent)" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Büyük harf</span>
            </label>
          </div>
        </div>

        {/* Theme presets */}
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CAPTION_PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              style={{
                padding: "5px 12px",
                border: "2px solid " + p.activeColor + "88",
                background: p.bgColor,
                color: p.textColor,
                fontFamily: "var(--font)", fontSize: 11, fontWeight: 700,
                letterSpacing: "0.3px", textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Page nav buttons ──────────────────────────────────────────────────────────
function PageNav({
  page, totalPages, onBack, onNext, nextLabel, nextDisabled, loading,
}: {
  page: number
  totalPages: number
  onBack: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  loading?: boolean
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
      {page > 0 && (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ flex: 1, padding: "11px 0", fontSize: 13 }}
          onClick={onBack}
          disabled={loading}
        >
          ← Geri
        </button>
      )}
      <button
        type={page === totalPages - 1 ? "submit" : "button"}
        className="btn btn--primary"
        style={{ flex: 2, padding: "11px 0", fontSize: 13 }}
        onClick={page < totalPages - 1 ? onNext : undefined}
        disabled={nextDisabled || loading}
      >
        {loading ? "Oluşturuluyor…" : (nextLabel ?? (page === totalPages - 1 ? "▶ Video Oluştur" : "İleri →"))}
      </button>
    </div>
  )
}

// ── Main form ────────────────────────────────────────────────────────────────
export function TopicForm({ onSubmit, loading }: Props) {
  const [wizardPage, setWizardPage] = useState(0)

  // Page 0: topic / input mode
  const [topic, setTopic] = useState("")
  const [scriptFormat, setScriptFormat] = useState("listicle")
  const [scriptInputMode, setScriptInputMode] = useState<"ai_generate" | "paste_text">("ai_generate")
  const [rawText, setRawText] = useState("")
  const [formats, setFormats] = useState<FormatOption[]>([])
  const [ideas, setIdeas] = useState<string[]>([])
  const [ideasLoading, setIdeasLoading] = useState(false)
  const [showIdeas, setShowIdeas] = useState(false)
  const ideasRef = useRef<HTMLDivElement>(null)

  // Page 1: script settings
  const [numSections, setNumSections] = useState(5)
  const [videoLength, setVideoLength] = useState("medium")
  const [language, setLanguage] = useState<"en" | "tr">("tr")
  const [aspectRatio, setAspectRatio] = useState("9:16")
  const [customInstructions, setCustomInstructions] = useState("")

  // Page 2: voice / caption
  const [voiceProvider, setVoiceProvider] = useState<"cortexai" | "google_tts" | "inworld">("google_tts")
  const [voiceId, setVoiceId] = useState(CORTEX_TR_VOICES[0].value)
  const [googleVoiceName, setGoogleVoiceName] = useState("Kore")
  const [googleVoices, setGoogleVoices] = useState<GoogleTtsVoice[]>([])
  const [caption, setCaption] = useState<CaptionState>({
    font: "assets/fonts/Montserrat-Bold.ttf",
    fontSize: 0,
    textColor: "#FFFFFF",
    activeColor: "#FFFF32",
    bgColor: "#1A0033",
    bgOpacity: 180,
    uppercase: true,
    position: 75,
  })

  // Page 3: media / render
  const [imageModel, setImageModel] = useState<"kie" | "nano-banana">("kie")
  const [mediaSource, setMediaSource] = useState<"ai_generate" | "pexels_photo" | "pexels_video" | "ddg_image" | "google_image">("ai_generate")
  const [imagesPerSection, setImagesPerSection] = useState(1)
  const [useGpu, setUseGpu] = useState(false)
  const [gpuEncoder, setGpuEncoder] = useState<"nvenc" | "amf" | "qsv">("nvenc")

  const TOTAL_PAGES = 4

  useEffect(() => {
    api.getFormats().then(setFormats).catch(console.error)
    api.getGoogleVoices().then(setGoogleVoices).catch(console.error)
  }, [])

  useEffect(() => {
    if (language === "en") setVoiceProvider("google_tts")
  }, [language])

  // Close ideas dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ideasRef.current && !ideasRef.current.contains(e.target as Node)) {
        setShowIdeas(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleIdeas = async () => {
    if (!topic.trim()) return
    setIdeasLoading(true)
    setShowIdeas(true)
    setIdeas([])
    try {
      const result = await api.getIdeas(topic.trim(), scriptFormat, language)
      setIdeas(result)
    } catch {
      setIdeas([])
    } finally {
      setIdeasLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (scriptInputMode === "ai_generate" && !topic.trim()) return
    if (scriptInputMode === "paste_text" && !rawText.trim()) return
    const isGoogle = voiceProvider === "google_tts"
    const isCortex = voiceProvider === "cortexai"
    const effectiveTopic = scriptInputMode === "paste_text"
      ? (topic.trim() || rawText.trim().split('\n')[0].substring(0, 120) || "Raw Text")
      : topic.trim()
    onSubmit({
      topic: effectiveTopic,
      numSections,
      scriptFormat,
      videoLength,
      language,
      aspectRatio: aspectRatio as CreateRunBody["aspectRatio"],
      voiceProvider,
      voiceId: isGoogle ? googleVoiceName : (isCortex ? voiceId : undefined),
      customInstructions: scriptInputMode === "ai_generate" ? (customInstructions.trim() || undefined) : undefined,
      rawText: scriptInputMode === "paste_text" ? (rawText.trim() || undefined) : undefined,
      useGpu: useGpu || undefined,
      gpuEncoder: useGpu ? gpuEncoder : undefined,
      imageModel: mediaSource === "ai_generate" ? imageModel : undefined,
      mediaSource: mediaSource === "ai_generate" ? undefined : mediaSource,
      imagesPerSection: mediaSource !== "pexels_video" ? imagesPerSection : undefined,
      captionFont: caption.font,
      captionFontSize: caption.fontSize,
      captionTextColor: caption.textColor,
      captionActiveColor: caption.activeColor,
      captionBgColor: caption.bgColor,
      captionBgOpacity: caption.bgOpacity,
      captionUppercase: caption.uppercase,
      captionPosition: caption.position,
    })
  }

  // Page 0 can proceed if topic is filled (or rawText if paste mode)
  const page0Valid = scriptInputMode === "paste_text"
    ? rawText.trim().length > 0
    : topic.trim().length > 0

  const providers = language === "tr"
    ? [{ value: "google_tts", label: "🌐 Google TTS" }, { value: "cortexai", label: "🤖 CortexAI" }]
    : [{ value: "google_tts", label: "🌐 Google TTS" }, { value: "inworld", label: "🎙️ Inworld AI" }]

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Wizard nav — only first 4 steps, clickable for completed ones */}
      <WizardNav
        step={wizardPage}
        onStepClick={(i) => { if (i < wizardPage) setWizardPage(i) }}
      />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PAGE 0: Konu — input mode + topic + format                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {wizardPage === 0 && (
        <>
          {/* Script input mode toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setScriptInputMode("ai_generate")}
              className={`btn ${scriptInputMode === "ai_generate" ? "btn--primary" : "btn--ghost"}`}
              style={{ flex: 1, fontSize: 12, padding: "7px 0" }}
              disabled={loading}
            >
              🤖 AI ile Oluştur
            </button>
            <button
              type="button"
              onClick={() => setScriptInputMode("paste_text")}
              className={`btn ${scriptInputMode === "paste_text" ? "btn--primary" : "btn--ghost"}`}
              style={{ flex: 1, fontSize: 12, padding: "7px 0" }}
              disabled={loading}
            >
              📋 Metin Yapıştır
            </button>
          </div>

          {/* Raw text area (paste mode) */}
          {scriptInputMode === "paste_text" && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="field__label">Ham Narrasyon Metni</label>
              <textarea
                className="field__textarea"
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                rows={8}
                placeholder="Seslendirmek istediğiniz metni buraya yapıştırın. AI metni bölümlere ayıracak ve görseller üretecek."
                disabled={loading}
                style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {rawText.trim().split(/\s+/).filter(Boolean).length} kelime
              </div>
            </div>
          )}

          {/* Topic input + Ideas */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
              Videon Ne Hakkında?
            </div>
            <div style={{ position: "relative" }} ref={ideasRef}>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  className="field__input"
                  style={{ flex: 1, fontSize: 15 }}
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="örn. Dünyanın En Güzel 5 Şehri"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleIdeas}
                  disabled={loading || !topic.trim() || ideasLoading}
                  className="btn btn--primary"
                  style={{ padding: "10px 16px", fontSize: 12, gap: 5, flexShrink: 0 }}
                >
                  {ideasLoading ? "…" : "✦ Fikirler"}
                </button>
              </div>

              {/* Ideas dropdown */}
              {showIdeas && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "var(--surface)", border: "var(--border-w) solid var(--border-strong)",
                  zIndex: 50, boxShadow: "var(--shadow-dark)",
                }}>
                  {ideasLoading ? (
                    <div style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}>Fikirler üretiliyor…</div>
                  ) : ideas.length === 0 ? (
                    <div style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}>Fikir bulunamadı.</div>
                  ) : (
                    ideas.map((idea, i) => (
                      <div
                        key={i}
                        onClick={() => { setTopic(idea); setShowIdeas(false) }}
                        style={{
                          padding: "12px 18px", fontSize: 13, cursor: "pointer", color: "var(--text)",
                          borderBottom: i < ideas.length - 1 ? "1px solid var(--border)" : "none",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        {idea}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Format cards */}
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
            Video Formatı
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 8 }}>
            {formats.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setScriptFormat(f.key)}
                disabled={loading}
                style={{
                  padding: "14px 10px",
                  border: "var(--border-w) solid " + (scriptFormat === f.key ? "var(--accent)" : "var(--border)"),
                  background: scriptFormat === f.key ? "var(--accent-dim)" : "var(--surface)",
                  color: scriptFormat === f.key ? "var(--accent)" : "var(--text)",
                  fontFamily: "var(--font)", textAlign: "center", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 5,
                  boxShadow: scriptFormat === f.key ? "var(--shadow-sm)" : "none",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.2px" }}>{f.label}</span>
                {f.description && (
                  <span style={{ fontSize: 10, color: scriptFormat === f.key ? "var(--accent)" : "var(--text-muted)", fontWeight: 400, lineHeight: 1.35 }}>
                    {f.description}
                  </span>
                )}
              </button>
            ))}
          </div>

          <PageNav
            page={wizardPage}
            totalPages={TOTAL_PAGES}
            onBack={() => setWizardPage(p => p - 1)}
            onNext={() => setWizardPage(p => p + 1)}
            nextDisabled={!page0Valid}
            loading={loading}
          />
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PAGE 1: Senaryo — language, aspect ratio, duration, sections         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {wizardPage === 1 && (
        <>
          {/* Row: Language + Aspect ratio */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 0 }}>
            <div className="field">
              <label className="field__label">Dil</label>
              <div className="lang-toggle">
                {(["tr", "en"] as const).map(lang => (
                  <button key={lang} type="button"
                    className={`lang-btn${language === lang ? " active" : ""}`}
                    onClick={() => setLanguage(lang)} disabled={loading}>
                    {lang === "tr" ? "🇹🇷 Türkçe" : "🇬🇧 İngilizce"}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label">En-Boy</label>
              <select className="field__select" value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)} disabled={loading}>
                {ASPECT_RATIOS.map(ar => <option key={ar.value} value={ar.value}>{ar.label}</option>)}
              </select>
            </div>
          </div>

          {/* Row: Duration + Sections */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="field">
              <label className="field__label">Süre</label>
              <select className="field__select" value={videoLength}
                onChange={e => setVideoLength(e.target.value)} disabled={loading}>
                <option value="micro">Mikro (&lt;60 sn) 🔥</option>
                <option value="short">Kısa (1–3 dk)</option>
                <option value="medium">Orta (3–6 dk)</option>
                <option value="long">Uzun (6–10 dk)</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label">Bölüm Sayısı</label>
              <input type="number" min={3} max={15} value={numSections}
                onChange={e => setNumSections(Number(e.target.value))} disabled={loading}
                style={{ width: "100%", background: "var(--bg)", border: "var(--border-w) solid var(--border-strong)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 14, padding: "10px 12px", outline: "none" }} />
            </div>
          </div>

          {/* Custom instructions (only in AI mode) */}
          {scriptInputMode === "ai_generate" && (
            <div className="field">
              <label className="field__label">Özel Talimatlar <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>(isteğe bağlı)</span></label>
              <textarea className="field__textarea" value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                rows={4} placeholder="Senaryo üretimini özelleştir…" disabled={loading} />
            </div>
          )}

          <PageNav
            page={wizardPage}
            totalPages={TOTAL_PAGES}
            onBack={() => setWizardPage(p => p - 1)}
            onNext={() => setWizardPage(p => p + 1)}
            loading={loading}
          />
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PAGE 2: Seslendirme — voice engine + caption style                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {wizardPage === 2 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            🎙️ Ses Motoru
          </div>

          <div className="field">
            <label className="field__label">Ses Motoru</label>
            <div className="lang-toggle">
              {providers.map(p => (
                <button key={p.value} type="button"
                  className={`lang-btn${voiceProvider === p.value ? " active" : ""}`}
                  onClick={() => setVoiceProvider(p.value as "cortexai" | "google_tts" | "inworld")}
                  disabled={loading}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {voiceProvider === "google_tts" && googleVoices.length > 0 && (
            <div className="field">
              <label className="field__label">🎙️ Seslendirici (Google)</label>
              <select className="field__select" value={googleVoiceName}
                onChange={e => setGoogleVoiceName(e.target.value)} disabled={loading}>
                {googleVoices.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>
          )}

          {voiceProvider === "cortexai" && language === "tr" && (
            <div className="field">
              <label className="field__label">🎙️ Seslendirici (CortexAI)</label>
              <select className="field__select" value={voiceId}
                onChange={e => setVoiceId(e.target.value)} disabled={loading}>
                {CORTEX_TR_VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0 12px" }} />
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
            💬 Altyazı Stili
          </div>

          <CaptionStyleEditor value={caption} onChange={setCaption} />

          <PageNav
            page={wizardPage}
            totalPages={TOTAL_PAGES}
            onBack={() => setWizardPage(p => p - 1)}
            onNext={() => setWizardPage(p => p + 1)}
            loading={loading}
          />
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PAGE 3: Medya — image model + GPU + submit                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {wizardPage === 3 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            🖼️ Medya Kaynağı
          </div>

          <div className="field">
            <label className="field__label">Medya Kaynağı</label>
            <div className="lang-toggle" style={{ flexWrap: "wrap" }}>
              <button type="button"
                className={`lang-btn${mediaSource === "ai_generate" ? " active" : ""}`}
                onClick={() => setMediaSource("ai_generate")} disabled={loading}>
                🤖 AI Oluştur
              </button>
              <button type="button"
                className={`lang-btn${mediaSource === "pexels_photo" ? " active" : ""}`}
                onClick={() => setMediaSource("pexels_photo")} disabled={loading}>
                📷 Pexels Foto
              </button>
              <button type="button"
                className={`lang-btn${mediaSource === "pexels_video" ? " active" : ""}`}
                onClick={() => setMediaSource("pexels_video")} disabled={loading}>
                🎬 Pexels Video
              </button>
              <button type="button"
                className={`lang-btn${mediaSource === "ddg_image" ? " active" : ""}`}
                onClick={() => setMediaSource("ddg_image")} disabled={loading}>
                🦆 DuckDuckGo
              </button>
              <button type="button"
                className={`lang-btn${mediaSource === "google_image" ? " active" : ""}`}
                onClick={() => setMediaSource("google_image")} disabled={loading}>
                🔍 Google
              </button>
            </div>
          </div>

          {/* Images per section — only for photo/image sources */}
          {mediaSource !== "pexels_video" && (
            <div className="field">
              <label className="field__label">Bölüm Başına Fotoğraf Sayısı</label>
              <div className="lang-toggle">
                {([1, 2, 3, 4] as const).map(n => (
                  <button key={n} type="button"
                    className={`lang-btn${imagesPerSection === n ? " active" : ""}`}
                    onClick={() => setImagesPerSection(n)} disabled={loading}>
                    {n} {n === 1 ? "Foto" : "Foto"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mediaSource === "ai_generate" && (
            <div className="field">
              <label className="field__label">Görsel Üretim Motoru</label>
              <div className="lang-toggle">
                <button type="button"
                  className={`lang-btn${imageModel === "kie" ? " active" : ""}`}
                  onClick={() => setImageModel("kie")} disabled={loading}>
                  🎨 KIE (Kaliteli)
                </button>
                <button type="button"
                  className={`lang-btn${imageModel === "nano-banana" ? " active" : ""}`}
                  onClick={() => setImageModel("nano-banana")} disabled={loading}>
                  ⚡ Nano-Banana (Hızlı)
                </button>
              </div>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0 12px" }} />
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            ⚡ Render
          </div>

          <div className="field">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input id="use-gpu" type="checkbox" checked={useGpu}
                onChange={e => setUseGpu(e.target.checked)} disabled={loading}
                style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)", flexShrink: 0 }} />
              <label htmlFor="use-gpu" className="field__label" style={{ margin: 0, cursor: "pointer" }}>
                ⚡ GPU Hızlandırma (NVENC / AMF / QSV)
              </label>
            </div>
            {useGpu && (
              <div className="lang-toggle" style={{ marginTop: 8 }}>
                {(["nvenc", "amf", "qsv"] as const).map(enc => (
                  <button key={enc} type="button"
                    className={`lang-btn${gpuEncoder === enc ? " active" : ""}`}
                    onClick={() => setGpuEncoder(enc)} disabled={loading}>
                    {enc === "nvenc" ? "🟢 NVIDIA" : enc === "amf" ? "🔴 AMD" : "🔵 Intel"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Summary box */}
          <div style={{
            marginTop: 12, padding: "14px 16px",
            background: "var(--surface-2)",
            border: "var(--border-w) solid var(--border)",
            fontSize: 12, lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Özet</div>
            <div><span style={{ color: "var(--text-muted)" }}>Konu:</span> {topic || <em style={{ color: "var(--text-muted)" }}>—</em>}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Format:</span> {scriptFormat} · {videoLength} · {numSections} bölüm</div>
            <div><span style={{ color: "var(--text-muted)" }}>Dil / Oran:</span> {language === "tr" ? "🇹🇷 TR" : "🇬🇧 EN"} · {aspectRatio}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Ses:</span> {voiceProvider}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Medya:</span> {mediaSource === "ai_generate" ? `AI (${imageModel})` : mediaSource === "pexels_photo" ? "📷 Pexels Foto" : mediaSource === "pexels_video" ? "🎬 Pexels Video" : mediaSource === "ddg_image" ? "🦆 DuckDuckGo" : "🔍 Google"}{mediaSource !== "pexels_video" ? ` · ${imagesPerSection} foto/bölüm` : ""}{useGpu ? ` · GPU (${gpuEncoder})` : ""}</div>
          </div>

          <PageNav
            page={wizardPage}
            totalPages={TOTAL_PAGES}
            onBack={() => setWizardPage(p => p - 1)}
            onNext={() => {}}
            nextLabel="▶ Video Oluştur"
            nextDisabled={loading || (scriptInputMode === "paste_text" ? !rawText.trim() : !topic.trim())}
            loading={loading}
          />
        </>
      )}

    </form>
  )
}
