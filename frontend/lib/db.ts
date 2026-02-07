import Dexie, { type Table } from "dexie"
import type { Patient } from "./mockData"

export interface PatientRecord extends Patient {}

class AppDatabase extends Dexie {
  patients!: Table<PatientRecord, string>

  constructor() {
    super("tbTriageDb")
    this.version(1).stores({
      patients: "id,riskLevel,createdAt,collectionDate",
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

export { db }
