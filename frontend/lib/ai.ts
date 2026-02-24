export interface AiSummaryPayload {
  medgemini_summary?: unknown
  medgemini_summary_en?: unknown
  medgemini_summary_hi?: unknown
  medgemini_summary_i18n?: unknown
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  if (score < 0) return 0
  if (score > 10) return 10
  return score
}

export function normalizeAiRiskScore(raw: unknown, fallback = 0): number {
  const numeric = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(numeric)) return clampScore(fallback)
  const scaled = numeric >= 0 && numeric <= 1 ? numeric * 10 : numeric
  return clampScore(scaled)
}

export function getAiSummaryText(ai?: AiSummaryPayload, language: "en" | "hi" = "en"): string | undefined {
  if (!ai) return undefined

  let en: string | undefined
  let hi: string | undefined

  if (typeof ai.medgemini_summary_en === "string") en = ai.medgemini_summary_en
  if (typeof ai.medgemini_summary_hi === "string") hi = ai.medgemini_summary_hi

  if (ai.medgemini_summary_i18n && typeof ai.medgemini_summary_i18n === "object") {
    const map = ai.medgemini_summary_i18n as Record<string, unknown>
    if (typeof map.en === "string") en = map.en
    if (typeof map.hi === "string") hi = map.hi
  }

  if (typeof ai.medgemini_summary === "string") {
    en = en || ai.medgemini_summary
  } else if (ai.medgemini_summary && typeof ai.medgemini_summary === "object") {
    const map = ai.medgemini_summary as Record<string, unknown>
    if (typeof map.en === "string") en = en || map.en
    if (typeof map.hi === "string") hi = hi || map.hi
  }

  return language === "hi" ? hi || en : en || hi
}
