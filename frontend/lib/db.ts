import Dexie, { type Table } from "dexie"
import type { Patient } from "./mockData"

export interface PatientRecord extends Patient {}

export interface UploadRecord {
  id: string
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

export async function seedPatientsIfEmpty(patients: PatientRecord[]) {
  const count = await db.patients.count()
  if (count === 0) {
    await db.patients.bulkAdd(patients)
  }
}

export async function savePatients(patients: PatientRecord[]) {
  await db.patients.clear()
  await db.patients.bulkAdd(patients)
}

export async function upsertPatient(patient: PatientRecord) {
  await db.patients.put(patient)
}

export async function addUpload(upload: UploadRecord) {
  await db.uploads.put(upload)
}

export async function assignPendingUploadsToPatient(patientId: string) {
  const pending = await db.uploads.where("patientId").equals("pending").toArray()
  await Promise.all(
    pending.map((upload) => db.uploads.put({ ...upload, patientId }))
  )
}

export async function getPendingUploads() {
  return db.uploads.toArray()
}

export async function removeUpload(id: string) {
  await db.uploads.delete(id)
}

export async function getPendingUploadCount() {
  return db.uploads.count()
}

export { db }
