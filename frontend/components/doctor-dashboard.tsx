"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { addDoc, collection, updateDoc, doc, onSnapshot, query, where } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { getAiSummaryText, normalizeAiRiskScore } from "@/lib/ai"
import {
  isQueueStatus,
  isRankEditableStatus,
  normalizeTriageStatus,
  triageStatusLabel,
} from "@/lib/triage-status"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { AlertTriangle, Clock3, Download, Filter, Printer, Users } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useRouter } from "next/navigation"

const DoctorHeatmap = dynamic(() => import("@/components/doctor-heatmap"), { ssr: false })

interface PatientRecord {
  id: string
  demographics?: { name?: string }
  gps?: { lat?: number; lng?: number }
  ai?: {
    risk_score?: number
    medgemini_summary?: string | { en?: string; hi?: string }
    medgemini_summary_en?: string
    medgemini_summary_hi?: string
    medgemini_summary_i18n?: { en?: string; hi?: string }
  }
  doctor_priority?: boolean
  doctor_rank?: number
  assigned_doctor_id?: string
  facility_id?: string
  status?: { triage_status?: string }
  sample_id?: string
  created_at_offline?: string
}

interface DoctorDashboardProps {
  doctorUid: string
  facilityId?: string
}

function normalizeName(name?: string) {
  if (!name) return "Unknown"
  return name.replace(/\s+\d+$/, "")
}

function getPatientRiskScore(patient: PatientRecord): number {
  return normalizeAiRiskScore(patient.ai?.risk_score)
}

function scoreSeverity(score: number): "High" | "Medium" | "Low" {
  if (score >= 7) return "High"
  if (score >= 4) return "Medium"
  return "Low"
}

function formatScore(score: number): string {
  return `${score.toFixed(1)} / 10 (${Math.round(score * 10)}%)`
}

