"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { collection, updateDoc, doc, onSnapshot, query } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useRouter } from "next/navigation"

import "leaflet/dist/leaflet.css"

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false })
const CircleMarker = dynamic(() => import("react-leaflet").then((m) => m.CircleMarker), { ssr: false })

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

export function DoctorDashboard() {
  const router = useRouter()
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [view, setView] = useState<"list" | "map" | "analytics">("list")
  const [mounted, setMounted] = useState(false)
  const [filter, setFilter] = useState<"all" | "today" | "week" | "30days" | "date">("all")
  const [specificDate, setSpecificDate] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [isOnline, setIsOnline] = useState(true)
  const [mapKey, setMapKey] = useState(0)

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

  useEffect(() => {
    if (view === "map" && isOnline) {
      setMapKey((prev) => prev + 1)
    }
  }, [view, isOnline])

  const filtered = useMemo(() => {
    const now = new Date()
    return patients.filter((p) => {
      if (statusFilter !== "all" && p.status?.triage_status !== statusFilter) {
        return false
      }

      if (search) {
        const name = p.demographics?.name?.toLowerCase() || ""
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
      const aRank = a.doctor_rank ?? 0
      const bRank = b.doctor_rank ?? 0
      if (aRank !== bRank) return aRank - bRank
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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    patients.forEach((p) => {
      const status = p.status?.triage_status || "AWAITING_DOCTOR"
      counts[status] = (counts[status] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [patients])

  const riskBuckets = useMemo(() => {
    const buckets = { High: 0, Medium: 0, Low: 0 }
    patients.forEach((p) => {
      const score = p.ai?.risk_score ?? 0
      if (score >= 7) buckets.High += 1
      else if (score >= 4) buckets.Medium += 1
      else buckets.Low += 1
    })
    return Object.entries(buckets).map(([name, value]) => ({ name, value }))
  }, [patients])

  const highRiskPatients = useMemo(() => {
    return patients.filter((p) => (p.ai?.risk_score ?? 0) >= 7)
  }, [patients])

  const exportAnalytics = () => {
    const lines: string[] = []
    lines.push("Metric,Value")
    lines.push(`Total Patients,${patients.length}`)
    lines.push(`High Risk,${highRiskPatients.length}`)
    lines.push(
      `Awaiting Doctor,${patients.filter((p) => p.status?.triage_status === "AWAITING_DOCTOR").length}`
    )

    lines.push("")
    lines.push("High Risk Patients")
    lines.push("Name,Sample ID,Risk Score,Status")
    highRiskPatients.forEach((p) => {
      const name = p.demographics?.name || "Unknown"
      const sample = p.sample_id || "-"
      const score = p.ai?.risk_score ?? 0
      const status = p.status?.triage_status || "AWAITING_DOCTOR"
      lines.push(`${name},${sample},${score},${status}`)
    })

    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "doctor-analytics.csv"
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
                    {patient.demographics?.name || "Unknown"}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(patient.status?.triage_status)}`}>
                      {patient.status?.triage_status || "AWAITING_DOCTOR"}
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
          <MapContainer
            key={`map-${mapKey}`}
            id={`map-${mapKey}`}
            center={[21.1458, 79.0882]}
            zoom={11}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {filtered
              .filter((p) => p.gps?.lat && p.gps?.lng)
              .map((p) => {
                const score = p.ai?.risk_score ?? 0
                const color = score >= 8 ? "#ef4444" : "#10b981"
                return (
                  <CircleMarker
                    key={p.id}
                    center={[p.gps!.lat!, p.gps!.lng!]}
                    radius={8}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.7 }}
                  />
                )
              })}
          </MapContainer>
        </div>
      )}

      {view === "analytics" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportAnalytics}>Export CSV</Button>
            <Button variant="outline" onClick={() => window.print()}>
              Print
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total Patients</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{patients.length}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">High Risk</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-red-600">
                {patients.filter((p) => (p.ai?.risk_score ?? 0) >= 7).length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Pending Review</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-amber-600">
                {patients.filter((p) => p.status?.triage_status === "AWAITING_DOCTOR").length}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cases by Status</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusCounts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0f766e" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Risk Distribution</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskBuckets}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">High Risk Patients</CardTitle>
            </CardHeader>
            <CardContent>
              {highRiskPatients.length === 0 && (
                <div className="text-sm text-muted-foreground">No high risk patients</div>
              )}
              {highRiskPatients.length > 0 && (
                <div className="divide-y rounded-md border">
                  {highRiskPatients.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3">
                      <div>
                        <div className="text-sm font-medium">{p.demographics?.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          Sample: {p.sample_id || "-"} • Score: {p.ai?.risk_score ?? 0}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/doctor/patient/${p.id}`)}
                      >
                        View
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
