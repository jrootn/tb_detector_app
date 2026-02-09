import { getAllPatients, savePatients } from "@/lib/db"
import type { Patient } from "@/lib/mockData"
import { auth } from "@/lib/firebase"

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
    if (pending.length === 0) return

    const records = pending.map((p) => mapPatientToSyncRecord(p, currentUser.uid))

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

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sync:complete"))
    }
  } catch (error) {
    console.error("Sync failed", error)
  }
}
