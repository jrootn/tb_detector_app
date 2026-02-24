"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { getAiSummaryText, normalizeAiRiskScore } from "@/lib/ai"
import { addUpload } from "@/lib/db"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { syncUploads } from "@/lib/sync"
import { getCachedUserName, resolveUserName } from "@/lib/user-names"
import { normalizeTriageStatus, triageStatusLabel } from "@/lib/triage-status"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PatientNotesThread } from "@/components/patient-notes-thread"

interface PatientRecord {
  id: string
  demographics?: { name?: string; phone?: string; age?: number; gender?: string }
  clinical?: { cough_nature?: string; fever_history?: string; other_observations?: string }
  symptoms?: { symptom_code: string; severity?: string; duration_days?: number }[]
  ai?: {
    risk_score?: number
    medgemini_summary?: string | { en?: string; hi?: string }
    medgemini_summary_en?: string
    medgemini_summary_hi?: string
    medgemini_summary_i18n?: { en?: string; hi?: string }
  }
  audio?: { storage_uri?: string; storage_path?: string; download_url?: string; file_name?: string }[]
  status?: { triage_status?: string }
  doctor_notes?: string
  doctor_instructions?: string
  prescription?: string
  sample_id?: string
  created_at_offline?: string
  asha_name?: string
  asha_id?: string
  asha_worker_id?: string
  doctor_files?: { name: string; url?: string; storage_path?: string; mime_type?: string; uploaded_at: string }[]
  lab_results?: {
    report_uri?: string
    report_path?: string
    uploaded_at?: string
    files?: { name?: string; report_path?: string; report_uri?: string; mime_type?: string; uploaded_at?: string }[]
  }
}

function normalizeName(name?: string) {
  if (!name) return "Unknown"
  return name.replace(/\s+\d+$/, "")
}

function fileKind(name?: string): "image" | "audio" | "pdf" | "other" {
  const lower = (name || "").toLowerCase()
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return "image"
  if (/\.(mp3|wav|ogg|webm|m4a)$/.test(lower)) return "audio"
  if (/\.pdf$/.test(lower)) return "pdf"
  return "other"
}

