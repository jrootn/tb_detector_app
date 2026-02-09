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
  sample_id?: string
  asha_phone_number?: string
}

export function LabQueue() {
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [uploadingId, setUploadingId] = useState<string | null>(null)

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
              <th className="text-left p-3">Upload Report</th>
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
