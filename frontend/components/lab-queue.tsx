"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query } from "firebase/firestore"
import { db, auth } from "@/lib/firebase"
import { addUpload } from "@/lib/db"
import { syncUploads } from "@/lib/sync"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { toast } from "sonner"

interface PatientRecord {
  id: string
  demographics?: { name?: string }
  ai?: { risk_score?: number }
  status?: { triage_status?: string }
  lab_results?: { report_path?: string; report_uri?: string; files?: { report_path?: string; report_uri?: string }[] }
  created_at_offline?: string
  doctor_priority?: boolean
  doctor_rank?: number
  sample_id?: string
  asha_phone_number?: string
}

function normalizeStatusCode(status?: string): string {
  if (!status) return "AWAITING_DOCTOR"
  const normalized = status.toUpperCase()
  if (normalized === "AWAITINGDOCTOR") return "AWAITING_DOCTOR"
  if (normalized === "TESTPENDING") return "TEST_PENDING"
  if (normalized === "UNDERTREATMENT") return "UNDER_TREATMENT"
  return normalized
}

export function LabQueue() {
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [reportUrls, setReportUrls] = useState<Record<string, string>>({})
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

  useEffect(() => {
    let alive = true
    const resolveUrls = async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        patients.map(async (p) => {
          const lastFile = p.lab_results?.files?.[p.lab_results.files.length - 1]
          const candidate =
            p.lab_results?.report_uri ||
            p.lab_results?.report_path ||
            lastFile?.report_uri ||
            lastFile?.report_path
          if (!candidate) return
          const url = await resolveStorageUrl(candidate)
          if (url) next[p.id] = url
        })
      )
      if (alive) setReportUrls(next)
    }
    resolveUrls().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [patients])

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
      const statusCode = normalizeStatusCode(status)
      const hasLabResult = Boolean(
        p.lab_results?.report_path ||
          p.lab_results?.report_uri ||
          (p.lab_results?.files && p.lab_results.files.length > 0)
      )
      const isDone = statusCode === "LAB_DONE" || hasLabResult
      if (filter === "queue" && isDone) return false
      if (filter === "done" && !isDone) return false

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
              <th className="text-left p-3">Report</th>
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
                <td className="p-3">
                  {Boolean(
                    p.lab_results?.report_path ||
                      p.lab_results?.report_uri ||
                      (p.lab_results?.files && p.lab_results.files.length > 0)
                  )
                    ? "LAB_DONE"
                    : normalizeStatusCode(p.status?.triage_status)}
                </td>
                <td className="p-3">{p.asha_phone_number || "-"}</td>
                <td className="p-3">
                  {reportUrls[p.id] ? (
                    <a
                      href={reportUrls[p.id]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 underline"
                    >
                      Preview
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3">
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/*"
                    disabled={uploadingId === p.id}
                    onChange={async (e) => {
                      const inputEl = e.currentTarget
                      const files = Array.from(e.target.files || [])
                      if (files.length === 0) return

                      try {
                        setUploadingId(p.id)
                        const queuedIds: string[] = []
                        for (const file of files) {
                          const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`
                          queuedIds.push(uploadId)
                          await addUpload({
                            id: uploadId,
                            ownerUid: auth.currentUser?.uid,
                            patientId: p.id,
                            role: "LAB_TECH",
                            kind: "report",
                            fileName: file.name,
                            mimeType: file.type || "application/octet-stream",
                            blob: file,
                            createdAt: new Date().toISOString(),
                          })
                        }
                        if (!navigator.onLine) {
                          toast.info(`${files.length} file(s) saved for sync when online.`)
                          return
                        }
                        const userId = auth.currentUser?.uid
                        if (!userId) {
                          toast.error("User session not ready. Please retry.")
                          return
                        }
                        const result = await syncUploads(userId, { role: "LAB_TECH", onlyIds: queuedIds })
                        if (result.failed > 0) {
                          const detail = result.errors[0]?.message
                          toast.error(detail ? `Upload failed: ${detail}` : "One or more files failed to sync. Please retry.")
                        } else {
                          toast.success(`${files.length} file(s) uploaded.`)
                        }
                      } catch (error) {
                        const message = error instanceof Error ? error.message : "Upload failed"
                        toast.error(message)
                      } finally {
                        setUploadingId(null)
                        inputEl.value = ""
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-6 text-center text-muted-foreground" colSpan={7}>
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
