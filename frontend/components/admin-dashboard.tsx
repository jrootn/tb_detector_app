"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { collection, onSnapshot, query } from "firebase/firestore"
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
import { db } from "@/lib/firebase"
import { normalizeAiRiskScore } from "@/lib/ai"
import { normalizeTriageStatus, triageStatusLabel } from "@/lib/triage-status"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  Building2,
  CircleCheck,
  Download,
  MapPinned,
  Stethoscope,
  TestTube2,
  Users,
} from "lucide-react"

const PatientMap = dynamic(() => import("@/components/doctor-heatmap"), { ssr: false })

interface UserRecord {
  id: string
  name?: string
  email?: string
  role?: string
  facility_id?: string
  facility_name?: string
  assigned_center?: string
}

interface FacilityRecord {
  id: string
  name?: string
  type?: string
  parent_id?: string
  service_pincodes?: string[]
}

interface PatientRecord {
  id: string
  patient_local_id?: string
  sample_id?: string
  facility_id?: string
  facility_name?: string
  assigned_doctor_id?: string
  assigned_lab_tech_id?: string
  status?: { triage_status?: string }
  ai?: { risk_score?: number; risk_level?: string; medgemini_summary?: string }
  gps?: { lat?: number; lng?: number }
  demographics?: { name?: string; village?: string; pincode?: string }
  synced_at?: string
  created_at_offline?: string
}

function patientPriorityScore(patient: PatientRecord): number {
  const risk = normalizeAiRiskScore(patient.ai?.risk_score)
  const status = normalizeTriageStatus(patient.status?.triage_status)
  const statusBoost = status === "TEST_QUEUED" ? 1.5 : status === "AI_TRIAGED" ? 1.1 : 0
  return Number((risk + statusBoost).toFixed(2))
}

