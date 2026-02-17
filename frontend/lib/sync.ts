import { getAllPatients, savePatients, getPendingUploads, removeUpload } from "@/lib/db"
import type { Patient } from "@/lib/mockData"
import { auth, db, storage } from "@/lib/firebase"
import { doc, updateDoc, arrayUnion, setDoc, getDoc, collection, getDocs } from "firebase/firestore"
import { ref, uploadBytes } from "firebase/storage"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
type AppRole = "ASHA" | "DOCTOR" | "LAB_TECH"
interface UploadSyncOptions {
  role?: AppRole
  onlyIds?: string[]
}

interface UploadSyncResult {
  uploaded: number
  failed: number
  errors: Array<{ id: string; message: string }>
}

interface AssignmentContext {
  facilityId?: string
  facilityName?: string
  tuId?: string
  ashaName?: string
  ashaPhone?: string
  assignedDoctorId?: string
  assignedLabTechId?: string
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

function mapStatusToApi(status?: Patient["status"]): string {
  switch (status) {
    case "awaitingDoctor":
      return "TEST_QUEUED"
    case "testPending":
      return "TEST_QUEUED"
    case "underTreatment":
      return "ASHA_ACTION_IN_PROGRESS"
    case "cleared":
      return "CLOSED"
    default:
      return "TEST_QUEUED"
  }
}

function inferMimeType(fileName: string, kind: "audio" | "image" | "report", fallback?: string): string {
  if (fallback && fallback !== "application/octet-stream") return fallback
  const lower = fileName.toLowerCase()
  if (kind === "audio") {
    if (lower.endsWith(".wav")) return "audio/wav"
    if (lower.endsWith(".mp3")) return "audio/mpeg"
    if (lower.endsWith(".ogg")) return "audio/ogg"
    if (lower.endsWith(".m4a")) return "audio/mp4"
    return "audio/webm"
  }
  if (kind === "report") {
    if (lower.endsWith(".pdf")) return "application/pdf"
    if (lower.endsWith(".png")) return "image/png"
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
    if (lower.endsWith(".webp")) return "image/webp"
  }
  if (kind === "image") {
    if (lower.endsWith(".png")) return "image/png"
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
    if (lower.endsWith(".webp")) return "image/webp"
  }
  return fallback || "application/octet-stream"
}

function mapCoughNatureToApi(value?: Patient["coughNature"]): string | null {
  switch (value) {
    case "dry":
      return "DRY"
    case "wet":
      return "WET"
    case "bloodStained":
      return "BLOOD_STAINED"
    default:
      return null
  }
}

function mapFeverToApi(value?: Patient["feverHistory"]): string | null {
  switch (value) {
    case "none":
      return "NONE"
    case "lowGrade":
      return "LOW_GRADE"
    case "highGrade":
      return "HIGH_GRADE"
    default:
      return null
  }
}

function mapPatientToSyncRecord(patient: Patient, ashaWorkerId: string, assignment?: AssignmentContext) {
  return {
    patient_local_id: patient.id,
    device_id: "web-app",
    asha_worker_id: ashaWorkerId,
    asha_id: ashaWorkerId,
    created_at_offline: patient.createdAt,
    demographics: {
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      phone: patient.phone,
      aadhar_last4: patient.aadhar ? patient.aadhar.slice(-4) : null,
      address: patient.address,
      village: patient.village || "",
      pincode: patient.pincode,
    },
    gps: patient.latitude != null && patient.longitude != null ? {
      lat: patient.latitude,
      lng: patient.longitude,
      accuracy_m: null,
    } : null,
    vitals: {
      weight_kg: patient.weight || null,
      height_cm: patient.height || null,
    },
    symptoms: [],
    clinical: {
      cough_duration_days: patient.coughDuration || null,
      cough_nature: mapCoughNatureToApi(patient.coughNature),
      fever_history: mapFeverToApi(patient.feverHistory),
      physical_signs: patient.physicalSigns || [],
      risk_factors: patient.riskFactors || [],
      risk_factor_answers: {},
      other_observations: patient.otherObservations || null,
    },
    audio: [],
    status: {
      triage_status: mapStatusToApi(patient.status),
    },
    sample_id: patient.sampleId || null,
    facility_id: assignment?.facilityId || null,
    facility_name: assignment?.facilityName || null,
    tu_id: assignment?.tuId || null,
    assignment_mode: assignment?.facilityId ? "FACILITY_TAGGING" : null,
    assigned_doctor_id: assignment?.assignedDoctorId || null,
    assigned_lab_tech_id: assignment?.assignedLabTechId || null,
    asha_name: assignment?.ashaName || null,
    asha_phone_number: assignment?.ashaPhone || null,
  }
}

function getRiskLevel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 7) return "HIGH"
  if (score >= 4) return "MEDIUM"
  return "LOW"
}

