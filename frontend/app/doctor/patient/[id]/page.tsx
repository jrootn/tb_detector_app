"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { addUpload } from "@/lib/db"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { syncUploads } from "@/lib/sync"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const AWAITING_DOCTOR = "AWAITING_DOCTOR"
const ASSIGNED_TO_LAB = "ASSIGNED_TO_LAB"
const TEST_PENDING = "TEST_PENDING"
const UNDER_TREATMENT = "UNDER_TREATMENT"
const CLEARED = "CLEARED"

interface PatientRecord {
  id: string
  demographics?: { name?: string; phone?: string; age?: number; gender?: string }
  clinical?: { cough_nature?: string; fever_history?: string; other_observations?: string }
  symptoms?: { symptom_code: string; severity?: string; duration_days?: number }[]
  ai?: { risk_score?: number; medgemini_summary?: string }
  audio?: { storage_uri?: string; storage_path?: string; download_url?: string; file_name?: string }[]
  status?: { triage_status?: string }
  doctor_notes?: string
  doctor_instructions?: string
  prescription?: string
  sample_id?: string
  doctor_files?: { name: string; url?: string; storage_path?: string; uploaded_at: string }[]
  lab_results?: { report_uri?: string; report_path?: string; uploaded_at?: string }
}

function normalizeName(name?: string) {
  if (!name) return "Unknown"
  return name.replace(/\s+\d+$/, "")
}

function normalizeStatusCode(status?: string): string {
  if (!status) return AWAITING_DOCTOR
  const normalized = status.toUpperCase()
  if (normalized === "AWAITINGDOCTOR") return AWAITING_DOCTOR
  if (normalized === "TESTPENDING") return TEST_PENDING
  if (normalized === "UNDERTREATMENT") return UNDER_TREATMENT
  return normalized
}

