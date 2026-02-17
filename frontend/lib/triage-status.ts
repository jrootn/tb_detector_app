export type TriageStatus =
  | "COLLECTED"
  | "SYNCED"
  | "AI_TRIAGED"
  | "TEST_QUEUED"
  | "LAB_DONE"
  | "DOCTOR_FINALIZED"
  | "ASHA_ACTION_IN_PROGRESS"
  | "CLOSED"

const LEGACY_MAP: Record<string, TriageStatus> = {
  AWAITING_DOCTOR: "AI_TRIAGED",
  AWAITINGDOCTOR: "AI_TRIAGED",
  TEST_PENDING: "TEST_QUEUED",
  TESTPENDING: "TEST_QUEUED",
  ASSIGNED_TO_LAB: "TEST_QUEUED",
  LAB_DONE: "LAB_DONE",
  UNDER_TREATMENT: "ASHA_ACTION_IN_PROGRESS",
  UNDERTREATMENT: "ASHA_ACTION_IN_PROGRESS",
  CLEARED: "CLOSED",
}

const CANONICAL: Record<TriageStatus, TriageStatus> = {
  COLLECTED: "COLLECTED",
  SYNCED: "SYNCED",
  AI_TRIAGED: "AI_TRIAGED",
  TEST_QUEUED: "TEST_QUEUED",
  LAB_DONE: "LAB_DONE",
  DOCTOR_FINALIZED: "DOCTOR_FINALIZED",
  ASHA_ACTION_IN_PROGRESS: "ASHA_ACTION_IN_PROGRESS",
  CLOSED: "CLOSED",
}

export function normalizeTriageStatus(status?: string): TriageStatus {
  if (!status) return "TEST_QUEUED"
  const upper = status.toUpperCase()
  if (upper in LEGACY_MAP) return LEGACY_MAP[upper]
  if (upper in CANONICAL) return CANONICAL[upper as TriageStatus]
  return "TEST_QUEUED"
}

export function triageStatusLabel(status?: string): string {
  switch (normalizeTriageStatus(status)) {
    case "COLLECTED":
      return "Collected"
    case "SYNCED":
      return "Synced"
    case "AI_TRIAGED":
      return "AI Triaged"
    case "TEST_QUEUED":
      return "In Testing Queue"
    case "LAB_DONE":
      return "Lab Result Ready"
    case "DOCTOR_FINALIZED":
      return "Doctor Finalized"
    case "ASHA_ACTION_IN_PROGRESS":
      return "ASHA Follow-up Active"
    case "CLOSED":
      return "Closed"
    default:
      return "In Testing Queue"
  }
}

export function isRankEditableStatus(status?: string): boolean {
  return normalizeTriageStatus(status) === "TEST_QUEUED"
}

export function isQueueStatus(status?: string): boolean {
  const normalized = normalizeTriageStatus(status)
  return normalized === "AI_TRIAGED" || normalized === "TEST_QUEUED"
}

export function isCompletedStatus(status?: string): boolean {
  const normalized = normalizeTriageStatus(status)
  return normalized === "LAB_DONE" || normalized === "DOCTOR_FINALIZED" || normalized === "ASHA_ACTION_IN_PROGRESS" || normalized === "CLOSED"
}

