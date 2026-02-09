"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"

interface PatientRecord {
  id: string
  demographics?: { name?: string }
  ai?: { risk_score?: number }
  status?: { triage_status?: string }
  sample_id?: string
  asha_phone_number?: string
}

export function LabQueue() {
  const [patients, setPatients] = useState<PatientRecord[]>([])

  useEffect(() => {
    const fetchPatients = async () => {
      const snap = await getDocs(collection(db, "patients"))
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PatientRecord) }))
      setPatients(rows)
    }
    fetchPatients()
  }, [])

  const queue = useMemo(() => {
    return patients.filter(
      (p) => p.status?.triage_status === "ASSIGNED_TO_LAB" || (p.ai?.risk_score ?? 0) >= 8
    )
  }, [patients])

  return (
    <div className="min-h-screen p-4 bg-background">
      <h1 className="text-xl font-semibold mb-4">Lab Queue</h1>
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-3">Sample ID</th>
              <th className="text-left p-3">Patient</th>
              <th className="text-left p-3">AI Risk</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">ASHA Phone</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{p.sample_id || "-"}</td>
                <td className="p-3">{p.demographics?.name || "Unknown"}</td>
                <td className={`p-3 ${p.ai?.risk_score && p.ai.risk_score >= 8 ? "text-red-600" : "text-emerald-600"}`}>
                  {p.ai?.risk_score ?? 0}
                </td>
                <td className="p-3">{p.status?.triage_status || "-"}</td>
                <td className="p-3">{p.asha_phone_number || "-"}</td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
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
