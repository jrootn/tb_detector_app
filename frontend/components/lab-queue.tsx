"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, doc, updateDoc, onSnapshot, query } from "firebase/firestore"
import { db, storage, auth } from "@/lib/firebase"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { addUpload } from "@/lib/db"

interface PatientRecord {
  id: string
  demographics?: { name?: string }
  ai?: { risk_score?: number }
  status?: { triage_status?: string }
  created_at_offline?: string
  doctor_priority?: boolean
  doctor_rank?: number
  sample_id?: string
  asha_phone_number?: string
}

export function LabQueue() {
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<"queue" | "done" | "all">("queue")
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "30days" | "date">("all")
  const [specificDate, setSpecificDate] = useState("")
  const [minScore, setMinScore] = useState(0)

  useEffect(() => {
    const q = query(collection(db, "patients"))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PatientRecord) }))
        setPatients(rows)
      },
      (error) => console.error("Failed to load lab queue", error)
    )
    return () => unsub()
  }, [])

  const ordered = useMemo(() => {
    return [...patients].sort((a, b) => {
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
  }, [patients])

  const filtered = useMemo(() => {
    const now = new Date()
    return ordered.filter((p) => {
      const score = p.ai?.risk_score ?? 0
      if (score < minScore) return false

      const status = p.status?.triage_status
      if (filter === "queue" && status === "LAB_DONE") return false
      if (filter === "done" && status !== "LAB_DONE") return false

      if (!p.created_at_offline) return true
      const created = new Date(p.created_at_offline)
      if (dateFilter === "today") return created.toDateString() === now.toDateString()
      if (dateFilter === "week") {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        return created >= weekAgo
      }
      if (dateFilter === "30days") {
        const monthAgo = new Date(now)
        monthAgo.setDate(now.getDate() - 30)
        return created >= monthAgo
      }
      if (dateFilter === "date" && specificDate) {
        const target = new Date(specificDate)
        return created.toDateString() === target.toDateString()
      }
      return true
    })
  }, [ordered, filter, dateFilter, specificDate, minScore])

  return (
    <div className="min-h-screen p-4 bg-background">
      <h1 className="text-xl font-semibold mb-4">Lab Queue</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          className={`px-3 py-1 text-sm rounded border ${filter === "queue" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          onClick={() => setFilter("queue")}
        >
          Queue
        </button>
        <button
          className={`px-3 py-1 text-sm rounded border ${filter === "done" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          onClick={() => setFilter("done")}
        >
          Done
        </button>
        <button
          className={`px-3 py-1 text-sm rounded border ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>

        <select
          className="px-2 py-1 text-sm border rounded"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
        >
          <option value="all">All Dates</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="30days">Last 30 Days</option>
          <option value="date">Specific Date</option>
        </select>
        {dateFilter === "date" && (
          <input
            type="date"
            className="px-2 py-1 text-sm border rounded"
            value={specificDate}
            onChange={(e) => setSpecificDate(e.target.value)}
          />
        )}

        <input
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="px-2 py-1 text-sm border rounded w-28"
          placeholder="Min score"
        />
      </div>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-3">Sample ID</th>
              <th className="text-left p-3">Patient</th>
              <th className="text-left p-3">AI Risk</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">ASHA Phone</th>
              <th className="text-left p-3">Upload Report</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{p.sample_id || "-"}</td>
                <td className="p-3">{p.demographics?.name || "Unknown"}</td>
                <td className={`p-3 ${p.ai?.risk_score && p.ai.risk_score >= 8 ? "text-red-600" : "text-emerald-600"}`}>
                  {p.ai?.risk_score ?? 0}
                </td>
                <td className="p-3">{p.status?.triage_status || "-"}</td>
                <td className="p-3">{p.asha_phone_number || "-"}</td>
                <td className="p-3">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={uploadingId === p.id}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return

                      if (!navigator.onLine) {
                        await addUpload({
                          id: `${Date.now()}-${file.name}`,
                          patientId: p.id,
                          role: "LAB_TECH",
                          kind: "report",
                          fileName: file.name,
                          mimeType: file.type || "application/pdf",
                          blob: file,
                          createdAt: new Date().toISOString(),
                        })
                        alert("Saved for sync when online.")
                        return
                      }

                      try {
                        setUploadingId(p.id)
                        const userId = auth.currentUser?.uid || "lab"
                        const path = `lab_results/${userId}/${p.id}/${Date.now()}-${file.name}`
                        const fileRef = ref(storage, path)
                        await uploadBytes(fileRef, file, { contentType: file.type || "application/pdf" })
                        const url = await getDownloadURL(fileRef)
                        await updateDoc(doc(db, "patients", p.id), {
                          lab_results: {
                            report_uri: url,
                            uploaded_at: new Date().toISOString(),
                            uploaded_by: userId,
                          },
                          "status.triage_status": "LAB_DONE",
                        })
                        alert("Report uploaded.")
                      } finally {
                        setUploadingId(null)
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-6 text-center text-muted-foreground" colSpan={6}>
                  No patients in queue
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
