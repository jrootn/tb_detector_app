import { db as localDb, cleanupOrphanUploads, getPatientsForAsha, savePatients, getPendingUploads, removeUpload } from "@/lib/db"
import type { Patient } from "@/lib/mockData"
import { auth, db, storage } from "@/lib/firebase"
import { normalizeAiRiskScore } from "@/lib/ai"
import { doc, updateDoc, arrayUnion, setDoc, getDoc, collection, getDocs, query, where } from "firebase/firestore"
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

function hasRemoteAudio(data: Record<string, unknown>): boolean {
  const audio = data.audio
  if (!Array.isArray(audio)) return false
  return audio.some((entry) => {
    if (!entry || typeof entry !== "object") return false
    const map = entry as Record<string, unknown>
    return (
      typeof map.storage_path === "string" ||
      typeof map.storage_uri === "string" ||
      typeof map.url === "string"
    )
  })
}

async function cleanupSyncedAshaAudioUploads(userId: string): Promise<void> {
  const uploads = (await getPendingUploads(userId)).filter(
    (upload) => upload.role === "ASHA" && upload.kind === "audio" && upload.patientId !== "pending"
  )
  if (uploads.length === 0) return

  const uniquePatientIds = Array.from(new Set(uploads.map((upload) => upload.patientId)))
  const syncedPatientIds = new Set<string>()

  await Promise.all(
    uniquePatientIds.map(async (patientId) => {
      try {
        const snap = await getDoc(doc(db, "patients", patientId))
        if (!snap.exists()) return
        const data = (snap.data() || {}) as Record<string, unknown>
        if (hasRemoteAudio(data)) {
          syncedPatientIds.add(patientId)
        }
      } catch {
        // Ignore lookup failures; regular sync retries will continue to handle these uploads.
      }
    })
  )

  if (syncedPatientIds.size === 0) return

  await Promise.all(
    uploads
      .filter((upload) => syncedPatientIds.has(upload.patientId))
      .map((upload) => removeUpload(upload.id))
  )
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

function mapStatusFromApi(status?: string): Patient["status"] {
  switch ((status || "").toUpperCase()) {
    case "ASHA_ACTION_IN_PROGRESS":
      return "underTreatment"
    case "CLOSED":
      return "cleared"
    case "DOCTOR_FINALIZED":
    case "LAB_DONE":
      return "testPending"
    default:
      return "awaitingDoctor"
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

function mapCoughNatureFromApi(value?: string): Patient["coughNature"] | undefined {
  switch ((value || "").toUpperCase()) {
    case "DRY":
      return "dry"
    case "WET":
      return "wet"
    case "BLOOD_STAINED":
      return "bloodStained"
    default:
      return undefined
  }
}

function mapFeverFromApi(value?: string): Patient["feverHistory"] | undefined {
  switch ((value || "").toUpperCase()) {
    case "NONE":
      return "none"
    case "LOW_GRADE":
      return "lowGrade"
    case "HIGH_GRADE":
      return "highGrade"
    default:
      return undefined
  }
}

function mapRiskAnswerFromApi(value?: string): Patient["nightSweats"] | undefined {
  switch ((value || "").toUpperCase()) {
    case "YES":
      return "yes"
    case "NO":
      return "no"
    case "PREFER_NOT_TO_SAY":
      return "preferNotToSay"
    case "DONT_KNOW":
      return "dontKnow"
    default:
      return undefined
  }
}

function normalizeRiskFactorKey(raw: string): string {
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  if (normalized === "historytb" || normalized === "historyoftb") return "historyOfTB"
  if (normalized === "familytb" || normalized === "familymemberhastb") return "familyMemberHasTB"
  if (normalized === "diabetes") return "diabetes"
  if (normalized === "smoker") return "smoker"
  if (normalized === "historyofcovid" || normalized === "covid" || normalized === "covid19") return "historyOfCovid"
  if (normalized === "historyofhiv" || normalized === "hiv" || normalized === "aids") return "historyOfHIV"
  if (normalized === "nightsweats") return "nightSweats"
  if (normalized === "weightloss") return "weightLoss"
  return raw
}

function normalizePhysicalSign(raw: string): string {
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  if (normalized === "chestpain") return "chestPain"
  if (normalized === "shortnessofbreath") return "shortnessOfBreath"
  if (normalized === "lossofappetite") return "lossOfAppetite"
  if (normalized === "extremefatigue") return "extremeFatigue"
  return raw
}

function toDateOnly(value?: string): string {
  if (!value) return new Date().toISOString().split("T")[0]
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().split("T")[0]
  }
  return value.split("T")[0]
}

function toIsoTimestamp(value?: string): string {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString()
  }
  return value
}

function parseLocalizedSummary(ai: Record<string, unknown>): { en?: string; hi?: string } {
  const result: { en?: string; hi?: string } = {}
  const direct = ai.medgemini_summary
  const nested = ai.medgemini_summary_i18n
  if (typeof direct === "string") {
    result.en = direct
  } else if (direct && typeof direct === "object") {
    const map = direct as Record<string, unknown>
    if (typeof map.en === "string") result.en = map.en
    if (typeof map.hi === "string") result.hi = map.hi
  }
  if (typeof ai.medgemini_summary_en === "string") result.en = ai.medgemini_summary_en
  if (typeof ai.medgemini_summary_hi === "string") result.hi = ai.medgemini_summary_hi
  if (nested && typeof nested === "object") {
    const map = nested as Record<string, unknown>
    if (typeof map.en === "string") result.en = map.en
    if (typeof map.hi === "string") result.hi = map.hi
  }
  return result
}

function parseLocalizedActions(ai: Record<string, unknown>): { en?: string[]; hi?: string[] } {
  const result: { en?: string[]; hi?: string[] } = {}
  const direct = ai.action_items_i18n

  const normalizeList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const items = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
    return items.length > 0 ? items : undefined
  }

  if (direct && typeof direct === "object") {
    const map = direct as Record<string, unknown>
    result.en = normalizeList(map.en) || result.en
    result.hi = normalizeList(map.hi) || result.hi
  }

  result.en = normalizeList(ai.action_items_en) || result.en
  result.hi = normalizeList(ai.action_items_hi) || result.hi
  return result
}

