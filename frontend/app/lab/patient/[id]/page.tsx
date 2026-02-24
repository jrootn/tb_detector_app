"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { normalizeAiRiskScore } from "@/lib/ai"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { triageStatusLabel } from "@/lib/triage-status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PatientNotesThread } from "@/components/patient-notes-thread"

interface PatientRecord {
  id: string
  sample_id?: string
  demographics?: { name?: string; phone?: string; age?: number; gender?: string }
  ai?: { risk_score?: number; medgemini_summary?: string }
  status?: { triage_status?: string }
  created_at_offline?: string
  asha_name?: string
  asha_id?: string
  asha_worker_id?: string
  lab_results?: {
    report_uri?: string
    report_path?: string
    files?: { name?: string; report_uri?: string; report_path?: string }[]
  }
}

export default function LabPatientPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [patient, setPatient] = useState<PatientRecord | null>(null)
  const [reportUrl, setReportUrl] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid))
        if (userSnap.data()?.role !== "LAB_TECH") {
          router.replace("/login")
          return
        }

        const id = params.id
        const patientSnap = await getDoc(doc(db, "patients", id))
        if (!patientSnap.exists()) {
          router.replace("/lab")
          return
        }
        const data = patientSnap.data() as PatientRecord
        setPatient({ id, ...data })
        const latest =
          data.lab_results?.report_uri ||
          data.lab_results?.report_path ||
          data.lab_results?.files?.[data.lab_results.files.length - 1]?.report_uri ||
          data.lab_results?.files?.[data.lab_results.files.length - 1]?.report_path
        if (latest) {
          setReportUrl(await resolveStorageUrl(latest))
        }
        setReady(true)
      } catch (error) {
        router.replace("/lab")
      }
    })
    return () => unsub()
  }, [params.id, router])

  if (!ready || !patient) return <div className="p-6">Loading...</div>
  const riskScore = (() => {
    const numeric = typeof patient.ai?.risk_score === "number" ? patient.ai?.risk_score : Number(patient.ai?.risk_score)
    if (!Number.isFinite(numeric)) return null
    return normalizeAiRiskScore(numeric)
  })()
  const collectedAtLabel = (() => {
    if (!patient.created_at_offline) return "-"
    const date = new Date(patient.created_at_offline)
    if (Number.isNaN(date.getTime())) return patient.created_at_offline
    return date.toLocaleString("en-IN")
  })()

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <Button variant="outline" onClick={() => router.push("/lab")}>
        Back to Lab Queue
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{patient.demographics?.name || "Unknown Patient"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Sample ID: {patient.sample_id || "-"}</div>
          <div>Collected by: {patient.asha_name || patient.asha_id || patient.asha_worker_id || "-"}</div>
          <div>Collected at: {collectedAtLabel}</div>
          <div>Phone: {patient.demographics?.phone || "-"}</div>
          <div>Risk Score: {riskScore == null ? "Awaiting AI" : `${riskScore.toFixed(1)} / 10 (${Math.round(riskScore * 10)}%)`}</div>
          <div>Status: {triageStatusLabel(patient.status?.triage_status)}</div>
          {reportUrl && (
            <a className="text-blue-600 underline" href={reportUrl} target="_blank" rel="noreferrer">
              Preview Latest Report
            </a>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Case Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientNotesThread patientId={patient.id} viewerRole="LAB_TECH" />
        </CardContent>
      </Card>
    </div>
  )
}
