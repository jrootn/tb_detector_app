"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { ref, uploadBytes } from "firebase/storage"
import { auth, db, storage } from "@/lib/firebase"
import { addUpload } from "@/lib/db"
import { resolveStorageUrl } from "@/lib/storage-utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

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

export default function DoctorPatientPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [patient, setPatient] = useState<PatientRecord | null>(null)
  const [note, setNote] = useState("")
  const [instruction, setInstruction] = useState("")
  const [prescription, setPrescription] = useState("")
  const [uploading, setUploading] = useState(false)
  const [resolvedAudio, setResolvedAudio] = useState<Record<number, string>>({})
  const [resolvedReport, setResolvedReport] = useState<string | null>(null)
  const [resolvedDoctorFiles, setResolvedDoctorFiles] = useState<Record<number, string>>({})

  useEffect(() => {
    const load = async () => {
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

      if (data.audio) {
        const next: Record<number, string> = {}
        await Promise.all(
          data.audio.map(async (a, idx) => {
            const candidate = a.download_url || a.storage_uri || a.storage_path
            const url = await resolveStorageUrl(candidate)
            if (url) next[idx] = url
          })
        )
        setResolvedAudio(next)
      }

      const reportCandidate = data.lab_results?.report_uri || data.lab_results?.report_path
      setResolvedReport(await resolveStorageUrl(reportCandidate))

      if (data.doctor_files) {
        const next: Record<number, string> = {}
        await Promise.all(
          data.doctor_files.map(async (f, idx) => {
            const url = await resolveStorageUrl(f.url || f.storage_path)
            if (url) next[idx] = url
          })
        )
        setResolvedDoctorFiles(next)
      }
    }
    load()
  }, [params, router])

  const assignToLab = async () => {
    if (!patient) return
    await updateDoc(doc(db, "patients", patient.id), {
      "status.triage_status": "ASSIGNED_TO_LAB",
    })
    setPatient((prev) => prev ? { ...prev, status: { triage_status: "ASSIGNED_TO_LAB" } } : prev)
  }

  const updateStatus = async (status: string) => {
    if (!patient) return
    await updateDoc(doc(db, "patients", patient.id), {
      "status.triage_status": status,
    })
    setPatient((prev) => (prev ? { ...prev, status: { triage_status: status } } : prev))
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
    if (!navigator.onLine) {
      await addUpload({
        id: `${Date.now()}-${file.name}`,
        patientId: patient.id,
        role: "DOCTOR",
        kind: "report",
        fileName: file.name,
        mimeType: file.type || "application/pdf",
        blob: file,
        createdAt: new Date().toISOString(),
      })
      alert("Saved for sync when online.")
      return
    }
    setUploading(true)
    try {
      const safeName = `${Date.now()}-${file.name}`.replace(/\s+/g, "_")
      const path = `doctor_uploads/${patient.id}/${safeName}`
      const fileRef = ref(storage, path)
      await auth.currentUser?.getIdToken(true)
      await uploadBytes(fileRef, file)
      const url = await resolveStorageUrl(path)

      const existing = patient.doctor_files || []
      const next = [
        ...existing,
        { name: file.name, url: url || undefined, storage_path: path, uploaded_at: new Date().toISOString() },
      ]

      await updateDoc(doc(db, "patients", patient.id), {
        doctor_files: next,
      })

      setPatient((prev) => (prev ? { ...prev, doctor_files: next } : prev))
    } catch (error) {
      alert("Upload failed. Check storage rules and role mapping for this user.")
    } finally {
      setUploading(false)
    }
  }

  if (!patient) return <div className="p-6">Loading...</div>

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <Button variant="ghost" onClick={() => router.push("/doctor")}>
        ← Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{patient.demographics?.name || "Unknown"}</CardTitle>
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
              {a.storage_uri ? (
                <audio controls src={resolvedAudio[idx] || a.storage_uri} />
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={assignToLab}>Assign to Lab</Button>
            <Button variant="outline" onClick={() => updateStatus("TEST_PENDING")}>Mark Test Pending</Button>
            <Button variant="outline" onClick={() => updateStatus("UNDER_TREATMENT")}>Under Treatment</Button>
            <Button variant="outline" onClick={() => updateStatus("CLEARED")}>Mark Cleared</Button>
          </div>
          <div className="text-sm text-muted-foreground">
            Current Status: {patient.status?.triage_status || "AWAITING_DOCTOR"}
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