function mapRiskAnswerToApi(value?: Patient["nightSweats"]): string | null {
  switch (value) {
    case "yes":
      return "YES"
    case "no":
      return "NO"
    case "dontKnow":
      return "DONT_KNOW"
    case "preferNotToSay":
      return "PREFER_NOT_TO_SAY"
    default:
      return null
  }
}

function toCelsius(value?: number, unit?: Patient["bodyTemperatureUnit"]): number | null {
  if (value == null || Number.isNaN(value)) return null
  const celsius = unit === "F" ? (value - 32) * (5 / 9) : value
  return Math.round(celsius * 10) / 10
}

function buildSymptomList(patient: Patient) {
  const symptoms: Array<{ symptom_code: string; severity: null; duration_days: number | null }> = []
  if (patient.coughDuration && patient.coughDuration > 0) {
    symptoms.push({ symptom_code: "COUGH", severity: null, duration_days: patient.coughDuration })
  }
  if (patient.feverHistory === "highGrade") {
    symptoms.push({ symptom_code: "FEVER_HIGH", severity: null, duration_days: null })
  }
  if (patient.nightSweats === "yes" || patient.riskFactorAnswers?.nightSweats === "yes") {
    symptoms.push({ symptom_code: "NIGHT_SWEATS", severity: null, duration_days: null })
  }
  if (patient.weightLoss === "yes" || patient.riskFactorAnswers?.weightLoss === "yes") {
    symptoms.push({ symptom_code: "WEIGHT_LOSS", severity: null, duration_days: null })
  }
  if (patient.physicalSigns?.includes("chestPain")) {
    symptoms.push({ symptom_code: "CHEST_PAIN", severity: null, duration_days: null })
  }
  return symptoms
}

