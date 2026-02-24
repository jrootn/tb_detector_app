import Dexie, { type Table } from "dexie"
import type { Patient } from "./mockData"

export interface PatientRecord extends Patient {}

export interface UploadRecord {
  id: string
  ownerUid?: string
  patientId: string
  role: "ASHA" | "DOCTOR" | "LAB_TECH"
  kind: "audio" | "image" | "report"
  fileName: string
  mimeType: string
  blob: Blob
  createdAt: string
}

class AppDatabase extends Dexie {
  patients!: Table<PatientRecord, string>
  uploads!: Table<UploadRecord, string>

  constructor() {
    super("tbTriageDb")
    this.version(1).stores({
      patients: "id,riskLevel,createdAt,collectionDate",
    })
    this.version(2).stores({
      patients: "id,riskLevel,createdAt,collectionDate",
      uploads: "id,patientId,role,kind,createdAt",
    })
    this.version(3).stores({
      patients: "id,ashaId,needsSync,riskLevel,createdAt,collectionDate",
      uploads: "id,ownerUid,patientId,role,kind,createdAt",
    })
  }
}

const db = new AppDatabase()

export async function getAllPatients() {
  return db.patients.toArray()
}

export async function getPatientsForAsha(ashaId?: string) {
  const all = await db.patients.toArray()
  if (!ashaId) return all
  // Strict user scoping avoids cross-account leakage from legacy local records.
  return all.filter((patient) => patient.ashaId === ashaId)
}

export async function seedPatientsIfEmpty(patients: PatientRecord[]) {
  const count = await db.patients.count()
  if (count === 0) {
    await db.patients.bulkPut(patients)
  }
}

export async function savePatients(patients: PatientRecord[]) {
  if (patients.length === 0) return
  await db.patients.bulkPut(patients)
}

export async function upsertPatient(patient: PatientRecord) {
  await db.patients.put(patient)
}

export async function addUpload(upload: UploadRecord) {
  await db.uploads.put(upload)
}

export async function replacePendingAshaAudioUpload(ownerUid: string, upload: UploadRecord) {
  await db.transaction("rw", db.uploads, async () => {
    const stale = await db.uploads.where("ownerUid").equals(ownerUid).toArray()
    const staleIds = stale
      .filter((entry) => entry.patientId === "pending" && entry.role === "ASHA" && entry.kind === "audio")
      .map((entry) => entry.id)

    if (staleIds.length > 0) {
      await Promise.all(staleIds.map((id) => db.uploads.delete(id)))
    }

    await db.uploads.put(upload)
  })
}

export async function assignPendingUploadsToPatient(patientId: string, ownerUid?: string) {
  const pending = await db.uploads.where("patientId").equals("pending").toArray()
  const scoped = ownerUid ? pending.filter((upload) => upload.ownerUid === ownerUid) : pending
  await Promise.all(
    scoped.map((upload) => db.uploads.put({ ...upload, patientId }))
  )
}

export async function getPendingUploads(ownerUid?: string) {
  const all = await db.uploads.toArray()
  if (!ownerUid) return all
  return all.filter((upload) => upload.ownerUid === ownerUid)
}

export async function cleanupOrphanUploads(ownerUid?: string) {
  const uploads = await getPendingUploads(ownerUid)
  const validPatientIds = new Set((await db.patients.toArray()).map((patient) => patient.id))
  const orphanIds = uploads
    .filter((upload) => upload.patientId !== "pending" && !validPatientIds.has(upload.patientId))
    .map((upload) => upload.id)

  if (orphanIds.length > 0) {
    await Promise.all(orphanIds.map((id) => db.uploads.delete(id)))
  }
}

export async function removeUpload(id: string) {
  await db.uploads.delete(id)
}

export async function getPendingUploadCount(ownerUid?: string) {
  await cleanupOrphanUploads(ownerUid)
  const uploads = await getPendingUploads(ownerUid)
  return uploads.filter((upload) => upload.patientId !== "pending").length
}

export async function cleanupLegacyMockPatients() {
  const all = await db.patients.toArray()
  const legacyIds = all
    .map((patient) => patient.id)
    .filter((id) => /^P\d{3}$/.test(id))

  if (legacyIds.length === 0) return 0

  await db.transaction("rw", db.patients, db.uploads, async () => {
    const legacySet = new Set(legacyIds)
    await Promise.all(legacyIds.map((id) => db.patients.delete(id)))
    const uploads = await db.uploads.toArray()
    const uploadIds = uploads.filter((upload) => legacySet.has(upload.patientId)).map((upload) => upload.id)
    await Promise.all(uploadIds.map((id) => db.uploads.delete(id)))
  })

  return legacyIds.length
}

export { db }
