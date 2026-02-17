"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { triageStatusLabel } from "@/lib/triage-status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface PatientRecord {
  id: string
  sample_id?: string
  facility_id?: string
  facility_name?: string
  assigned_doctor_id?: string
  assigned_lab_tech_id?: string
  demographics?: { name?: string; phone?: string; age?: number; gender?: string; village?: string; pincode?: string }
  ai?: { risk_score?: number; risk_level?: string; medgemini_summary?: string }
  status?: { triage_status?: string }
  gps?: { lat?: number; lng?: number }
  audio?: { storage_uri?: string; storage_path?: string; download_url?: string; file_name?: string }[]
  lab_results?: { report_uri?: string; report_path?: string }
}

export default function AdminPatientPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [patient, setPatient] = useState<PatientRecord | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [reportUrl, setReportUrl] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid))
        if (userSnap.data()?.role !== "ADMIN") {
          router.replace("/login")
          return
        }

        const id = params.id
        const patientSnap = await getDoc(doc(db, "patients", id))
        if (!patientSnap.exists()) {
          router.replace("/admin")
          return
        }

        const data = patientSnap.data() as PatientRecord
        setPatient({ id, ...data })

        const audioCandidate = data.audio?.[0]?.download_url || data.audio?.[0]?.storage_uri || data.audio?.[0]?.storage_path
        const reportCandidate = data.lab_results?.report_uri || data.lab_results?.report_path
        setAudioUrl(await resolveStorageUrl(audioCandidate))
        setReportUrl(await resolveStorageUrl(reportCandidate))
        setReady(true)
      } catch {
        router.replace("/admin")
      }
    })

    return () => unsub()
  }, [params.id, router])

  if (!ready || !patient) return <div className="p-6">Loading...</div>

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <Button variant="outline" onClick={() => router.push("/admin")}>Back to Control Tower</Button>

      <Card>
        <CardHeader>
          <CardTitle>{patient.demographics?.name || "Unknown Patient"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Sample ID: {patient.sample_id || "-"}</div>
          <div>Phone: {patient.demographics?.phone || "-"}</div>
          <div>Age/Gender: {patient.demographics?.age || "-"} / {patient.demographics?.gender || "-"}</div>
          <div>Village/Pincode: {patient.demographics?.village || "-"} / {patient.demographics?.pincode || "-"}</div>
          <div>Facility: {patient.facility_name || patient.facility_id || "-"}</div>
          <div>Assigned Doctor UID: {patient.assigned_doctor_id || "-"}</div>
          <div>Assigned Lab UID: {patient.assigned_lab_tech_id || "-"}</div>
          <div>Status: {triageStatusLabel(patient.status?.triage_status)}</div>
          <div>AI Risk: {patient.ai?.risk_score ?? 0} ({patient.ai?.risk_level || "-"})</div>
          <div>AI Summary: {patient.ai?.medgemini_summary || "-"}</div>
          <div>GPS: {patient.gps?.lat ?? "-"}, {patient.gps?.lng ?? "-"}</div>
        </CardContent>
      </Card>

      {(audioUrl || reportUrl) && (
        <Card>
          <CardHeader>
            <CardTitle>Media</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {audioUrl && <audio controls src={audioUrl} className="w-full" />}
            {reportUrl && (
              <a href={reportUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-sm">
                Open Lab Report
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
