import { getAllPatients, savePatients, getPendingUploads, removeUpload } from "@/lib/db"
import type { Patient } from "@/lib/mockData"
import { auth, db, storage } from "@/lib/firebase"
import { doc, updateDoc, arrayUnion } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

function mapPatientToSyncRecord(patient: Patient, ashaWorkerId: string) {
  return {
    patient_local_id: patient.id,
    device_id: "web-app",
    asha_worker_id: ashaWorkerId,
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
    gps: patient.latitude && patient.longitude ? {
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
      cough_nature: patient.coughNature?.toUpperCase() || null,
      fever_history: patient.feverHistory?.toUpperCase() || null,
      physical_signs: patient.physicalSigns || [],
      risk_factors: patient.riskFactors || [],
      risk_factor_answers: {},
      other_observations: patient.otherObservations || null,
    },
    audio: [],
    status: {
      triage_status: patient.status?.toUpperCase() || "AWAITING_DOCTOR",
    },
    sample_id: patient.sampleId || null,
  }
}

export async function syncData() {
  if (!navigator.onLine) return

  const currentUser = auth.currentUser
  if (!currentUser) return

  try {
    const idToken = await currentUser.getIdToken()
    const patients = await getAllPatients()
    const pending = patients.filter((p) => p.needsSync)
    const records = pending.map((p) => mapPatientToSyncRecord(p, currentUser.uid))

    if (records.length > 0) {
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

      const updated = patients.map((p) =>
        pending.find((x) => x.id === p.id) ? { ...p, needsSync: false } : p
      )
      await savePatients(updated)
    }

    await syncUploads(currentUser.uid)

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sync:complete"))
    }
  } catch (error) {
    console.error("Sync failed", error)
  }
}

export async function syncUploads(userId: string) {
  if (!navigator.onLine) return

  const uploads = await getPendingUploads()
  if (uploads.length === 0) return

  for (const upload of uploads) {
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
    await uploadBytes(fileRef, upload.blob, { contentType: upload.mimeType })
    const url = await getDownloadURL(fileRef)

    const patientRef = doc(db, "patients", upload.patientId)
    const uploadedAt = new Date().toISOString()

    if (upload.role === "LAB_TECH" && upload.kind === "report") {
      await updateDoc(patientRef, {
        lab_results: {
          report_uri: url,
          uploaded_at: uploadedAt,
          uploaded_by: userId,
        },
      })
    } else if (upload.role === "DOCTOR" && upload.kind === "report") {
      await updateDoc(patientRef, {
        doctor_files: arrayUnion({
          name: upload.fileName,
          url,
          uploaded_at: uploadedAt,
        }),
      })
    } else {
      await updateDoc(patientRef, {
        audio: arrayUnion({
          file_name: upload.fileName,
          mime_type: upload.mimeType,
          storage_uri: url,
          uploaded_at: uploadedAt,
        }),
      })
    }

    await removeUpload(upload.id)
  }
}