export function DoctorDashboard({ doctorUid, facilityId }: DoctorDashboardProps) {
  const router = useRouter()
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [view, setView] = useState<"list" | "map" | "analytics">("list")
  const [mounted, setMounted] = useState(false)
  const [filter, setFilter] = useState<"all" | "today" | "week" | "30days" | "date">("all")
  const [specificDate, setSpecificDate] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("TEST_QUEUED")
  const [search, setSearch] = useState("")
  const [isOnline, setIsOnline] = useState(true)
  const [csvOnlyHighRisk, setCsvOnlyHighRisk] = useState(false)
  const [csvIncludeSummary, setCsvIncludeSummary] = useState(true)
  const [csvIncludeCoordinates, setCsvIncludeCoordinates] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  useEffect(() => {
    if (!doctorUid) return
    setMounted(true)
    const q = query(collection(db, "patients"), where("assigned_doctor_id", "==", doctorUid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PatientRecord) }))
        setPatients(rows)
        setPermissionError(null)
      },
      (error) => {
        console.error("Failed to load patients", error)
        setPermissionError("Doctor patient permissions are blocked. Check Firestore rules for assigned_doctor_id read access.")
      }
    )
    return () => unsub()
  }, [doctorUid])

  useEffect(() => {
    const handler = () => setIsOnline(navigator.onLine)
    handler()
    window.addEventListener("online", handler)
    window.addEventListener("offline", handler)
    return () => {
      window.removeEventListener("online", handler)
      window.removeEventListener("offline", handler)
    }
  }, [])

  const visiblePatients = useMemo(() => {
    return patients.filter((p) => {
      if (p.assigned_doctor_id) return p.assigned_doctor_id === doctorUid
      if (facilityId && p.facility_id) return p.facility_id === facilityId
      // Keep legacy records visible until migrated.
      return !p.assigned_doctor_id && !p.facility_id
    })
  }, [patients, doctorUid, facilityId])

  const filtered = useMemo(() => {
    const now = new Date()
    return visiblePatients.filter((p) => {
      if (statusFilter !== "all" && normalizeTriageStatus(p.status?.triage_status) !== statusFilter) {
        return false
      }

      if (search) {
        const name = normalizeName(p.demographics?.name).toLowerCase()
        const sampleId = p.sample_id?.toLowerCase() || ""
        if (!name.includes(search.toLowerCase()) && !sampleId.includes(search.toLowerCase())) {
          return false
        }
      }

      if (!p.created_at_offline) return filter === "all"
      const created = new Date(p.created_at_offline)

      if (filter === "today") {
        return created.toDateString() === now.toDateString()
      }
      if (filter === "week") {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        return created >= weekAgo
      }
      if (filter === "30days") {
        const monthAgo = new Date(now)
        monthAgo.setDate(now.getDate() - 30)
        return created >= monthAgo
      }
      if (filter === "date" && specificDate) {
        const target = new Date(specificDate)
        return created.toDateString() === target.toDateString()
      }
      return true
    })
  }, [visiblePatients, filter, specificDate, statusFilter, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aPriority = a.doctor_priority ? 1 : 0
      const bPriority = b.doctor_priority ? 1 : 0
      if (aPriority !== bPriority) return bPriority - aPriority
      const aAwaiting = normalizeTriageStatus(a.status?.triage_status) === "TEST_QUEUED"
      const bAwaiting = normalizeTriageStatus(b.status?.triage_status) === "TEST_QUEUED"
      if (aAwaiting !== bAwaiting) return aAwaiting ? -1 : 1
      const aHasRank = typeof a.doctor_rank === "number"
      const bHasRank = typeof b.doctor_rank === "number"
      if (aHasRank && bHasRank) {
        if ((a.doctor_rank as number) !== (b.doctor_rank as number)) {
          return (a.doctor_rank as number) - (b.doctor_rank as number)
        }
      } else if (aHasRank !== bHasRank) {
        return aHasRank ? -1 : 1
      }
      const aScore = getPatientRiskScore(a)
      const bScore = getPatientRiskScore(b)
      if (bScore !== aScore) return bScore - aScore
      const aTime = new Date(a.created_at_offline || "").getTime()
      const bTime = new Date(b.created_at_offline || "").getTime()
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return aTime - bTime
      return a.id.localeCompare(b.id)
    })
  }, [filtered])

  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedPatientId(null)
      return
    }
    if (!selectedPatientId || !sorted.some((p) => p.id === selectedPatientId)) {
      setSelectedPatientId(sorted[0].id)
    }
  }, [sorted, selectedPatientId])

  const selectedPatient = useMemo(() => {
    if (!selectedPatientId) return null
    return sorted.find((p) => p.id === selectedPatientId) || null
  }, [sorted, selectedPatientId])

  const markUrgent = async (patientId: string) => {
    if (!isOnline) {
      toast.error("You are offline. Go online to update urgency.")
      return
    }
    try {
      await updateDoc(doc(db, "patients", patientId), { doctor_priority: true })
      setPatients((prev) => prev.map((p) => (p.id === patientId ? { ...p, doctor_priority: true } : p)))
      toast.success("Marked as urgent.")
    } catch {
      toast.error("Could not mark urgent. Check permissions and retry.")
    }
  }

  const swapDoctorRanks = async (
    first: PatientRecord,
    second: PatientRecord,
    reason: string,
    action: "MOVE_UP" | "MOVE_DOWN",
    fromRank: number,
    toRank: number
  ) => {
    const fallbackFirst = sorted.findIndex((p) => p.id === first.id) + 1
    const fallbackSecond = sorted.findIndex((p) => p.id === second.id) + 1
    const firstRank = typeof first.doctor_rank === "number" ? first.doctor_rank : fallbackFirst
    const secondRank = typeof second.doctor_rank === "number" ? second.doctor_rank : fallbackSecond

    const nowIso = new Date().toISOString()
    await Promise.all([
      updateDoc(doc(db, "patients", first.id), {
        doctor_rank: secondRank,
        rank_last_action: action,
        rank_last_reason: reason,
        rank_last_position_from: fromRank,
        rank_last_position_to: toRank,
        rank_last_updated_at: nowIso,
      }),
      updateDoc(doc(db, "patients", second.id), { doctor_rank: firstRank }),
    ])

    try {
      await addDoc(collection(db, "patients", first.id, "notes"), {
        author_uid: doctorUid,
        author_role: "DOCTOR",
        author_name: (typeof window !== "undefined" ? localStorage.getItem("user_name") : null) || "Doctor",
        message: `Priority updated (${fromRank} -> ${toRank}). Reason: ${reason}`,
        visibility: "ALL",
        created_at: nowIso,
        created_at_ms: Date.now(),
      })
    } catch (error) {
      console.warn("Could not add rank note", error)
    }

    setPatients((prev) =>
      prev.map((p) => {
        if (p.id === first.id) return { ...p, doctor_rank: secondRank }
        if (p.id === second.id) return { ...p, doctor_rank: firstRank }
        return p
      })
    )
  }

  const moveUp = async (patientId: string) => {
    if (!isOnline) {
      toast.error("You are offline. Go online to reorder queue.")
      return
    }
    const awaitingQueue = sorted.filter((p) => isRankEditableStatus(p.status?.triage_status))
    const index = awaitingQueue.findIndex((p) => p.id === patientId)
    if (index <= 0) return
    const current = awaitingQueue[index]
    const reason = window.prompt(`Reason for moving ${normalizeName(current.demographics?.name)} up in priority?`)
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error("Please enter a reason for rank change.")
      return
    }
    try {
      await swapDoctorRanks(current, awaitingQueue[index - 1], trimmed, "MOVE_UP", index + 1, index)
      toast.success("Queue updated.")
    } catch {
      toast.error("Could not move patient up. Check permissions and retry.")
    }
  }

  const moveDown = async (patientId: string) => {
    if (!isOnline) {
      toast.error("You are offline. Go online to reorder queue.")
      return
    }
    const awaitingQueue = sorted.filter((p) => isRankEditableStatus(p.status?.triage_status))
    const index = awaitingQueue.findIndex((p) => p.id === patientId)
    if (index < 0 || index >= awaitingQueue.length - 1) return
    const current = awaitingQueue[index]
    const reason = window.prompt(`Reason for moving ${normalizeName(current.demographics?.name)} down in priority?`)
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error("Please enter a reason for rank change.")
      return
    }
    try {
      await swapDoctorRanks(current, awaitingQueue[index + 1], trimmed, "MOVE_DOWN", index + 1, index + 2)
      toast.success("Queue updated.")
    } catch {
      toast.error("Could not move patient down. Check permissions and retry.")
    }
  }

  const analyticsPatients = sorted

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    analyticsPatients.forEach((p) => {
      const status = triageStatusLabel(p.status?.triage_status)
      counts[status] = (counts[status] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [analyticsPatients])

  const riskBuckets = useMemo(() => {
    const buckets = { High: 0, Medium: 0, Low: 0 }
    analyticsPatients.forEach((p) => {
      const score = getPatientRiskScore(p)
      if (score >= 7) buckets.High += 1
      else if (score >= 4) buckets.Medium += 1
      else buckets.Low += 1
    })
    return Object.entries(buckets).map(([name, value]) => ({ name, value }))
  }, [analyticsPatients])

  const highRiskPatients = useMemo(() => {
    return analyticsPatients.filter((p) => getPatientRiskScore(p) >= 7)
  }, [analyticsPatients])

  const csvRows = useMemo(() => {
    if (!csvOnlyHighRisk) return analyticsPatients
    return analyticsPatients.filter((p) => getPatientRiskScore(p) >= 7)
  }, [analyticsPatients, csvOnlyHighRisk])

  const dateFilterLabel = useMemo(() => {
    if (filter === "all") return "All dates"
    if (filter === "today") return "Today"
    if (filter === "week") return "This week"
    if (filter === "30days") return "Last 30 days"
    if (filter === "date" && specificDate) return specificDate
    return "Specific date"
  }, [filter, specificDate])

  const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return ""
    const s = String(value)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const exportAnalytics = () => {
    const lines: string[] = []
    lines.push("Export,Doctor Filtered Analytics")
    lines.push(`Generated At,${new Date().toISOString()}`)
    lines.push(`Rows Exported,${csvRows.length}`)
    lines.push(`Search,${search || "none"}`)
    lines.push(`Status Filter,${statusFilter}`)
    lines.push(`Date Filter,${dateFilterLabel}`)
    lines.push(`Only High Risk,${csvOnlyHighRisk ? "yes" : "no"}`)
    lines.push("")

    const headers = ["Name", "Sample ID", "Risk Score", "Status", "Priority", "Doctor Rank"]
    if (csvIncludeCoordinates) {
      headers.push("Latitude", "Longitude")
    }
    if (csvIncludeSummary) {
      headers.push("AI Summary")
    }
    lines.push(headers.join(","))

    csvRows.forEach((p) => {
      const row: unknown[] = [
        normalizeName(p.demographics?.name),
        p.sample_id || "-",
        getPatientRiskScore(p).toFixed(2),
        triageStatusLabel(p.status?.triage_status),
        p.doctor_priority ? "urgent" : "normal",
        p.doctor_rank ?? 0,
      ]
      if (csvIncludeCoordinates) {
        row.push(p.gps?.lat ?? "", p.gps?.lng ?? "")
      }
      if (csvIncludeSummary) {
        row.push(getAiSummaryText(p.ai, "en") || "")
      }
      lines.push(row.map(csvEscape).join(","))
    })

    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `doctor-filtered-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const statusBadge = (status?: string) => {
    const normalized = normalizeTriageStatus(status)
    switch (normalized) {
      case "AI_TRIAGED":
        return "bg-blue-100 text-blue-700"
      case "TEST_QUEUED":
        return "bg-orange-100 text-orange-700"
      case "LAB_DONE":
        return "bg-emerald-100 text-emerald-700"
      case "DOCTOR_FINALIZED":
        return "bg-amber-100 text-amber-700"
      case "ASHA_ACTION_IN_PROGRESS":
        return "bg-purple-100 text-purple-700"
      case "CLOSED":
        return "bg-slate-100 text-slate-700"
      default:
        return "bg-blue-100 text-blue-700"
    }
  }

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Doctor Queue</h1>
        <div className="flex gap-2">
          <Button variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>Queue</Button>
          <Button variant={view === "map" ? "default" : "outline"} onClick={() => setView("map")}>Map</Button>
          <Button variant={view === "analytics" ? "default" : "outline"} onClick={() => setView("analytics")}>Analytics</Button>
        </div>
      </div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        AI risk scale is 0-10 (shown with %). High: 7+, Medium: 4-6.9, Low: &lt;4. Same score uses first-come-first-go.
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {permissionError && (
          <span className="text-sm text-red-600">{permissionError}</span>
        )}
        <span className="text-sm text-muted-foreground">
          Scope: {visiblePatients.length} | Showing: {sorted.length}
        </span>
        <Input
          placeholder="Search by name or sample ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-64"
        />
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          All
        </Button>
        <Button size="sm" variant={filter === "today" ? "default" : "outline"} onClick={() => setFilter("today")}>
          Today
        </Button>
        <Button size="sm" variant={filter === "week" ? "default" : "outline"} onClick={() => setFilter("week")}>
          This Week
        </Button>
        <Button size="sm" variant={filter === "30days" ? "default" : "outline"} onClick={() => setFilter("30days")}>
          Last 30 Days
        </Button>
        <Button size="sm" variant={filter === "date" ? "default" : "outline"} onClick={() => setFilter("date")}>
          Specific Date
        </Button>
        {filter === "date" && (
          <input
            type="date"
            value={specificDate}
            onChange={(e) => setSpecificDate(e.target.value)}
            className="h-8 px-2 border rounded-md text-sm bg-background"
          />
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 px-2 border rounded-md text-sm bg-background"
        >
          <option value="all">All Status</option>
          <option value="AI_TRIAGED">AI Triaged</option>
          <option value="TEST_QUEUED">In Testing Queue</option>
          <option value="LAB_DONE">Lab Done</option>
          <option value="DOCTOR_FINALIZED">Doctor Finalized</option>
          <option value="ASHA_ACTION_IN_PROGRESS">ASHA Follow-up Active</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      {view === "list" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Doctor Queue</CardTitle>
              <p className="text-xs text-muted-foreground">
                Lab routing is automatic by facility. Doctor only reviews and re-orders priority.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr className="border-b">
                      <th className="p-2 text-left">Rank</th>
                      <th className="p-2 text-left">Patient</th>
                      <th className="p-2 text-left">Sample</th>
                      <th className="p-2 text-left">Risk</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((patient, index) => {
                      const statusCode = normalizeTriageStatus(patient.status?.triage_status)
                      const isActionable = isQueueStatus(patient.status?.triage_status)
                      const canMove = isActionable && isRankEditableStatus(patient.status?.triage_status)
                      const isSelected = selectedPatientId === patient.id
                      return (
                        <tr
                          key={patient.id}
                          className={`border-b ${isSelected ? "bg-emerald-50" : "hover:bg-muted/40"} cursor-pointer`}
                          onClick={() => setSelectedPatientId(patient.id)}
                        >
                          <td className="p-2 font-semibold">{index + 1}</td>
                          <td className="p-2">{normalizeName(patient.demographics?.name)}</td>
                          <td className="p-2 text-muted-foreground">{patient.sample_id || "-"}</td>
                          <td className={`p-2 font-medium ${getPatientRiskScore(patient) >= 8 ? "text-red-600" : "text-emerald-600"}`}>
                            {formatScore(getPatientRiskScore(patient))}
                            <div className="text-xs text-muted-foreground">{scoreSeverity(getPatientRiskScore(patient))}</div>
                          </td>
                          <td className="p-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(patient.status?.triage_status)}`}>
                              {triageStatusLabel(statusCode)}
                            </span>
                          </td>
                          <td className="p-2">
                            {!isActionable ? (
                              <span className="text-xs text-muted-foreground">-</span>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canMove}
                                  title="Move this patient earlier in test queue"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    moveUp(patient.id)
                                  }}
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canMove}
                                  title="Move this patient later in test queue"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    moveDown(patient.id)
                                  }}
                                >
                                  ↓
                                </Button>
                                <Button
                                  size="sm"
                                  variant={patient.doctor_priority ? "default" : "outline"}
                                  title={patient.doctor_priority ? "Already urgent" : "Mark for urgent test handling"}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    markUrgent(patient.id)
                                  }}
                                  disabled={patient.doctor_priority}
                                >
                                  {patient.doctor_priority ? "Urgent" : "Mark Urgent"}
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          No patients found for current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Selected Patient</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedPatient && (
                <div className="text-sm text-muted-foreground">Select a patient from the queue.</div>
              )}
              {selectedPatient && (
                <>
                  <div className="text-base font-semibold">{normalizeName(selectedPatient.demographics?.name)}</div>
                  <div className="text-sm text-muted-foreground">Sample ID: {selectedPatient.sample_id || "-"}</div>
                  <div className="text-sm">
                    Risk Score: {formatScore(getPatientRiskScore(selectedPatient))} ({scoreSeverity(getPatientRiskScore(selectedPatient))})
                  </div>
                  <div className="text-sm">
                    Status: {triageStatusLabel(selectedPatient.status?.triage_status)}
                  </div>
                  <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                    {getAiSummaryText(selectedPatient.ai, "en") || "No AI summary available."}
                  </div>
                  {isQueueStatus(selectedPatient.status?.triage_status) ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOnline || !isRankEditableStatus(selectedPatient.status?.triage_status)}
                        onClick={() => moveUp(selectedPatient.id)}
                      >
                        Move Up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOnline || !isRankEditableStatus(selectedPatient.status?.triage_status)}
                        onClick={() => moveDown(selectedPatient.id)}
                      >
                        Move Down
                      </Button>
                      <Button size="sm" onClick={() => markUrgent(selectedPatient.id)} disabled={!isOnline || selectedPatient.doctor_priority}>
                        {selectedPatient.doctor_priority ? "Urgent" : "Mark Urgent"}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Reordering is available only for AI-triaged/testing-queue patients.
                    </div>
                  )}
                  <Button onClick={() => router.push(`/doctor/patient/${selectedPatient.id}`)}>Open Full Profile</Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {view === "map" && !isOnline && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Map tiles require internet access. Please go online to view the heatmap.
          </CardContent>
        </Card>
      )}

      {view === "map" && mounted && isOnline && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assigned Patient Map</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              This map includes only patients assigned to you (or your mapped facility for legacy records).
            </p>
            <div className="h-[65vh] w-full overflow-hidden rounded-lg border">
              <DoctorHeatmap patients={filtered} />
            </div>
          </CardContent>
        </Card>
      )}

      {view === "analytics" && (
        <div className="space-y-4">
          <Card className="border-none bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-slate-100 shadow-lg">
            <CardContent className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Clinical Analytics Workspace</h2>
                  <p className="text-sm text-slate-300">
                    Charts and CSV export are based on the active filters above.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-white/15 px-3 py-1">Filtered cohort: {sorted.length}</span>
                  <span className="rounded-full bg-white/15 px-3 py-1">In scope: {visiblePatients.length}</span>
                  <span className="rounded-full bg-white/15 px-3 py-1">Status: {statusFilter}</span>
                  <span className="rounded-full bg-white/15 px-3 py-1">Date: {dateFilterLabel}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filtered Export
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Export includes only patients visible under your current search/date/status filters.
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={csvOnlyHighRisk}
                    onChange={(e) => setCsvOnlyHighRisk(e.target.checked)}
                  />
                  Only high-risk cases in CSV
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={csvIncludeSummary}
                    onChange={(e) => setCsvIncludeSummary(e.target.checked)}
                  />
                  Include AI summary text
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={csvIncludeCoordinates}
                    onChange={(e) => setCsvIncludeCoordinates(e.target.checked)}
                  />
                  Include coordinates
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={exportAnalytics} className="gap-2">
                  <Download className="h-4 w-4" />
                  Export Filtered CSV ({csvRows.length} rows)
                </Button>
                <Button variant="outline" onClick={() => window.print()} className="gap-2">
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-blue-100 bg-gradient-to-br from-blue-50 to-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-blue-900 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Filtered Patients
                </CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold text-blue-700">{analyticsPatients.length}</CardContent>
            </Card>
            <Card className="border-red-100 bg-gradient-to-br from-red-50 to-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-900 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  High Risk
                </CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold text-red-700">{highRiskPatients.length}</CardContent>
            </Card>
            <Card className="border-amber-100 bg-gradient-to-br from-amber-50 to-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-amber-900 flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                  Testing Queue
                  </CardTitle>
                </CardHeader>
              <CardContent className="text-3xl font-semibold text-amber-700">
                {analyticsPatients.filter((p) => normalizeTriageStatus(p.status?.triage_status) === "TEST_QUEUED").length}
              </CardContent>
            </Card>
            <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50 to-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-emerald-900">Urgent Overrides</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold text-emerald-700">
                {analyticsPatients.filter((p) => p.doctor_priority).length}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cases by Status (Filtered)</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusCounts} margin={{ top: 8, right: 8, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={56} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risk Distribution (Filtered)</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {riskBuckets.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.name === "High" ? "#ef4444" : entry.name === "Medium" ? "#f59e0b" : "#10b981"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">High Risk Patients (Filtered)</CardTitle>
            </CardHeader>
            <CardContent>
              {highRiskPatients.length === 0 && (
                <div className="text-sm text-muted-foreground">No high risk patients in current filter selection.</div>
              )}
              {highRiskPatients.length > 0 && (
                <div className="divide-y rounded-md border bg-white">
                  {highRiskPatients.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3">
                      <div>
                        <div className="text-sm font-medium">{normalizeName(p.demographics?.name)}</div>
                        <div className="text-xs text-muted-foreground">
                          Sample: {p.sample_id || "-"} • Score: {getPatientRiskScore(p).toFixed(1)} • Status:{" "}
                          {triageStatusLabel(p.status?.triage_status)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/doctor/patient/${p.id}`)}
                      >
                        Open Profile
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