function buildDirectFirestorePayload(patient: Patient, ashaWorkerId: string, assignment?: AssignmentContext) {
  const riskScore = Number(patient.riskScore || 0)
  const hearScore = Number(patient.hearAudioScore ?? Math.max(0, Math.min(1, riskScore / 10)))
  return {
    patient_local_id: patient.id,
    device_id: "web-app",
    asha_worker_id: ashaWorkerId,
    asha_id: ashaWorkerId,
    created_at_offline: patient.createdAt,
    synced_at: new Date().toISOString(),
    demographics: {
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      phone: patient.phone,
      aadhar_last4: patient.aadhar ? patient.aadhar.slice(-4) : null,
      address: patient.address,
      village: patient.village || "",
      pincode: patient.pincode,
    },
    gps:
      patient.latitude != null && patient.longitude != null
        ? {
            lat: patient.latitude,
            lng: patient.longitude,
            accuracy_m: null,
          }
        : null,
    vitals: {
      weight_kg: patient.weight || null,
      height_cm: patient.height || null,
    },
    symptoms: [],
    clinical: {
      cough_duration_days: patient.coughDuration || null,
      cough_nature: mapCoughNatureToApi(patient.coughNature),
      fever_history: mapFeverToApi(patient.feverHistory),
      physical_signs: patient.physicalSigns || [],
      risk_factors: patient.riskFactors || [],
      risk_factor_answers: {},
      other_observations: patient.otherObservations || null,
    },
    audio: [],
    ai: {
      hear_embedding_id: null,
      hear_score: hearScore,
      medgemini_summary: patient.medGemmaReasoning || "AI summary pending",
      risk_score: riskScore,
      risk_level: getRiskLevel(riskScore),
    },
    status: {
      triage_status: mapStatusToApi(patient.status),
    },
    sample_id: patient.sampleId || null,
    facility_id: assignment?.facilityId || null,
    facility_name: assignment?.facilityName || null,
    tu_id: assignment?.tuId || null,
    assignment_mode: assignment?.facilityId ? "FACILITY_TAGGING" : null,
    assigned_doctor_id: assignment?.assignedDoctorId || null,
    assigned_lab_tech_id: assignment?.assignedLabTechId || null,
    asha_name: assignment?.ashaName || null,
    asha_phone_number: assignment?.ashaPhone || null,
  }
}

async function resolveAssignmentContext(ashaWorkerId: string): Promise<AssignmentContext> {
  const result: AssignmentContext = {}
  try {
    const ashaSnap = await getDoc(doc(db, "users", ashaWorkerId))
    if (!ashaSnap.exists()) return result
    const ashaData = ashaSnap.data() as {
      facility_id?: string
      facility_name?: string
      tu_id?: string
      name?: string
      phone?: string
    }
    if (!ashaData.facility_id) return result

    result.facilityId = ashaData.facility_id
    result.facilityName = ashaData.facility_name
    result.tuId = ashaData.tu_id
    result.ashaName = ashaData.name
    result.ashaPhone = ashaData.phone

    const usersSnap = await getDocs(collection(db, "users"))
    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() as { role?: string; facility_id?: string }
      if (!result.assignedDoctorId && user.role === "DOCTOR" && user.facility_id === ashaData.facility_id) {
        result.assignedDoctorId = userDoc.id
      }
      if (!result.assignedLabTechId && user.role === "LAB_TECH" && user.facility_id === ashaData.facility_id) {
        result.assignedLabTechId = userDoc.id
      }
      if (result.assignedDoctorId && result.assignedLabTechId) break
    }
  } catch (error) {
    console.warn("Could not resolve assignment context", error)
  }
  return result
}

async function syncPatientsDirectToFirestore(
  pending: Patient[],
  ashaWorkerId: string,
  assignment?: AssignmentContext
): Promise<Set<string>> {
  const syncedIds = new Set<string>()
  for (const patient of pending) {
    try {
      const payload = buildDirectFirestorePayload(patient, ashaWorkerId, assignment)
      await setDoc(doc(db, "patients", patient.id), payload, { merge: true })
      syncedIds.add(patient.id)
    } catch (error) {
      console.warn("Direct Firestore sync failed for", patient.id, error)
    }
  }
  return syncedIds
}