export function AdminDashboard() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [facilities, setFacilities] = useState<FacilityRecord[]>([])

  const [view, setView] = useState<"overview" | "map" | "analytics">("overview")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "30days" | "date">("all")
  const [specificDate, setSpecificDate] = useState("")
  const [search, setSearch] = useState("")
  const [isOnline, setIsOnline] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [csvOnlyHighRisk, setCsvOnlyHighRisk] = useState(false)

  useEffect(() => {
    const unsubUsers = onSnapshot(
      query(collection(db, "users")),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserRecord) }))
        setUsers(rows)
      },
      (error) => console.error("Failed to load users", error)
    )

    const unsubPatients = onSnapshot(
      query(collection(db, "patients")),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PatientRecord) }))
        setPatients(rows)
      },
      (error) => console.error("Failed to load patients", error)
    )

    const unsubFacilities = onSnapshot(
      query(collection(db, "facilities")),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as FacilityRecord) }))
        setFacilities(rows)
      },
      (error) => console.error("Failed to load facilities", error)
    )

    return () => {
      unsubUsers()
      unsubPatients()
      unsubFacilities()
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    const handler = () => setIsOnline(navigator.onLine)
    handler()
    window.addEventListener("online", handler)
    window.addEventListener("offline", handler)
    return () => {
      window.removeEventListener("online", handler)
      window.removeEventListener("offline", handler)
    }
  }, [])

  const facilityMap = useMemo(() => {
    const map: Record<string, FacilityRecord> = {}
    facilities.forEach((f) => {
      map[f.id] = f
    })
    return map
  }, [facilities])

  const usersByRole = useMemo(() => {
    const result: Record<string, number> = { ASHA: 0, DOCTOR: 0, LAB_TECH: 0, ADMIN: 0 }
    users.forEach((u) => {
      const role = u.role || ""
      result[role] = (result[role] || 0) + 1
    })
    return result
  }, [users])

  const filteredPatients = useMemo(() => {
    const now = new Date()
    return patients.filter((p) => {
      if (facilityFilter !== "all" && (p.facility_id || "") !== facilityFilter) return false
      if (statusFilter !== "all" && normalizeTriageStatus(p.status?.triage_status) !== statusFilter) return false

      if (dateFilter !== "all") {
        if (!p.created_at_offline) return false
        const created = new Date(p.created_at_offline)
        if (dateFilter === "today" && created.toDateString() !== now.toDateString()) return false
        if (dateFilter === "week") {
          const weekAgo = new Date(now)
          weekAgo.setDate(now.getDate() - 7)
          if (created < weekAgo) return false
        }
        if (dateFilter === "30days") {
          const monthAgo = new Date(now)
          monthAgo.setDate(now.getDate() - 30)
          if (created < monthAgo) return false
        }
        if (dateFilter === "date" && specificDate) {
          const target = new Date(specificDate)
          if (created.toDateString() !== target.toDateString()) return false
        }
      }

      if (!search.trim()) return true
      const needle = search.trim().toLowerCase()
      const name = (p.demographics?.name || "").toLowerCase()
      const sample = (p.sample_id || "").toLowerCase()
      const pid = (p.id || "").toLowerCase()
      const village = (p.demographics?.village || "").toLowerCase()
      return (
        name.includes(needle) ||
        sample.includes(needle) ||
        pid.includes(needle) ||
        village.includes(needle)
      )
    })
  }, [patients, facilityFilter, statusFilter, dateFilter, specificDate, search])

  const highRiskPending = useMemo(() => {
    return filteredPatients
      .filter((p) => {
        const risk = normalizeAiRiskScore(p.ai?.risk_score)
        const status = normalizeTriageStatus(p.status?.triage_status)
        return risk >= 7 && (status === "AI_TRIAGED" || status === "TEST_QUEUED")
      })
      .sort((a, b) => patientPriorityScore(b) - patientPriorityScore(a))
      .slice(0, 15)
  }, [filteredPatients])

  const unresolvedAssignments = useMemo(() => {
    return filteredPatients.filter((p) => !p.assigned_doctor_id || !p.assigned_lab_tech_id)
  }, [filteredPatients])

  const staleSyncCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return filteredPatients.filter((p) => {
      if (!p.synced_at) return true
      const t = Date.parse(p.synced_at)
      return Number.isFinite(t) ? t < cutoff : true
    }).length
  }, [filteredPatients])

  const facilityOps = useMemo(() => {
    return Object.values(
      filteredPatients.reduce<Record<string, {
        id: string
        name: string
        total: number
        awaitingDoctor: number
        assignedToLab: number
        labDone: number
      }>>((acc, p) => {
        const fid = p.facility_id || "UNASSIGNED"
        if (!acc[fid]) {
          acc[fid] = {
            id: fid,
            name: facilityMap[fid]?.name || fid,
            total: 0,
            awaitingDoctor: 0,
            assignedToLab: 0,
            labDone: 0,
          }
        }
        acc[fid].total += 1
        const status = normalizeTriageStatus(p.status?.triage_status)
        if (status === "AI_TRIAGED" || status === "TEST_QUEUED") acc[fid].awaitingDoctor += 1
        if (status === "LAB_DONE") acc[fid].assignedToLab += 1
        if (status === "DOCTOR_FINALIZED" || status === "ASHA_ACTION_IN_PROGRESS" || status === "CLOSED") acc[fid].labDone += 1
        return acc
      }, {})
    ).sort((a, b) => b.total - a.total)
  }, [filteredPatients, facilityMap])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredPatients.forEach((p) => {
      const status = triageStatusLabel(p.status?.triage_status)
      counts[status] = (counts[status] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [filteredPatients])

  const riskBuckets = useMemo(() => {
    const buckets = { High: 0, Medium: 0, Low: 0 }
    filteredPatients.forEach((p) => {
      const score = normalizeAiRiskScore(p.ai?.risk_score)
      if (score >= 7) buckets.High += 1
      else if (score >= 4) buckets.Medium += 1
      else buckets.Low += 1
    })
    return Object.entries(buckets).map(([name, value]) => ({ name, value }))
  }, [filteredPatients])

  const facilityTotals = useMemo(() => {
    return facilityOps.map((f) => ({
      name: f.name.length > 16 ? `${f.name.slice(0, 16)}...` : f.name,
      total: f.total,
      awaitingDoctor: f.awaitingDoctor,
      assignedToLab: f.assignedToLab,
    }))
  }, [facilityOps])

  const csvRows = useMemo(() => {
    if (!csvOnlyHighRisk) return filteredPatients
    return filteredPatients.filter((p) => normalizeAiRiskScore(p.ai?.risk_score) >= 7)
  }, [filteredPatients, csvOnlyHighRisk])

  const exportCsv = () => {
    const esc = (value: unknown) => {
      if (value == null) return ""
      const s = String(value)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const lines: string[] = []
    lines.push("Export,NTEP Control Tower")
    lines.push(`Generated At,${new Date().toISOString()}`)
    lines.push(`Rows,${csvRows.length}`)
    lines.push(`Facility Filter,${facilityFilter}`)
    lines.push(`Status Filter,${statusFilter}`)
    lines.push("")
    lines.push(
      [
        "Patient ID",
        "Sample ID",
        "Patient Name",
        "Village",
        "Pincode",
        "Facility",
        "Risk Score",
        "Risk Level",
        "Status",
        "Assigned Doctor UID",
        "Assigned Lab UID",
        "Created At",
      ].join(",")
    )

    csvRows.forEach((p) => {
      lines.push(
        [
          p.id,
          p.sample_id || "",
          p.demographics?.name || "",
          p.demographics?.village || "",
          p.demographics?.pincode || "",
          p.facility_name || p.facility_id || "",
          normalizeAiRiskScore(p.ai?.risk_score).toFixed(2),
          p.ai?.risk_level || "",
          normalizeTriageStatus(p.status?.triage_status),
          p.assigned_doctor_id || "",
          p.assigned_lab_tech_id || "",
          p.created_at_offline || "",
        ].map(esc).join(",")
      )
    })

    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ntep-control-tower-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">NTEP Control Tower</h1>
          <p className="text-sm text-muted-foreground">
            TU/PHC-level monitoring with full geography and workload analytics.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={view === "overview" ? "default" : "outline"} onClick={() => setView("overview")}>Overview</Button>
          <Button variant={view === "map" ? "default" : "outline"} onClick={() => setView("map")}>
            <MapPinned className="h-4 w-4 mr-1" />Map
          </Button>
          <Button variant={view === "analytics" ? "default" : "outline"} onClick={() => setView("analytics")}>Analytics</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Total Users</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{users.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" />Facilities</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{facilities.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" />High Risk Pending</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-red-600">{highRiskPending.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><CircleCheck className="h-4 w-4" />Stale Sync (&gt;24h)</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-amber-600">{staleSyncCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient by name, sample ID, village, or patient ID"
            className="w-80"
          />
          <select
            className="h-10 rounded-md border px-3 text-sm bg-background"
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
          >
            <option value="all">All Facilities</option>
            {facilities
              .filter((f) => f.type === "PHC")
              .map((f) => (
                <option key={f.id} value={f.id}>{f.name || f.id}</option>
              ))}
          </select>
          <select
            className="h-10 rounded-md border px-3 text-sm bg-background"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="AI_TRIAGED">AI Triaged</option>
            <option value="TEST_QUEUED">In Testing Queue</option>
            <option value="LAB_DONE">Lab Done</option>
            <option value="DOCTOR_FINALIZED">Doctor Finalized</option>
            <option value="ASHA_ACTION_IN_PROGRESS">ASHA Follow-up Active</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select
            className="h-10 rounded-md border px-3 text-sm bg-background"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as "all" | "today" | "week" | "30days" | "date")}
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="30days">Last 30 Days</option>
            <option value="date">Specific Date</option>
          </select>
          {dateFilter === "date" && (
            <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} className="w-44" />
          )}
          <Badge variant="secondary">Patients in scope: {filteredPatients.length}</Badge>
        </CardContent>
      </Card>

      {view === "overview" && (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Role Coverage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>ASHA: <span className="font-semibold">{usersByRole.ASHA || 0}</span></div>
                <div>Doctors: <span className="font-semibold">{usersByRole.DOCTOR || 0}</span></div>
                <div>Lab Techs: <span className="font-semibold">{usersByRole.LAB_TECH || 0}</span></div>
                <div>Admins/STS: <span className="font-semibold">{usersByRole.ADMIN || 0}</span></div>
                <div className="pt-2 text-muted-foreground">Filtered patients in view: {filteredPatients.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Operational Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>Patients missing assignment</span>
                  <Badge variant="secondary">{unresolvedAssignments.length}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>In testing queue</span>
                  <Badge variant="secondary">
                    {filteredPatients.filter((p) => normalizeTriageStatus(p.status?.triage_status) === "TEST_QUEUED").length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>Lab result ready</span>
                  <Badge variant="secondary">
                    {filteredPatients.filter((p) => normalizeTriageStatus(p.status?.triage_status) === "LAB_DONE").length}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Stethoscope className="h-4 w-4" />Top Priority Queue</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2 text-left">Patient</th>
                    <th className="p-2 text-left">Sample</th>
                    <th className="p-2 text-left">Facility</th>
                    <th className="p-2 text-left">Risk</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Priority Score</th>
                  </tr>
                </thead>
                <tbody>
                  {highRiskPending.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="p-2">{p.demographics?.name || "Unknown"}</td>
                      <td className="p-2">{p.sample_id || "-"}</td>
                      <td className="p-2">{facilityMap[p.facility_id || ""]?.name || p.facility_id || "-"}</td>
                      <td className="p-2">{normalizeAiRiskScore(p.ai?.risk_score).toFixed(1)}</td>
                      <td className="p-2">{triageStatusLabel(p.status?.triage_status)}</td>
                      <td className="p-2 font-semibold">{patientPriorityScore(p).toFixed(2)}</td>
                    </tr>
                  ))}
                  {highRiskPending.length === 0 && (
                    <tr>
                      <td className="p-4 text-center text-muted-foreground" colSpan={6}>No high-priority cases for this filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><TestTube2 className="h-4 w-4" />Facility Throughput</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2 text-left">Facility</th>
                    <th className="p-2 text-left">Total</th>
                    <th className="p-2 text-left">Testing Queue</th>
                    <th className="p-2 text-left">Lab Result Ready</th>
                    <th className="p-2 text-left">Follow-up/Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {facilityOps.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.total}</td>
                      <td className="p-2">{row.awaitingDoctor}</td>
                      <td className="p-2">{row.assignedToLab}</td>
                      <td className="p-2">{row.labDone}</td>
                    </tr>
                  ))}
                  {facilityOps.length === 0 && (
                    <tr>
                      <td className="p-4 text-center text-muted-foreground" colSpan={5}>No facility data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {view === "map" && !isOnline && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Map tiles require internet access. Please go online.
          </CardContent>
        </Card>
      )}

      {view === "map" && mounted && isOnline && (
        <div className="h-[72vh] w-full overflow-hidden rounded-lg border bg-card">
          <PatientMap patients={filteredPatients} profileBasePath="/admin/patient" showFacility />
        </div>
      )}

      {view === "analytics" && (
        <div className="space-y-4">
          <Card className="border-none bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-slate-100 shadow-lg">
            <CardContent className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Control Tower Analytics</h2>
                  <p className="text-sm text-slate-300">Charts and CSV use the active filters above.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={csvOnlyHighRisk}
                      onChange={(e) => setCsvOnlyHighRisk(e.target.checked)}
                    />
                    Only high-risk
                  </label>
                  <Button onClick={exportCsv} className="gap-2" variant="secondary">
                    <Download className="h-4 w-4" /> Export CSV ({csvRows.length})
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total In Scope</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold">{filteredPatients.length}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">High Risk</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold text-red-600">{riskBuckets.find((r) => r.name === "High")?.value || 0}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Testing Queue</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold text-amber-600">
                {filteredPatients.filter((p) => normalizeTriageStatus(p.status?.triage_status) === "TEST_QUEUED").length}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Status Distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusCounts} margin={{ top: 8, right: 8, left: 0, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={58} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risk Distribution</CardTitle>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Facility Workload</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={facilityTotals} margin={{ top: 8, right: 8, left: 0, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={56} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ fill: "#f8fafc" }} />
                  <Bar dataKey="total" fill="#0f766e" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="awaitingDoctor" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="assignedToLab" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