function getAiRiskScore(patient: PatientRecord): number | null {
  const raw = patient.ai?.risk_score
  const numeric = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(numeric)) return null
  return normalizeAiRiskScore(numeric)
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
  const [resolvedLabFiles, setResolvedLabFiles] = useState<Record<number, string>>({})
  const [resolvedDoctorFiles, setResolvedDoctorFiles] = useState<Record<number, string>>({})
  const [collectedByName, setCollectedByName] = useState<string>("")

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
    const labFileUrls: Record<number, string> = {}
    if (data.lab_results?.files) {
      await Promise.all(
        data.lab_results.files.map(async (f, idx) => {
          const url = await resolveStorageUrl(f.report_uri || f.report_path)
          if (url) labFileUrls[idx] = url
        })
      )
    }
    setResolvedLabFiles(labFileUrls)

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

    const ashaUid = data.asha_id || data.asha_worker_id
        if (data.asha_name && data.asha_name.trim().length > 0) {
          setCollectedByName(data.asha_name)
        } else if (ashaUid) {
          const cached = getCachedUserName(ashaUid)
          if (cached) {
            setCollectedByName(cached)
          } else {
            const resolved = await resolveUserName(ashaUid)
            setCollectedByName(resolved || "ASHA Worker")
          }
        } else {
          setCollectedByName("ASHA Worker")
        }
  }, [params.id, router])

  useEffect(() => {
    loadPatient()
  }, [loadPatient])

  const updateStatus = async (status: string) => {
    if (!patient) return
    const previous = normalizeTriageStatus(patient.status?.triage_status)
    setSavingStatus(true)
    setPatient((prev) => (prev ? { ...prev, status: { triage_status: status } } : prev))
    try {
      await updateDoc(doc(db, "patients", patient.id), {
        "status.triage_status": status,
      })
    } catch (error) {
      setPatient((prev) => (prev ? { ...prev, status: { triage_status: previous } } : prev))
      toast.error("Could not update status. Please retry.")
    } finally {
      setSavingStatus(false)
    }
  }

  const saveNotes = async () => {
    if (!patient) return
    try {
      await updateDoc(doc(db, "patients", patient.id), {
        doctor_notes: note,
        doctor_instructions: instruction,
        prescription: prescription,
      })
      toast.success("Notes saved.")
    } catch {
      toast.error("Could not save notes. Please retry.")
    }
  }

  const uploadFiles = async (filesInput: FileList | File[]) => {
    if (!patient) return
    const files = Array.from(filesInput)
    if (files.length === 0) return
    setUploading(true)
    try {
      const queuedIds: string[] = []
      for (const file of files) {
        const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`
        queuedIds.push(uploadId)
        await addUpload({
          id: uploadId,
          ownerUid: auth.currentUser?.uid,
          patientId: patient.id,
          role: "DOCTOR",
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
      const result = await syncUploads(userId, { role: "DOCTOR", onlyIds: queuedIds })
      await loadPatient()
      if (result.failed > 0) {
        const detail = result.errors[0]?.message
        toast.error(detail ? `Upload failed: ${detail}` : "One or more files failed to sync. Please retry.")
      } else {
        toast.success(`${files.length} file(s) uploaded.`)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed. Check storage rules and role mapping for this user."
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  if (!patient) return <div className="p-6">Loading...</div>

  const currentStatus = normalizeTriageStatus(patient.status?.triage_status)
  const aiRiskScore = getAiRiskScore(patient)
  const collectedAtLabel = (() => {
    if (!patient.created_at_offline) return "-"
    const date = new Date(patient.created_at_offline)
    if (Number.isNaN(date.getTime())) return patient.created_at_offline
    return date.toLocaleString("en-IN")
  })()
  const statusLabelMap: Record<string, string> = {
    COLLECTED: "Collected",
    SYNCED: "Synced",
    AI_TRIAGED: "AI Triaged",
    TEST_QUEUED: "In Testing Queue",
    LAB_DONE: "Lab Result Ready",
    DOCTOR_FINALIZED: "Doctor Finalized",
    ASHA_ACTION_IN_PROGRESS: "ASHA Follow-up Active",
    CLOSED: "Closed",
  }
  const actionButtons = [
    {
      key: "DOCTOR_FINALIZED",
      label: "Finalize Plan",
      help: "Doctor review completed and mandatory action plan recorded.",
    },
    {
      key: "ASHA_ACTION_IN_PROGRESS",
      label: "Start ASHA Follow-up",
      help: "ASHA follow-up has started for medication, contact tracing, or revisit.",
    },
    {
      key: "CLOSED",
      label: "Close Case",
      help: "Workflow completed and case can be closed.",
    },
    {
      key: "TEST_QUEUED",
      label: "Return to Test Queue",
      help: "Send case back for retest or additional diagnostics.",
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
          <div className="text-sm">Collected by: {collectedByName || patient.asha_name || "ASHA Worker"}</div>
          <div className="text-sm">Collected at: {collectedAtLabel}</div>
          <div className="text-sm">Phone: {patient.demographics?.phone || "-"}</div>
          <div className="text-sm">Age: {patient.demographics?.age || "-"}</div>
          <div className="text-sm">Risk: {aiRiskScore == null ? "Awaiting AI" : `${aiRiskScore.toFixed(1)} / 10 (${Math.round(aiRiskScore * 10)}%)`}</div>
          <div className="text-sm">AI Summary: {getAiSummaryText(patient.ai, "en") || "-"}</div>
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

      {(patient.lab_results?.report_uri ||
        patient.lab_results?.report_path ||
        (patient.lab_results?.files && patient.lab_results.files.length > 0)) && (
        <Card>
          <CardHeader>
            <CardTitle>Lab Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {resolvedReport ? (
              <a href={resolvedReport} className="text-sm text-blue-600 underline" target="_blank" rel="noreferrer">
                View Latest Report
              </a>
            ) : (
              <div className="text-sm text-muted-foreground">Report exists but URL could not be resolved.</div>
            )}
            {patient.lab_results?.files && patient.lab_results.files.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">All Lab Uploads</div>
                {patient.lab_results.files.map((f, idx) => (
                  <div key={idx} className="rounded-md border p-2">
                    <a
                      href={resolvedLabFiles[idx] || ""}
                      className="text-sm text-blue-600 underline disabled:pointer-events-none disabled:opacity-50"
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (!resolvedLabFiles[idx]) e.preventDefault()
                      }}
                    >
                      {f.name || `Lab File ${idx + 1}`}
                    </a>
                    {resolvedLabFiles[idx] && fileKind(f.name) === "image" && (
                      <img
                        src={resolvedLabFiles[idx]}
                        alt={f.name || `Lab File ${idx + 1}`}
                        className="mt-2 max-h-52 rounded-md border object-contain"
                      />
                    )}
                    {resolvedLabFiles[idx] && fileKind(f.name) === "audio" && (
                      <audio controls src={resolvedLabFiles[idx]} className="mt-2 w-full" />
                    )}
                  </div>
                ))}
              </div>
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
              Lab routing is automatic based on facility mapping; doctor finalizes post-test actions.
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
            Current Status: {statusLabelMap[currentStatus] || triageStatusLabel(currentStatus)}
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
              multiple
              accept="application/pdf,image/*"
              onChange={(e) => {
                if (e.target.files?.length) {
                  uploadFiles(e.target.files)
                }
                e.currentTarget.value = ""
              }}
              disabled={uploading}
            />
          </div>

          {patient.doctor_files && patient.doctor_files.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Uploaded Files</div>
              {patient.doctor_files.map((f, idx) => (
                <div key={idx} className="rounded-md border p-2">
                  <a
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
                  {resolvedDoctorFiles[idx] && fileKind(f.name) === "image" && (
                    <img
                      src={resolvedDoctorFiles[idx]}
                      alt={f.name}
                      className="mt-2 max-h-52 rounded-md border object-contain"
                    />
                  )}
                  {resolvedDoctorFiles[idx] && fileKind(f.name) === "audio" && (
                    <audio controls src={resolvedDoctorFiles[idx]} className="mt-2 w-full" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes Thread</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientNotesThread patientId={patient.id} viewerRole="DOCTOR" />
        </CardContent>
      </Card>
    </div>
  )
}