export default function DoctorPatientPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [patient, setPatient] = useState<PatientRecord | null>(null)
  const [note, setNote] = useState("")
  const [instruction, setInstruction] = useState("")
  const [prescription, setPrescription] = useState("")
  const [uploading, setUploading] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [resolvedAudio, setResolvedAudio] = useState<Record<number, string>>({})
  const [resolvedReport, setResolvedReport] = useState<string | null>(null)
  const [resolvedDoctorFiles, setResolvedDoctorFiles] = useState<Record<number, string>>({})

  const loadPatient = useCallback(async () => {
    const id = params.id
    const snap = await getDoc(doc(db, "patients", id))
    if (!snap.exists()) {
      router.replace("/doctor")
      return
    }
    const data = snap.data() as PatientRecord
    setPatient({ id, ...data })
    setNote(data.doctor_notes || "")
    setInstruction(data.doctor_instructions || "")
    setPrescription(data.prescription || "")

    const audioUrls: Record<number, string> = {}
    if (data.audio) {
      await Promise.all(
        data.audio.map(async (a, idx) => {
          const candidate = a.download_url || a.storage_uri || a.storage_path
          const url = await resolveStorageUrl(candidate)
          if (url) audioUrls[idx] = url
        })
      )
    }
    setResolvedAudio(audioUrls)

    const reportCandidate = data.lab_results?.report_uri || data.lab_results?.report_path
    setResolvedReport(await resolveStorageUrl(reportCandidate))

    const doctorFileUrls: Record<number, string> = {}
    if (data.doctor_files) {
      await Promise.all(
        data.doctor_files.map(async (f, idx) => {
          const url = await resolveStorageUrl(f.url || f.storage_path)
          if (url) doctorFileUrls[idx] = url
        })
      )
    }
    setResolvedDoctorFiles(doctorFileUrls)
  }, [params.id, router])

  useEffect(() => {
    loadPatient()
  }, [loadPatient])

  const updateStatus = async (status: string) => {
    if (!patient) return
    const previous = normalizeStatusCode(patient.status?.triage_status)
    setSavingStatus(true)
    setPatient((prev) => (prev ? { ...prev, status: { triage_status: status } } : prev))
    try {
      await updateDoc(doc(db, "patients", patient.id), {
        "status.triage_status": status,
      })
    } catch (error) {
      setPatient((prev) => (prev ? { ...prev, status: { triage_status: previous } } : prev))
      alert("Could not update status. Please retry.")
    } finally {
      setSavingStatus(false)
    }
  }

  const saveNotes = async () => {
    if (!patient) return
    await updateDoc(doc(db, "patients", patient.id), {
      doctor_notes: note,
      doctor_instructions: instruction,
      prescription: prescription,
    })
  }

  const uploadFile = async (file: File) => {
    if (!patient) return
    setUploading(true)
    try {
      await addUpload({
        id: `${Date.now()}-${file.name}`,
        patientId: patient.id,
        role: "DOCTOR",
        kind: "report",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        blob: file,
        createdAt: new Date().toISOString(),
      })

      if (!navigator.onLine) {
        alert("Saved for sync when online.")
        return
      }

      const userId = auth.currentUser?.uid
      if (!userId) {
        alert("User session not ready. Please retry.")
        return
      }
      const result = await syncUploads(userId)
      await loadPatient()
      if (result.failed > 0) {
        alert("Upload queued, but one or more files failed to sync. Please retry.")
      } else {
        alert("Upload completed.")
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed. Check storage rules and role mapping for this user."
      alert(message)
    } finally {
      setUploading(false)
    }
  }

  if (!patient) return <div className="p-6">Loading...</div>

  const currentStatus = normalizeStatusCode(patient.status?.triage_status)
  const statusLabelMap: Record<string, string> = {
    [AWAITING_DOCTOR]: "Awaiting Doctor Review",
    [ASSIGNED_TO_LAB]: "Assigned To Lab",
    [TEST_PENDING]: "Test Pending",
    [UNDER_TREATMENT]: "Under Treatment",
    [CLEARED]: "Cleared",
  }
  const actionButtons = [
    {
      key: ASSIGNED_TO_LAB,
      label: "Assign to Lab",
      help: "Use after doctor review when lab sample/report is required.",
    },
    {
      key: TEST_PENDING,
      label: "Mark Test Pending",
      help: "Use when test is advised but sample/result is not completed yet.",
    },
    {
      key: UNDER_TREATMENT,
      label: "Under Treatment",
      help: "Use once TB treatment is started.",
    },
    {
      key: CLEARED,
      label: "Mark Cleared",
      help: "Use when no active TB action is needed after review/tests.",
    },
  ]

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <Button variant="ghost" onClick={() => router.push("/doctor")}>
        ← Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{normalizeName(patient.demographics?.name)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">Sample ID: {patient.sample_id || "-"}</div>
          <div className="text-sm">Phone: {patient.demographics?.phone || "-"}</div>
          <div className="text-sm">Age: {patient.demographics?.age || "-"}</div>
          <div className="text-sm">Risk: {patient.ai?.risk_score ?? 0}</div>
          <div className="text-sm">AI Summary: {patient.ai?.medgemini_summary || "-"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Symptoms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(patient.symptoms || []).map((s, idx) => (
            <div key={idx} className="text-sm">
              {s.symptom_code} {s.severity ? `(${s.severity})` : ""} {s.duration_days ? `- ${s.duration_days} days` : ""}
            </div>
          ))}
          {patient.symptoms?.length === 0 && <div className="text-sm text-muted-foreground">No symptoms</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(patient.audio || []).map((a, idx) => (
            <div key={idx} className="text-sm">
              {a.storage_uri || a.storage_path || a.download_url ? (
                resolvedAudio[idx] ? (
                  <audio controls src={resolvedAudio[idx]} />
                ) : (
                  <span>{a.file_name || "Audio"} (unable to resolve URL)</span>
                )
              ) : (
                <span>{a.file_name || "Audio"} (not uploaded)</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {(patient.lab_results?.report_uri || patient.lab_results?.report_path) && (
        <Card>
          <CardHeader>
            <CardTitle>Lab Report</CardTitle>
          </CardHeader>
          <CardContent>
            {resolvedReport ? (
              <a href={resolvedReport} className="text-sm text-blue-600 underline" target="_blank" rel="noreferrer">
                View Report
              </a>
            ) : (
              <div className="text-sm text-muted-foreground">Report exists but URL could not be resolved.</div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">How to use actions</div>
            <div className="mt-1 text-muted-foreground">
              Sample ID token is auto-generated at ASHA collection and should not be edited by doctor.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {actionButtons.map((action) => (
              <Button
                key={action.key}
                variant={currentStatus === action.key ? "default" : "outline"}
                disabled={savingStatus}
                title={action.help}
                onClick={() => updateStatus(action.key)}
              >
                {action.label}
              </Button>
            ))}
          </div>
          <div className="text-sm text-muted-foreground">
            Current Status: {statusLabelMap[currentStatus] || currentStatus}
            {savingStatus ? " • Updating..." : ""}
          </div>
          <div className="space-y-2">
            <label className="text-sm">Doctor Notes</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <label className="text-sm">Instructions for ASHA</label>
            <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <label className="text-sm">Prescription</label>
            <Textarea value={prescription} onChange={(e) => setPrescription(e.target.value)} rows={3} />
          </div>
          <Button onClick={saveNotes}>Save</Button>

          <div className="space-y-2">
            <label className="text-sm">Upload Report</label>
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadFile(file)
              }}
              disabled={uploading}
            />
          </div>

          {patient.doctor_files && patient.doctor_files.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Uploaded Files</div>
              {patient.doctor_files.map((f, idx) => (
                <a
                  key={idx}
                  href={resolvedDoctorFiles[idx] || f.url || ""}
                  className="text-sm text-blue-600 underline disabled:pointer-events-none disabled:opacity-50"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (!resolvedDoctorFiles[idx] && !f.url) e.preventDefault()
                  }}
                >
                  {f.name}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