function mapPatientToSyncRecord(patient: Patient, ashaWorkerId: string, assignment?: AssignmentContext) {
  const collectedAt = patient.collectedAt || patient.createdAt
  return {
    patient_local_id: patient.id,
    device_id: "web-app",
    asha_worker_id: ashaWorkerId,
    asha_id: ashaWorkerId,
    created_at_offline: collectedAt,
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
    symptoms: buildSymptomList(patient),
    clinical: {
      cough_duration_days: patient.coughDuration || null,
      cough_nature: mapCoughNatureToApi(patient.coughNature),
      fever_history: mapFeverToApi(patient.feverHistory),
      night_sweats: mapRiskAnswerToApi(patient.nightSweats || patient.riskFactorAnswers?.nightSweats),
      weight_loss: mapRiskAnswerToApi(patient.weightLoss || patient.riskFactorAnswers?.weightLoss),
      heart_rate_bpm: patient.heartRateBpm || null,
      body_temperature_c: toCelsius(patient.bodyTemperature, patient.bodyTemperatureUnit),
      body_temperature_source_unit: patient.bodyTemperatureUnit || null,
      physical_signs: patient.physicalSigns || [],
      risk_factors: patient.riskFactors || [],
      risk_factor_answers: patient.riskFactorAnswers || {},
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
    asha_name: assignment?.ashaName || patient.ashaName || null,
    asha_phone_number: assignment?.ashaPhone || patient.ashaPhone || null,
  }
}

function buildDirectFirestorePayload(patient: Patient, ashaWorkerId: string, assignment?: AssignmentContext) {
  const collectedAt = patient.collectedAt || patient.createdAt
  return {
    patient_local_id: patient.id,
    device_id: "web-app",
    asha_worker_id: ashaWorkerId,
    asha_id: ashaWorkerId,
    created_at_offline: collectedAt,
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
    symptoms: buildSymptomList(patient),
    clinical: {
      cough_duration_days: patient.coughDuration || null,
      cough_nature: mapCoughNatureToApi(patient.coughNature),
      fever_history: mapFeverToApi(patient.feverHistory),
      night_sweats: mapRiskAnswerToApi(patient.nightSweats || patient.riskFactorAnswers?.nightSweats),
      weight_loss: mapRiskAnswerToApi(patient.weightLoss || patient.riskFactorAnswers?.weightLoss),
      heart_rate_bpm: patient.heartRateBpm || null,
      body_temperature_c: toCelsius(patient.bodyTemperature, patient.bodyTemperatureUnit),
      body_temperature_source_unit: patient.bodyTemperatureUnit || null,
      physical_signs: patient.physicalSigns || [],
      risk_factors: patient.riskFactors || [],
      risk_factor_answers: patient.riskFactorAnswers || {},
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
    asha_name: assignment?.ashaName || patient.ashaName || null,
    asha_phone_number: assignment?.ashaPhone || patient.ashaPhone || null,
  }
}

function mapFirestorePatientToLocal(
  patientId: string,
  data: Record<string, unknown>,
  existing?: Patient
): Patient {
  const demographics = (data.demographics || {}) as Record<string, unknown>
  const vitals = (data.vitals || {}) as Record<string, unknown>
  const clinical = (data.clinical || {}) as Record<string, unknown>
  const ai = (data.ai || {}) as Record<string, unknown>
  const gps = (data.gps || {}) as Record<string, unknown>
  const status = (data.status || {}) as Record<string, unknown>

  const localizedSummary = parseLocalizedSummary(ai)
  const localizedActions = parseLocalizedActions(ai)
  const hasAiRiskScore = typeof ai.risk_score === "number" || Number.isFinite(Number(ai.risk_score))
  const riskScore = hasAiRiskScore ? normalizeAiRiskScore(ai.risk_score, 0) : 0
  const riskLevelRaw = typeof ai.risk_level === "string" ? ai.risk_level.toUpperCase() : ""
  const inferenceStatusRaw = typeof ai.inference_status === "string" ? ai.inference_status.toUpperCase() : ""
  const summaryEn = localizedSummary.en || existing?.medGemmaReasoning
  const summaryHi = localizedSummary.hi || existing?.medGemmaReasoningI18n?.hi
  const hasAnyAiOutput = hasAiRiskScore || typeof ai.hear_score === "number" || Boolean(summaryEn || summaryHi)
  const aiStatus: Patient["aiStatus"] =
    inferenceStatusRaw === "FAILED"
      ? "failed"
      : inferenceStatusRaw === "SUCCESS" || inferenceStatusRaw === "COMPLETED" || hasAnyAiOutput
      ? "success"
      : "pending"
  const riskLevel: Patient["riskLevel"] =
    riskLevelRaw === "HIGH"
      ? "high"
      : riskLevelRaw === "MEDIUM"
      ? "medium"
      : riskLevelRaw === "LOW"
      ? "low"
      : aiStatus === "success"
      ? riskScore >= 7
        ? "high"
        : riskScore >= 4
        ? "medium"
        : "low"
      : "low"
  const collectedAtSource =
    typeof data.created_at_offline === "string"
      ? data.created_at_offline
      : typeof existing?.collectedAt === "string"
      ? existing.collectedAt
      : existing?.createdAt

  const rawRiskAnswers = (clinical.risk_factor_answers || {}) as Record<string, unknown>
  const riskFactorAnswers: NonNullable<Patient["riskFactorAnswers"]> = {}
  Object.entries(rawRiskAnswers).forEach(([key, value]) => {
    const normalizedKey = normalizeRiskFactorKey(key)
    const answer = mapRiskAnswerFromApi(typeof value === "string" ? value : undefined)
    if (answer) riskFactorAnswers[normalizedKey] = answer
  })

  const rawRiskFactors = Array.isArray(clinical.risk_factors) ? clinical.risk_factors : []
  const riskFactors = rawRiskFactors
    .filter((factor): factor is string => typeof factor === "string")
    .map((factor) => normalizeRiskFactorKey(factor))

  const rawPhysicalSigns = Array.isArray(clinical.physical_signs) ? clinical.physical_signs : []
  const physicalSigns = rawPhysicalSigns
    .filter((sign): sign is string => typeof sign === "string")
    .map((sign) => normalizePhysicalSign(sign))

  return {
    id: patientId,
    ashaId:
      typeof data.asha_id === "string"
        ? data.asha_id
        : typeof data.asha_worker_id === "string"
        ? data.asha_worker_id
        : existing?.ashaId,
    ashaName: typeof data.asha_name === "string" ? data.asha_name : existing?.ashaName,
    ashaPhone: typeof data.asha_phone_number === "string" ? data.asha_phone_number : existing?.ashaPhone,
    name: typeof demographics.name === "string" ? demographics.name : existing?.name || "Unknown",
    nameHi: existing?.nameHi || (typeof demographics.name === "string" ? demographics.name : existing?.name || "Unknown"),
    age: typeof demographics.age === "number" ? demographics.age : existing?.age || 0,
    gender:
      demographics.gender === "male" || demographics.gender === "female" || demographics.gender === "other"
        ? demographics.gender
        : existing?.gender || "other",
    phone: typeof demographics.phone === "string" ? demographics.phone : existing?.phone || "",
    address: typeof demographics.address === "string" ? demographics.address : existing?.address || "",
    addressHi: existing?.addressHi || (typeof demographics.address === "string" ? demographics.address : existing?.address || ""),
    pincode: typeof demographics.pincode === "string" ? demographics.pincode : existing?.pincode || "",
    village: typeof demographics.village === "string" ? demographics.village : existing?.village || "",
    villageHi: existing?.villageHi || (typeof demographics.village === "string" ? demographics.village : existing?.village || ""),
    riskScore: Number(riskScore),
    riskLevel,
    aiStatus,
    status: mapStatusFromApi(typeof status.triage_status === "string" ? status.triage_status : undefined),
    distanceToPHC: existing?.distanceToPHC || 0,
    needsSync: false,
    testScheduled: Boolean(status.test_scheduled_date),
    weight: typeof vitals.weight_kg === "number" ? vitals.weight_kg : existing?.weight,
    height: typeof vitals.height_cm === "number" ? vitals.height_cm : existing?.height,
    heartRateBpm: typeof clinical.heart_rate_bpm === "number" ? clinical.heart_rate_bpm : existing?.heartRateBpm,
    bodyTemperature: typeof clinical.body_temperature_c === "number" ? clinical.body_temperature_c : existing?.bodyTemperature,
    bodyTemperatureUnit: "C",
    coughDuration: typeof clinical.cough_duration_days === "number" ? clinical.cough_duration_days : existing?.coughDuration,
    coughNature: mapCoughNatureFromApi(typeof clinical.cough_nature === "string" ? clinical.cough_nature : undefined) || existing?.coughNature,
    feverHistory: mapFeverFromApi(typeof clinical.fever_history === "string" ? clinical.fever_history : undefined) || existing?.feverHistory,
    nightSweats:
      mapRiskAnswerFromApi(typeof clinical.night_sweats === "string" ? clinical.night_sweats : undefined) ||
      riskFactorAnswers.nightSweats ||
      existing?.nightSweats,
    weightLoss:
      mapRiskAnswerFromApi(typeof clinical.weight_loss === "string" ? clinical.weight_loss : undefined) ||
      riskFactorAnswers.weightLoss ||
      existing?.weightLoss,
    physicalSigns: physicalSigns.length > 0 ? physicalSigns : existing?.physicalSigns,
    riskFactors: riskFactors.length > 0 ? riskFactors : existing?.riskFactors,
    riskFactorAnswers: Object.keys(riskFactorAnswers).length > 0 ? riskFactorAnswers : existing?.riskFactorAnswers,
    otherObservations:
      typeof clinical.other_observations === "string"
        ? clinical.other_observations
        : existing?.otherObservations,
    hearAudioScore: typeof ai.hear_score === "number" ? ai.hear_score : existing?.hearAudioScore,
    medGemmaReasoning: summaryEn,
    medGemmaReasoningI18n: summaryEn || summaryHi ? { en: summaryEn, hi: summaryHi } : existing?.medGemmaReasoningI18n,
    aiActionItemsI18n:
      localizedActions.en || localizedActions.hi
        ? { en: localizedActions.en, hi: localizedActions.hi }
        : existing?.aiActionItemsI18n,
    doctorInstructions: typeof data.doctor_instructions === "string" ? data.doctor_instructions : existing?.doctorInstructions,
    createdAt: toIsoTimestamp(collectedAtSource),
    collectedAt: toIsoTimestamp(collectedAtSource),
    collectionDate: toDateOnly(collectedAtSource),
    scheduledTestDate: typeof status.test_scheduled_date === "string" ? status.test_scheduled_date : existing?.scheduledTestDate,
    sampleId: typeof data.sample_id === "string" ? data.sample_id : existing?.sampleId,
    latitude: typeof gps.lat === "number" ? gps.lat : existing?.latitude,
    longitude: typeof gps.lng === "number" ? gps.lng : existing?.longitude,
    aadhar: existing?.aadhar,
  }
}

async function refreshLocalPatientsFromFirestore(
  ashaWorkerId: string,
  localPatients: Patient[]
): Promise<Patient[] | null> {
  try {
    const localForAsha = localPatients.filter((p) => !p.ashaId || p.ashaId === ashaWorkerId)
    const pendingUploadPatientIds = new Set(
      (await getPendingUploads(ashaWorkerId))
        .filter((upload) => upload.patientId !== "pending")
        .map((upload) => upload.patientId)
    )
    const existingById = new Map(localForAsha.map((p) => [p.id, p]))
    const [snapByAshaId, snapByWorkerId] = await Promise.all([
      getDocs(query(collection(db, "patients"), where("asha_id", "==", ashaWorkerId))),
      getDocs(query(collection(db, "patients"), where("asha_worker_id", "==", ashaWorkerId))),
    ])

    const mergedDocs = [...snapByAshaId.docs, ...snapByWorkerId.docs]
    if (mergedDocs.length === 0) return null

    const uniqueDocs = Array.from(new Map(mergedDocs.map((docSnap) => [docSnap.id, docSnap])).values())

    const remote = uniqueDocs.map((docSnap) =>
      mapFirestorePatientToLocal(docSnap.id, docSnap.data() as Record<string, unknown>, existingById.get(docSnap.id))
    )
    const remoteIds = new Set(remote.map((p) => p.id))
    // Preserve only recent or truly pending local-only records.
    // This avoids keeping stale legacy/demo rows forever in ASHA dashboards.
    const now = Date.now()
    const localMissingRemote = localForAsha.filter((p) => {
      if (remoteIds.has(p.id)) return false
      const ts = new Date(p.collectionDate || p.createdAt).getTime()
      if (Number.isNaN(ts)) return false
      const recent = now - ts < 3 * 24 * 60 * 60 * 1000
      if (p.needsSync && pendingUploadPatientIds.has(p.id)) return true
      return recent
    })
    const merged = [...remote, ...localMissingRemote]
    merged.sort((a, b) => {
      const aTime = new Date(a.collectionDate || a.createdAt).getTime()
      const bTime = new Date(b.collectionDate || b.createdAt).getTime()
      return bTime - aTime
    })
    return merged
  } catch (error) {
    console.warn("Could not refresh patients from Firestore", error)
    return null
  }
}

export async function hydrateAshaPatientsFromCloud(ashaWorkerId: string): Promise<Patient[]> {
  const local = await getPatientsForAsha(ashaWorkerId)
  const refreshed = await refreshLocalPatientsFromFirestore(ashaWorkerId, local)
  if (refreshed && refreshed.length > 0) {
    await savePatients(refreshed)
    return refreshed
  }
  return local
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
      assigned_doctor_id?: string
      assigned_lab_tech_id?: string
    }

    result.facilityId = ashaData.facility_id
    result.facilityName = ashaData.facility_name
    result.tuId = ashaData.tu_id
    result.ashaName = ashaData.name
    result.ashaPhone = ashaData.phone
    result.assignedDoctorId = ashaData.assigned_doctor_id
    result.assignedLabTechId = ashaData.assigned_lab_tech_id

    if (typeof window !== "undefined") {
      const doctorKey = `tb_cached_assigned_doctor_id_${ashaWorkerId}`
      const labKey = `tb_cached_assigned_lab_tech_id_${ashaWorkerId}`
      const facilityKey = `tb_cached_facility_id_${ashaWorkerId}`
      const facilityNameKey = `tb_cached_facility_name_${ashaWorkerId}`
      const tuKey = `tb_cached_tu_id_${ashaWorkerId}`

      if (!result.ashaName) {
        const cachedName = localStorage.getItem("user_name")
        if (cachedName) result.ashaName = cachedName
      }

      if (!result.assignedDoctorId) {
        const cachedDoctor = localStorage.getItem(doctorKey)
        if (cachedDoctor) result.assignedDoctorId = cachedDoctor
      }
      if (!result.assignedLabTechId) {
        const cachedLab = localStorage.getItem(labKey)
        if (cachedLab) result.assignedLabTechId = cachedLab
      }
      if (!result.facilityId) {
        const cachedFacility = localStorage.getItem(facilityKey)
        if (cachedFacility) result.facilityId = cachedFacility
      }
      if (!result.facilityName) {
        const cachedFacilityName = localStorage.getItem(facilityNameKey)
        if (cachedFacilityName) result.facilityName = cachedFacilityName
      }
      if (!result.tuId) {
        const cachedTuId = localStorage.getItem(tuKey)
        if (cachedTuId) result.tuId = cachedTuId
      }
    }

    // ASHA cannot read all users in current rules. Reuse assignments from
    // existing ASHA-owned patient docs to keep new records routable.
    if (!result.assignedDoctorId || !result.assignedLabTechId || !result.facilityId || !result.facilityName || !result.tuId) {
      const ownPatients = await getDocs(query(collection(db, "patients"), where("asha_id", "==", ashaWorkerId)))
      for (const patientDoc of ownPatients.docs) {
        const data = patientDoc.data() as Record<string, unknown>
        if (!result.assignedDoctorId && typeof data.assigned_doctor_id === "string") {
          result.assignedDoctorId = data.assigned_doctor_id
        }
        if (!result.assignedLabTechId && typeof data.assigned_lab_tech_id === "string") {
          result.assignedLabTechId = data.assigned_lab_tech_id
        }
        if (!result.facilityId && typeof data.facility_id === "string") {
          result.facilityId = data.facility_id
        }
        if (!result.facilityName && typeof data.facility_name === "string") {
          result.facilityName = data.facility_name
        }
        if (!result.tuId && typeof data.tu_id === "string") {
          result.tuId = data.tu_id
        }
        if (result.assignedDoctorId && result.assignedLabTechId && result.facilityId && result.facilityName && result.tuId) break
      }
    }

    if (typeof window !== "undefined") {
      const doctorKey = `tb_cached_assigned_doctor_id_${ashaWorkerId}`
      const labKey = `tb_cached_assigned_lab_tech_id_${ashaWorkerId}`
      const facilityKey = `tb_cached_facility_id_${ashaWorkerId}`
      const facilityNameKey = `tb_cached_facility_name_${ashaWorkerId}`
      const tuKey = `tb_cached_tu_id_${ashaWorkerId}`
      if (result.assignedDoctorId) localStorage.setItem(doctorKey, result.assignedDoctorId)
      if (result.assignedLabTechId) localStorage.setItem(labKey, result.assignedLabTechId)
      if (result.facilityId) localStorage.setItem(facilityKey, result.facilityId)
      if (result.facilityName) localStorage.setItem(facilityNameKey, result.facilityName)
      if (result.tuId) localStorage.setItem(tuKey, result.tuId)
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
    if (options.uploadsOnly) {
      await syncUploads(currentUser.uid)
      await cleanupSyncedAshaAudioUploads(currentUser.uid)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sync:complete"))
      }
      return
    }

    const idToken = await currentUser.getIdToken()
    const assignment = await resolveAssignmentContext(currentUser.uid)
    const patients = await getPatientsForAsha(currentUser.uid)
    const pending = patients.filter((p) => p.needsSync)
    const records = pending.map((p) => mapPatientToSyncRecord(p, currentUser.uid, assignment))
    const syncedIds = new Set<string>()

    if (records.length > 0) {
      let syncedViaBackend = false
      try {
        const aborter = new AbortController()
        const timeout = window.setTimeout(() => aborter.abort(), 6000)
        let res: Response
        try {
          res = await fetch(`${API_BASE}/v1/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            signal: aborter.signal,
            body: JSON.stringify({ records }),
          })
        } finally {
          window.clearTimeout(timeout)
        }

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
    await cleanupSyncedAshaAudioUploads(currentUser.uid)

    const localAfterSync = await getPatientsForAsha(currentUser.uid)
    const refreshed = await refreshLocalPatientsFromFirestore(currentUser.uid, localAfterSync)
    const baselineLocal = refreshed && refreshed.length > 0 ? refreshed : localAfterSync
    if (baselineLocal.length > 0) {
      const pendingUploadIds = new Set(
        (await getPendingUploads(currentUser.uid))
          .filter((upload) => upload.patientId !== "pending")
          .map((upload) => upload.patientId)
      )

      const staleNeedsSync = baselineLocal.filter((patient) => patient.needsSync && !pendingUploadIds.has(patient.id))
      if (staleNeedsSync.length > 0) {
        const existsChecks = await Promise.all(
          staleNeedsSync.map(async (patient) => {
            try {
              const snap = await getDoc(doc(db, "patients", patient.id))
              return [patient.id, snap.exists()] as const
            } catch {
              return [patient.id, false] as const
            }
          })
        )
        const existsRemote = new Set(existsChecks.filter(([, exists]) => exists).map(([id]) => id))
        if (existsRemote.size > 0) {
          await savePatients(
            baselineLocal.map((patient) =>
              existsRemote.has(patient.id) ? { ...patient, needsSync: false } : patient
            )
          )
        } else {
          await savePatients(baselineLocal)
        }
      } else {
        await savePatients(baselineLocal)
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sync:complete"))
      localStorage.setItem("tb_last_sync_at", String(Date.now()))
    }
  } catch (error) {
    console.warn("Sync failed", error)
  }
}

export async function syncUploads(userId: string, options: UploadSyncOptions = {}): Promise<UploadSyncResult> {
  if (!navigator.onLine) return { uploaded: 0, failed: 0, errors: [] }
  await cleanupOrphanUploads(userId)
  const currentRole = (typeof window !== "undefined" ? localStorage.getItem("user_role") : null) as AppRole | null
  const localPatients = await getPatientsForAsha(userId)
  const localById = new Map(localPatients.map((patient) => [patient.id, patient]))
  let assignmentContext: AssignmentContext | null | undefined
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

  const ensureRemotePatient = async (patientId: string): Promise<boolean> => {
    try {
      const patientRef = doc(db, "patients", patientId)
      const snap = await getDoc(patientRef)
      if (snap.exists()) return true

      const localPatient = localById.get(patientId) || (await localDb.patients.get(patientId))
      if (!localPatient) return false

      if (assignmentContext === undefined) {
        assignmentContext = await resolveAssignmentContext(userId)
      }

      const payload = buildDirectFirestorePayload(localPatient, userId, assignmentContext || undefined)
      await setDoc(patientRef, payload, { merge: true })
      return true
    } catch {
      return false
    }
  }

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
      const hasPatientDoc = await ensureRemotePatient(upload.patientId)
      if (!hasPatientDoc) {
        const localFallback = await localDb.patients.get(upload.patientId)
        if (!localFallback) {
          // Local patient no longer exists; drop this orphan upload so pending counters can recover.
          await removeUpload(upload.id)
          continue
        }
        throw new Error("Remote patient record missing; cannot attach upload")
      }
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
        try {
          await updateDoc(patientRef, {
            "lab_results.report_path": path,
            "lab_results.uploaded_at": uploadedAt,
            "lab_results.uploaded_by": userId,
            "lab_results.files": arrayUnion(reportEntry),
            "status.triage_status": "LAB_DONE",
          })
        } catch (error) {
          if ((error instanceof Error && error.message.includes("No document to update")) || getErrorCode(error) === "not-found") {
            const created = await ensureRemotePatient(upload.patientId)
            if (created) {
              await updateDoc(patientRef, {
                "lab_results.report_path": path,
                "lab_results.uploaded_at": uploadedAt,
                "lab_results.uploaded_by": userId,
                "lab_results.files": arrayUnion(reportEntry),
                "status.triage_status": "LAB_DONE",
              })
            } else {
              throw error
            }
          } else {
            throw error
          }
        }
      } else if (upload.role === "DOCTOR" && upload.kind === "report") {
        const fileEntry: Record<string, unknown> = {
          name: upload.fileName,
          storage_path: path,
          mime_type: contentType,
          uploaded_at: uploadedAt,
        }
        try {
          await updateDoc(patientRef, {
            doctor_files: arrayUnion(fileEntry),
          })
        } catch (error) {
          if ((error instanceof Error && error.message.includes("No document to update")) || getErrorCode(error) === "not-found") {
            const created = await ensureRemotePatient(upload.patientId)
            if (created) {
              await updateDoc(patientRef, {
                doctor_files: arrayUnion(fileEntry),
              })
            } else {
              throw error
            }
          } else {
            throw error
          }
        }
      } else {
        const audioEntry: Record<string, unknown> = {
          file_name: upload.fileName,
          mime_type: contentType,
          storage_path: path,
          uploaded_at: uploadedAt,
        }
        try {
          await updateDoc(patientRef, {
            audio: arrayUnion(audioEntry),
          })
        } catch (error) {
          if ((error instanceof Error && error.message.includes("No document to update")) || getErrorCode(error) === "not-found") {
            const created = await ensureRemotePatient(upload.patientId)
            if (created) {
              await updateDoc(patientRef, {
                audio: arrayUnion(audioEntry),
              })
            } else {
              throw error
            }
          } else {
            throw error
          }
        }
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
