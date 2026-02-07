"use client"

import Dexie, { type EntityTable } from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { useCallback } from "react"

// Define database schema types
export interface DBPatient {
  id: string
  name: string
  nameHi: string
  age: number
  gender: "male" | "female" | "other"
  phone: string
  address: string
  addressHi: string
  pincode: string
  aadhar?: string
  riskScore: number
  riskLevel: "high" | "medium" | "low"
  status: "awaitingDoctor" | "testPending" | "underTreatment" | "cleared"
  distanceToPHC: number
  needsSync: boolean
  testScheduled: boolean
  weight?: number
  height?: number
  coughDuration?: number
  coughNature?: "dry" | "wet" | "bloodStained"
  feverHistory?: "none" | "lowGrade" | "highGrade"
  physicalSigns?: string[]
  riskFactors?: string[]
  otherObservations?: string
  hearAudioScore?: number
  medGemmaReasoning?: string
  createdAt: string
  collectionDate: string
  scheduledTestDate?: string
  latitude?: number
  longitude?: number
}

export interface DBScreening {
  id?: number
  patientId: string
  ashaWorkerId: string
  name: string
  age: number
  gender: "male" | "female" | "other"
  phone: string
  address: string
  pincode: string
  aadhar?: string
  weight: number
  height: number
  coughDuration: number
  coughNature: "dry" | "wet" | "bloodStained"
  feverHistory: "none" | "lowGrade" | "highGrade"
  physicalSigns: string[]
  riskFactors: string[]
  otherObservations: string
  audioBlob1?: Blob
  audioBlob2?: Blob
  audioBlob3?: Blob
  submittedAt: string
  collectionDate: string
  isOffline: boolean
  needsSync: boolean
  latitude?: number
  longitude?: number
}

// Create database class
class TBTriageDB extends Dexie {
  patients!: EntityTable<DBPatient, "id">
  screenings!: EntityTable<DBScreening, "id">

  constructor() {
    super("TBTriageDB")
    
    this.version(1).stores({
      patients: "id, name, riskLevel, status, needsSync, collectionDate, createdAt",
      screenings: "++id, patientId, ashaWorkerId, needsSync, collectionDate, submittedAt",
    })
  }
}

// Singleton database instance
const db = new TBTriageDB()

// Custom hook for offline storage operations
export function useOfflineStorage() {
  // Get all patients with live updates
  const patients = useLiveQuery(
    async () => {
      return await db.patients.orderBy("collectionDate").reverse().toArray()
    },
    [],
    []
  )

  // Get all screenings with live updates
  const screenings = useLiveQuery(
    async () => {
      return await db.screenings.orderBy("collectionDate").reverse().toArray()
    },
    [],
    []
  )

  // Get patients needing sync
  const patientsNeedingSync = useLiveQuery(
    async () => {
      return await db.patients.where("needsSync").equals(1).toArray()
    },
    [],
    []
  )

  // Save a new patient
  const savePatient = useCallback(async (patient: DBPatient): Promise<void> => {
    await db.patients.put(patient)
  }, [])

  // Save a new screening with audio blobs
  const saveScreening = useCallback(async (screening: DBScreening): Promise<number> => {
    const id = await db.screenings.add(screening)
    return id as number
  }, [])

  // Update patient sync status
  const markPatientSynced = useCallback(async (patientId: string): Promise<void> => {
    await db.patients.update(patientId, { needsSync: false })
  }, [])

  // Update screening sync status
  const markScreeningSynced = useCallback(async (screeningId: number): Promise<void> => {
    await db.screenings.update(screeningId, { needsSync: false })
  }, [])

  // Get patient by ID
  const getPatient = useCallback(async (patientId: string): Promise<DBPatient | undefined> => {
    return await db.patients.get(patientId)
  }, [])

  // Get screening by ID
  const getScreening = useCallback(async (screeningId: number): Promise<DBScreening | undefined> => {
    return await db.screenings.get(screeningId)
  }, [])

  // Get patients filtered by date
  const getPatientsByDate = useCallback(async (date: string): Promise<DBPatient[]> => {
    return await db.patients.where("collectionDate").equals(date).toArray()
  }, [])

  // Get patients in date range
  const getPatientsByDateRange = useCallback(async (startDate: string, endDate: string): Promise<DBPatient[]> => {
    return await db.patients
      .where("collectionDate")
      .between(startDate, endDate, true, true)
      .toArray()
  }, [])

  // Delete a patient
  const deletePatient = useCallback(async (patientId: string): Promise<void> => {
    await db.patients.delete(patientId)
    // Also delete related screenings
    await db.screenings.where("patientId").equals(patientId).delete()
  }, [])

  // Get all screenings for a patient
  const getPatientScreenings = useCallback(async (patientId: string): Promise<DBScreening[]> => {
    return await db.screenings.where("patientId").equals(patientId).toArray()
  }, [])

  // Bulk save patients (for initial data load)
  const bulkSavePatients = useCallback(async (patientsList: DBPatient[]): Promise<void> => {
    await db.patients.bulkPut(patientsList)
  }, [])

  // Clear all data (for logout/reset)
  const clearAllData = useCallback(async (): Promise<void> => {
    await db.patients.clear()
    await db.screenings.clear()
  }, [])

  // Get sync stats
  const getSyncStats = useCallback(async () => {
    const unsyncedPatients = await db.patients.where("needsSync").equals(1).count()
    const unsyncedScreenings = await db.screenings.where("needsSync").equals(1).count()
    return {
      unsyncedPatients,
      unsyncedScreenings,
      totalUnsynced: unsyncedPatients + unsyncedScreenings,
    }
  }, [])

  return {
    // Data
    patients: patients ?? [],
    screenings: screenings ?? [],
    patientsNeedingSync: patientsNeedingSync ?? [],
    
    // Patient operations
    savePatient,
    getPatient,
    deletePatient,
    markPatientSynced,
    getPatientsByDate,
    getPatientsByDateRange,
    bulkSavePatients,
    
    // Screening operations
    saveScreening,
    getScreening,
    markScreeningSynced,
    getPatientScreenings,
    
    // Utility operations
    clearAllData,
    getSyncStats,
    
    // Database instance (for advanced operations)
    db,
  }
}

// Export database for direct access if needed
export { db }
