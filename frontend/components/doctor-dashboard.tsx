"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { collection, updateDoc, doc, onSnapshot, query } from "firebase/firestore"
import { db } from "@/lib/firebase"
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
  ai?: { risk_score?: number; medgemini_summary?: string }
  doctor_priority?: boolean
  doctor_rank?: number
  status?: { triage_status?: string }
  sample_id?: string
  created_at_offline?: string
}

function normalizeName(name?: string) {
  if (!name) return "Unknown"
  return name.replace(/\s+\d+$/, "")
}

export function DoctorDashboard() {
  const router = useRouter()
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [view, setView] = useState<"list" | "map" | "analytics">("list")
  const [mounted, setMounted] = useState(false)
  const [filter, setFilter] = useState<"all" | "today" | "week" | "30days" | "date">("all")
  const [specificDate, setSpecificDate] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("AWAITING_DOCTOR")
  const [search, setSearch] = useState("")
  const [isOnline, setIsOnline] = useState(true)
  const [csvOnlyHighRisk, setCsvOnlyHighRisk] = useState(false)
  const [csvIncludeSummary, setCsvIncludeSummary] = useState(true)
  const [csvIncludeCoordinates, setCsvIncludeCoordinates] = useState(false)

  useEffect(() => {
    setMounted(true)
    const q = query(collection(db, "patients"))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PatientRecord) }))
        setPatients(rows)
      },
      (error) => {
        console.error("Failed to load patients", error)
      }
    )
    return () => unsub()
  }, [])

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

  const filtered = useMemo(() => {
    const now = new Date()
    return patients.filter((p) => {
      if (statusFilter !== "all" && p.status?.triage_status !== statusFilter) {
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
  }, [patients, filter, specificDate, statusFilter, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aPriority = a.doctor_priority ? 1 : 0
      const bPriority = b.doctor_priority ? 1 : 0
      if (aPriority !== bPriority) return bPriority - aPriority
      const aAwaiting = (a.status?.triage_status || "AWAITING_DOCTOR") === "AWAITING_DOCTOR"
      const bAwaiting = (b.status?.triage_status || "AWAITING_DOCTOR") === "AWAITING_DOCTOR"
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
      const aScore = a.ai?.risk_score ?? 0
      const bScore = b.ai?.risk_score ?? 0
      return bScore - aScore
    })
  }, [filtered])

  const markUrgent = async (patientId: string) => {
    await updateDoc(doc(db, "patients", patientId), { doctor_priority: true })
    setPatients((prev) =>
      prev.map((p) => (p.id === patientId ? { ...p, doctor_priority: true } : p))
    )
  }

  const moveUp = async (index: number) => {
    if (index <= 0) return
    const current = sorted[index]
    const above = sorted[index - 1]
    const newRank = (above.doctor_rank ?? 0) - 1
    await updateDoc(doc(db, "patients", current.id), { doctor_rank: newRank })
    setPatients((prev) =>
      prev.map((p) => (p.id === current.id ? { ...p, doctor_rank: newRank } : p))
    )
  }

  const moveDown = async (index: number) => {
    if (index >= sorted.length - 1) return
    const current = sorted[index]
    const below = sorted[index + 1]
    const newRank = (below.doctor_rank ?? 0) + 1
    await updateDoc(doc(db, "patients", current.id), { doctor_rank: newRank })
    setPatients((prev) =>
      prev.map((p) => (p.id === current.id ? { ...p, doctor_rank: newRank } : p))
    )
  }

  const toStatusLabel = (status?: string) => {
    if (!status) return "Awaiting Doctor"
    switch (status) {
      case "AWAITING_DOCTOR":
        return "Awaiting Doctor"
      case "ASSIGNED_TO_LAB":
        return "Assigned to Lab"
      case "LAB_DONE":
        return "Lab Done"
      case "TEST_PENDING":
        return "Test Pending"
      case "UNDER_TREATMENT":
        return "Under Treatment"
      case "CLEARED":
        return "Cleared"
      default:
        return status.replaceAll("_", " ")
    }
  }

  const analyticsPatients = sorted

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    analyticsPatients.forEach((p) => {
      const status = toStatusLabel(p.status?.triage_status)
      counts[status] = (counts[status] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [analyticsPatients])

  const riskBuckets = useMemo(() => {
    const buckets = { High: 0, Medium: 0, Low: 0 }
    analyticsPatients.forEach((p) => {
      const score = p.ai?.risk_score ?? 0
      if (score >= 7) buckets.High += 1
      else if (score >= 4) buckets.Medium += 1
      else buckets.Low += 1
    })
    return Object.entries(buckets).map(([name, value]) => ({ name, value }))
  }, [analyticsPatients])

  const highRiskPatients = useMemo(() => {
    return analyticsPatients.filter((p) => (p.ai?.risk_score ?? 0) >= 7)
  }, [analyticsPatients])

  const csvRows = useMemo(() => {
    if (!csvOnlyHighRisk) return analyticsPatients
    return analyticsPatients.filter((p) => (p.ai?.risk_score ?? 0) >= 7)
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
        p.ai?.risk_score ?? 0,
        toStatusLabel(p.status?.triage_status),
        p.doctor_priority ? "urgent" : "normal",
        p.doctor_rank ?? 0,
      ]
      if (csvIncludeCoordinates) {
        row.push(p.gps?.lat ?? "", p.gps?.lng ?? "")
      }
      if (csvIncludeSummary) {
        row.push(p.ai?.medgemini_summary || "")
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
    switch (status) {
      case "ASSIGNED_TO_LAB":
        return "bg-blue-100 text-blue-700"
      case "LAB_DONE":
        return "bg-emerald-100 text-emerald-700"
      case "UNDER_TREATMENT":
        return "bg-amber-100 text-amber-700"
      case "TEST_PENDING":
        return "bg-orange-100 text-orange-700"
      case "CLEARED":
        return "bg-slate-100 text-slate-700"
      default:
        return "bg-red-100 text-red-700"
    }
  }

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Doctor Triage</h1>
        <div className="flex gap-2">
          <Button variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>List</Button>
          <Button variant={view === "map" ? "default" : "outline"} onClick={() => setView("map")}>Heatmap</Button>
          <Button variant={view === "analytics" ? "default" : "outline"} onClick={() => setView("analytics")}>Analytics</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-muted-foreground">
          Total: {patients.length} | Showing: {sorted.length}
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
          <option value="AWAITING_DOCTOR">Awaiting Doctor</option>
          <option value="TEST_PENDING">Test Pending</option>
          <option value="ASSIGNED_TO_LAB">Assigned to Lab</option>
          <option value="LAB_DONE">Lab Done</option>
          <option value="UNDER_TREATMENT">Under Treatment</option>
          <option value="CLEARED">Cleared</option>
        </select>
      </div>

      {view === "list" && (
        <div className="space-y-3">
          {sorted.map((patient, index) => (
            <Card key={patient.id} className="cursor-pointer" onClick={() => router.push(`/doctor/patient/${patient.id}`)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {normalizeName(patient.demographics?.name)}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(patient.status?.triage_status)}`}>
                      {toStatusLabel(patient.status?.triage_status)}
                    </span>
                  </span>
                  <span className={`text-sm ${patient.ai?.risk_score && patient.ai.risk_score >= 8 ? "text-red-600" : "text-emerald-600"}`}>
                    Risk: {patient.ai?.risk_score ?? 0}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Sample ID: {patient.sample_id || "-"}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(patient.status?.triage_status || "AWAITING_DOCTOR") !== "AWAITING_DOCTOR"}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveUp(index)
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(patient.status?.triage_status || "AWAITING_DOCTOR") !== "AWAITING_DOCTOR"}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveDown(index)
                      }}
                    >
                      ↓
                    </Button>
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); markUrgent(patient.id) }} disabled={patient.doctor_priority}>
                      {patient.doctor_priority ? "Urgent" : "Mark Urgent"}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2">
                  {patient.ai?.medgemini_summary || "No AI summary available."}
                </div>
              </CardContent>
            </Card>
          ))}
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
        <div className="h-[70vh] w-full overflow-hidden rounded-lg border">
          <DoctorHeatmap patients={filtered} />
        </div>
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
                  <span className="rounded-full bg-white/15 px-3 py-1">All patients: {patients.length}</span>
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
                  Pending Review
                </CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold text-amber-700">
                {analyticsPatients.filter((p) => p.status?.triage_status === "AWAITING_DOCTOR").length}
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
                          Sample: {p.sample_id || "-"} • Score: {p.ai?.risk_score ?? 0} • Status:{" "}
                          {toStatusLabel(p.status?.triage_status)}
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