export async function syncData(options: { uploadsOnly?: boolean } = {}) {
  if (!navigator.onLine) return

    const currentUser = auth.currentUser
    if (!currentUser) return

    try {
      const idToken = await currentUser.getIdToken()
      const assignment = await resolveAssignmentContext(currentUser.uid)
      const patients = await getAllPatients()
      const pending = patients.filter((p) => p.needsSync)
      const records = pending.map((p) => mapPatientToSyncRecord(p, currentUser.uid, assignment))
      const syncedIds = new Set<string>()

    if (!options.uploadsOnly && records.length > 0) {
      let syncedViaBackend = false
      try {
        const res = await fetch(`${API_BASE}/v1/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ records }),
        })

        if (!res.ok) {
          throw new Error(`Sync failed: ${res.status}`)
        }
        syncedViaBackend = true
        pending.forEach((p) => syncedIds.add(p.id))
      } catch (error) {
        console.warn("Backend sync failed, falling back to direct Firestore write:", error)
      }

      if (!syncedViaBackend) {
        const directSynced = await syncPatientsDirectToFirestore(pending, currentUser.uid, assignment)
        directSynced.forEach((id) => syncedIds.add(id))
      }

      if (syncedIds.size > 0) {
        const updated = patients.map((p) =>
          syncedIds.has(p.id) ? { ...p, needsSync: false } : p
        )
        await savePatients(updated)
      }
    }

    await syncUploads(currentUser.uid)

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sync:complete"))
    }
  } catch (error) {
    console.warn("Sync failed", error)
  }
}

export async function syncUploads(userId: string, options: UploadSyncOptions = {}): Promise<UploadSyncResult> {
  if (!navigator.onLine) return { uploaded: 0, failed: 0, errors: [] }
  const currentRole = (typeof window !== "undefined" ? localStorage.getItem("user_role") : null) as AppRole | null
  const uploads = (await getPendingUploads(userId)).filter((upload) => {
    if (upload.patientId === "pending") return false
    if (options.role && upload.role !== options.role) return false
    if (!options.role && currentRole && upload.role !== currentRole) return false
    if (options.onlyIds && !options.onlyIds.includes(upload.id)) return false
    return true
  })
  if (uploads.length === 0) return { uploaded: 0, failed: 0, errors: [] }
  let uploaded = 0
  let failed = 0
  const errors: Array<{ id: string; message: string }> = []

  for (const upload of uploads) {
    try {
      const safeName = `${Date.now()}-${upload.fileName}`.replace(/\s+/g, "_")
      let path = ""
      let doctorFallbackPath: string | null = null
      if (upload.role === "ASHA") {
        path = `asha_uploads/${userId}/${upload.patientId}/${safeName}`
      } else if (upload.role === "LAB_TECH") {
        path = `lab_results/${userId}/${upload.patientId}/${safeName}`
      } else {
        // Prefer UID-scoped path for stricter rule sets; fallback to legacy path if needed.
        path = `doctor_uploads/${userId}/${upload.patientId}/${safeName}`
        doctorFallbackPath = `doctor_uploads/${upload.patientId}/${safeName}`
      }

      const contentType = inferMimeType(upload.fileName, upload.kind, upload.mimeType)
      await auth.currentUser?.getIdToken(true)
      try {
        const fileRef = ref(storage, path)
        await uploadBytes(fileRef, upload.blob, { contentType })
      } catch (initialError) {
        if (
          upload.role === "DOCTOR" &&
          doctorFallbackPath &&
          getErrorCode(initialError) === "storage/unauthorized"
        ) {
          const fallbackRef = ref(storage, doctorFallbackPath)
          await uploadBytes(fallbackRef, upload.blob, { contentType })
          path = doctorFallbackPath
        } else {
          throw initialError
        }
      }

      const patientRef = doc(db, "patients", upload.patientId)
      const uploadedAt = new Date().toISOString()

      if (upload.role === "LAB_TECH" && upload.kind === "report") {
        const reportEntry: Record<string, unknown> = {
          name: upload.fileName,
          report_path: path,
          mime_type: contentType,
          uploaded_at: uploadedAt,
          uploaded_by: userId,
        }
        await updateDoc(patientRef, {
          "lab_results.report_path": path,
          "lab_results.uploaded_at": uploadedAt,
          "lab_results.uploaded_by": userId,
          "lab_results.files": arrayUnion(reportEntry),
          "status.triage_status": "LAB_DONE",
        })
      } else if (upload.role === "DOCTOR" && upload.kind === "report") {
        const fileEntry: Record<string, unknown> = {
          name: upload.fileName,
          storage_path: path,
          mime_type: contentType,
          uploaded_at: uploadedAt,
        }
        await updateDoc(patientRef, {
          doctor_files: arrayUnion(fileEntry),
        })
      } else {
        const audioEntry: Record<string, unknown> = {
          file_name: upload.fileName,
          mime_type: contentType,
          storage_path: path,
          uploaded_at: uploadedAt,
        }
        await updateDoc(patientRef, {
          audio: arrayUnion(audioEntry),
        })
      }

      await removeUpload(upload.id)
      uploaded += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : "Upload failed"
      errors.push({ id: upload.id, message })
      console.warn("Upload sync failed for", upload.id, error)
    }
  }
  return { uploaded, failed, errors }
}
