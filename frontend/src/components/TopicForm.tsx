import { useState, useEffect } from "react"
import { api, type FormatOption, type CreateRunBody, type GoogleTtsVoice } from "../api/client"

interface Props {
  onSubmit: (body: CreateRunBody) => void
  loading: boolean
}

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 Yatay" },
  { value: "9:16", label: "9:16 Dikey" },
  { value: "1:1",  label: "1:1 Kare" },
  { value: "4:3",  label: "4:3" },
  { value: "3:4",  label: "3:4" },
]

// CortexAI TR voices (ElevenLabs voice IDs)
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

export function TopicForm({ onSubmit, loading }: Props) {
  const [topic, setTopic] = useState("")
  const [numSections, setNumSections] = useState(5)
  const [scriptFormat, setScriptFormat] = useState("listicle")
  const [videoLength, setVideoLength] = useState("medium")
  const [language, setLanguage] = useState<"en" | "tr">("tr")
  const [aspectRatio, setAspectRatio] = useState("16:9")
  const [voiceProvider, setVoiceProvider] = useState<"cortexai" | "google_tts" | "inworld">("google_tts")
  const [voiceId, setVoiceId] = useState(CORTEX_TR_VOICES[0].value)
  const [googleVoiceName, setGoogleVoiceName] = useState("Kore")
  const [customInstructions, setCustomInstructions] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [formats, setFormats] = useState<FormatOption[]>([])
  const [googleVoices, setGoogleVoices] = useState<GoogleTtsVoice[]>([])

  useEffect(() => {
    api.getFormats().then(setFormats).catch(console.error)
    api.getGoogleVoices().then(setGoogleVoices).catch(console.error)
  }, [])

  // Reset voice when language changes
  useEffect(() => {
    if (language === "en") {
      setVoiceProvider("google_tts")
    }
  }, [language])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!topic.trim()) return

    const isGoogle = voiceProvider === "google_tts"
    const isCortex = voiceProvider === "cortexai"

    onSubmit({
      topic: topic.trim(),
      numSections,
      scriptFormat,
      videoLength,
      language,
      aspectRatio: aspectRatio as CreateRunBody["aspectRatio"],
      voiceProvider,
      // voiceId: for CortexAI = ElevenLabs voice ID, for Google = voice name (e.g. 'Kore')
      voiceId: isGoogle ? googleVoiceName : (isCortex ? voiceId : undefined),
      customInstructions: customInstructions.trim() || undefined,
    })
  }

  // Available providers per language
  const providers =
    language === "tr"
      ? [
          { value: "google_tts", label: "🌐 Google TTS (Gemini)" },
          { value: "cortexai",   label: "🤖 CortexAI" },
        ]
      : [
          { value: "google_tts", label: "🌐 Google TTS (Gemini)" },
          { value: "inworld",    label: "🎙️ Inworld AI" },
        ]

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Konu */}
      <div className="field">
        <label className="field__label">Konu</label>
        <input
          type="text"
          className="field__input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="örn. Dünyanın En Güzel 5 Şehri"
          disabled={loading}
        />
      </div>

      {/* Dil */}
      <div className="field">
        <label className="field__label">Dil</label>
        <div className="lang-toggle">
          {(["tr", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              className={`lang-btn${language === lang ? " active" : ""}`}
              onClick={() => setLanguage(lang)}
              disabled={loading}
            >
              {lang === "tr" ? "🇹🇷 Türkçe" : "🇬🇧 İngilizce"}
            </button>
          ))}
        </div>
      </div>

      {/* Ses Motoru */}
      <div className="field">
        <label className="field__label">🔊 Ses Motoru</label>
        <div className="lang-toggle">
          {providers.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`lang-btn${voiceProvider === p.value ? " active" : ""}`}
              onClick={() => setVoiceProvider(p.value as "cortexai" | "google_tts" | "inworld")}
              disabled={loading}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ses seçimi — Google TTS */}
      {voiceProvider === "google_tts" && googleVoices.length > 0 && (
        <div className="field">
          <label className="field__label">🎙️ Seslendirici (Google)</label>
          <select
            className="field__select"
            value={googleVoiceName}
            onChange={(e) => setGoogleVoiceName(e.target.value)}
            disabled={loading}
          >
            {googleVoices
              .map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Ses seçimi — CortexAI (sadece Türkçe) */}
      {voiceProvider === "cortexai" && language === "tr" && (
        <div className="field">
          <label className="field__label">🎙️ Seslendirici (CortexAI)</label>
          <select
            className="field__select"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={loading}
          >
            {CORTEX_TR_VOICES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* En-Boy / Format / Süre */}
      <div className="grid-3">
        <div className="field">
          <label className="field__label">En-Boy</label>
          <select
            className="field__select"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            disabled={loading}
          >
            {ASPECT_RATIOS.map((ar) => (
              <option key={ar.value} value={ar.value}>{ar.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label">Format</label>
          <select
            className="field__select"
            value={scriptFormat}
            onChange={(e) => setScriptFormat(e.target.value)}
            disabled={loading}
          >
            {formats.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label">Süre</label>
          <select
            className="field__select"
            value={videoLength}
            onChange={(e) => setVideoLength(e.target.value)}
            disabled={loading}
          >
            <option value="short">Kısa (1–3 dk)</option>
            <option value="medium">Orta (3–6 dk)</option>
            <option value="long">Uzun (6–10 dk)</option>
          </select>
        </div>
      </div>

      {/* Bölüm sayısı */}
      <div className="field">
        <label className="field__label">Bölüm Sayısı</label>
        <input
          type="number"
          min={3}
          max={15}
          value={numSections}
          onChange={(e) => setNumSections(Number(e.target.value))}
          disabled={loading}
          style={{ width: "100%", background: "var(--bg)", border: "var(--border-w) solid var(--border-strong)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 14, padding: "10px 12px", outline: "none" }}
        />
      </div>

      {/* Gelişmiş seçenekler */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase", cursor: "pointer", textDecoration: "underline", textAlign: "left", padding: 0 }}
      >
        {showAdvanced ? "Gelişmiş seçenekleri gizle" : "Gelişmiş seçenekler"}
      </button>

      {showAdvanced && (
        <div className="field">
          <label className="field__label">Özel Talimatlar</label>
          <textarea
            className="field__textarea"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={4}
            placeholder="İsteğe bağlı: senaryo üretimini özelleştir..."
            disabled={loading}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !topic.trim()}
        className="btn btn--primary btn--full btn--lg"
        style={{ marginTop: 4 }}
      >
        {loading ? "Oluşturuluyor…" : "▶ Video Oluştur"}
      </button>
    </form>
  )
}
