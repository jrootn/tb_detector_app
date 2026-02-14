import { getAllPatients, savePatients, getPendingUploads, removeUpload } from "@/lib/db"
import type { Patient } from "@/lib/mockData"
import { auth, db, storage } from "@/lib/firebase"
import { doc, updateDoc, arrayUnion, setDoc } from "firebase/firestore"
import { ref, uploadBytes } from "firebase/storage"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

function mapStatusToApi(status?: Patient["status"]): string {
  switch (status) {
    case "awaitingDoctor":
      return "AWAITING_DOCTOR"
    case "testPending":
      return "TEST_PENDING"
    case "underTreatment":
      return "UNDER_TREATMENT"
    case "cleared":
      return "CLEARED"
    default:
      return "AWAITING_DOCTOR"
  }
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

function mapPatientToSyncRecord(patient: Patient, ashaWorkerId: string) {
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
  }
}

function getRiskLevel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 7) return "HIGH"
  if (score >= 4) return "MEDIUM"
  return "LOW"
}

function buildDirectFirestorePayload(patient: Patient, ashaWorkerId: string) {
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
  }
}

async function syncPatientsDirectToFirestore(pending: Patient[], ashaWorkerId: string): Promise<Set<string>> {
  const syncedIds = new Set<string>()
  for (const patient of pending) {
    try {
      const payload = buildDirectFirestorePayload(patient, ashaWorkerId)
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
    const patients = await getAllPatients()
    const pending = patients.filter((p) => p.needsSync)
    const records = pending.map((p) => mapPatientToSyncRecord(p, currentUser.uid))
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
        const directSynced = await syncPatientsDirectToFirestore(pending, currentUser.uid)
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

export async function syncUploads(userId: string): Promise<{ uploaded: number; failed: number }> {
  if (!navigator.onLine) return { uploaded: 0, failed: 0 }

  const uploads = await getPendingUploads()
  if (uploads.length === 0) return { uploaded: 0, failed: 0 }
  let uploaded = 0
  let failed = 0

  for (const upload of uploads) {
    try {
      const safeName = `${Date.now()}-${upload.fileName}`.replace(/\s+/g, "_")
      let path = ""
      if (upload.role === "ASHA") {
        path = `asha_uploads/${userId}/${upload.patientId}/${safeName}`
      } else if (upload.role === "LAB_TECH") {
        path = `lab_results/${userId}/${upload.patientId}/${safeName}`
      } else {
        path = `doctor_uploads/${upload.patientId}/${safeName}`
      }

      const fileRef = ref(storage, path)
      const contentType =
        upload.mimeType ||
        (upload.kind === "audio" ? "audio/webm" : upload.kind === "report" ? "application/pdf" : "application/octet-stream")
      await auth.currentUser?.getIdToken(true)
      await uploadBytes(fileRef, upload.blob, { contentType })

      const patientRef = doc(db, "patients", upload.patientId)
      const uploadedAt = new Date().toISOString()

      if (upload.role === "LAB_TECH" && upload.kind === "report") {
        const labResults: Record<string, unknown> = {
          report_path: path,
          uploaded_at: uploadedAt,
          uploaded_by: userId,
        }
        await updateDoc(patientRef, {
          lab_results: labResults,
          "status.triage_status": "LAB_DONE",
        })
      } else if (upload.role === "DOCTOR" && upload.kind === "report") {
        const fileEntry: Record<string, unknown> = {
          name: upload.fileName,
          storage_path: path,
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
      console.warn("Upload sync failed for", upload.id, error)
    }
  }
  return { uploaded, failed }
}
