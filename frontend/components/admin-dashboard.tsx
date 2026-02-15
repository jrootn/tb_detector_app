"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Building2, CircleCheck, Stethoscope, TestTube2, Users } from "lucide-react"

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
  assigned_doctor_id?: string
  assigned_lab_tech_id?: string
  status?: { triage_status?: string }
  ai?: { risk_score?: number; risk_level?: string }
  demographics?: { name?: string; village?: string; pincode?: string }
  synced_at?: string
}

function normalizeStatusCode(status?: string): string {
  if (!status) return "AWAITING_DOCTOR"
  const normalized = status.toUpperCase()
  if (normalized === "AWAITINGDOCTOR") return "AWAITING_DOCTOR"
  if (normalized === "TESTPENDING") return "TEST_PENDING"
  if (normalized === "UNDERTREATMENT") return "UNDER_TREATMENT"
  return normalized
}

function toStatusLabel(status?: string): string {
  const code = normalizeStatusCode(status)
  switch (code) {
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
      return code
  }
}

function patientPriorityScore(patient: PatientRecord): number {
  const risk = Number(patient.ai?.risk_score || 0)
  const status = normalizeStatusCode(patient.status?.triage_status)
  const statusBoost = status === "AWAITING_DOCTOR" ? 1.5 : status === "TEST_PENDING" ? 0.7 : 0
  return Number((risk + statusBoost).toFixed(2))
}

export function AdminDashboard() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [facilities, setFacilities] = useState<FacilityRecord[]>([])

  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [search, setSearch] = useState("")

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
    return patients.filter((p) => {
      if (facilityFilter !== "all" && (p.facility_id || "") !== facilityFilter) return false
      if (statusFilter !== "all" && normalizeStatusCode(p.status?.triage_status) !== statusFilter) return false
      if (!search.trim()) return true
      const needle = search.trim().toLowerCase()
      const name = (p.demographics?.name || "").toLowerCase()
      const sample = (p.sample_id || "").toLowerCase()
      const pid = (p.id || "").toLowerCase()
      return name.includes(needle) || sample.includes(needle) || pid.includes(needle)
    })
  }, [patients, facilityFilter, statusFilter, search])

  const highRiskPending = useMemo(() => {
    return filteredPatients
      .filter((p) => {
        const risk = Number(p.ai?.risk_score || 0)
        const status = normalizeStatusCode(p.status?.triage_status)
        return risk >= 7 && (status === "AWAITING_DOCTOR" || status === "TEST_PENDING" || status === "ASSIGNED_TO_LAB")
      })
      .sort((a, b) => patientPriorityScore(b) - patientPriorityScore(a))
      .slice(0, 12)
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
        const status = normalizeStatusCode(p.status?.triage_status)
        if (status === "AWAITING_DOCTOR") acc[fid].awaitingDoctor += 1
        if (status === "ASSIGNED_TO_LAB") acc[fid].assignedToLab += 1
        if (status === "LAB_DONE" || status === "UNDER_TREATMENT" || status === "CLEARED") acc[fid].labDone += 1
        return acc
      }, {})
    ).sort((a, b) => b.total - a.total)
  }, [filteredPatients, facilityMap])

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">NTEP Control Tower</h1>
          <p className="text-sm text-muted-foreground">
            Monitoring-focused admin view across TU/PHC facilities.
          </p>
        </div>
        <Badge className="bg-slate-900 text-white">Read + Monitor</Badge>
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
        <CardContent className="flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient by name, sample ID, or patient ID"
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
            <option value="AWAITING_DOCTOR">Awaiting Doctor</option>
            <option value="ASSIGNED_TO_LAB">Assigned To Lab</option>
            <option value="TEST_PENDING">Test Pending</option>
            <option value="LAB_DONE">Lab Done</option>
            <option value="UNDER_TREATMENT">Under Treatment</option>
            <option value="CLEARED">Cleared</option>
          </select>
        </CardContent>
      </Card>

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
              <span>Awaiting doctor review</span>
              <Badge variant="secondary">
                {filteredPatients.filter((p) => normalizeStatusCode(p.status?.triage_status) === "AWAITING_DOCTOR").length}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <span>Assigned to lab</span>
              <Badge variant="secondary">
                {filteredPatients.filter((p) => normalizeStatusCode(p.status?.triage_status) === "ASSIGNED_TO_LAB").length}
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
                  <td className="p-2">{Number(p.ai?.risk_score || 0).toFixed(1)}</td>
                  <td className="p-2">{toStatusLabel(p.status?.triage_status)}</td>
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
                <th className="p-2 text-left">Awaiting Doctor</th>
                <th className="p-2 text-left">Assigned To Lab</th>
                <th className="p-2 text-left">Lab Completed</th>
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
    </div>
  )
}
