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
  }
}

const db = new AppDatabase()

export async function getAllPatients() {
  return db.patients.toArray()
}

export async function getPatientsForAsha(ashaId?: string) {
  const all = await db.patients.toArray()
  if (!ashaId) return all
  return all.filter((patient) => !patient.ashaId || patient.ashaId === ashaId)
}

export async function seedPatientsIfEmpty(patients: PatientRecord[]) {
  const count = await db.patients.count()
  if (count === 0) {
    await db.patients.bulkPut(patients)
  }
}

export async function savePatients(patients: PatientRecord[]) {
  await db.transaction("rw", db.patients, async () => {
    await db.patients.clear()
    await db.patients.bulkPut(patients)
  })
}

export async function upsertPatient(patient: PatientRecord) {
  await db.patients.put(patient)
}

export async function addUpload(upload: UploadRecord) {
  await db.uploads.put(upload)
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

export async function removeUpload(id: string) {
  await db.uploads.delete(id)
}

export async function getPendingUploadCount(ownerUid?: string) {
  const uploads = await getPendingUploads(ownerUid)
  return uploads.length
}

export { db }
