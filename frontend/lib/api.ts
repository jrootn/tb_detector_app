import type { Patient, RiskFactorAnswer } from "./mockData"

export interface ScreeningData {
  // Identity
  name: string
  age: number
  gender: "male" | "female" | "other"
  phone: string
  villageName: string
  aadhar?: string

  // Vitals
  weight: number
  height: number

  // Clinical Questionnaire
  coughDuration: number
  coughNature: "dry" | "wet" | "bloodStained"
  feverHistory: "none" | "lowGrade" | "highGrade"
  nightSweats?: RiskFactorAnswer
  weightLoss?: RiskFactorAnswer
  physicalSigns: string[]
  riskFactors: string[]
  riskFactorAnswers?: Record<string, RiskFactorAnswer>
  otherObservations: string

  // Audio recordings (simulated)
  audioRecordings: {
    slot1: boolean
    slot2: boolean
    slot3: boolean
  }

  // Metadata
  submittedAt: string
  ashaWorkerId: string
  isOffline: boolean
  heartRateBpm?: number
  bodyTemperature?: number
  bodyTemperatureUnit?: "C" | "F"
}

export function submitScreening(data: ScreeningData): Promise<{ success: boolean; patientId: string }> {
  return new Promise((resolve) => {
    // Log the complete JSON payload to console
    console.log("=== TB-Triage AI Screening Submission ===")
    console.log("Timestamp:", new Date().toISOString())
    console.log("Offline Mode:", data.isOffline)
    console.log("")
    console.log("PATIENT IDENTITY:")
    console.log("  Name:", data.name)
    console.log("  Age:", data.age)
    console.log("  Gender:", data.gender)
    console.log("  Phone:", data.phone)
    console.log("  Village:", data.villageName)
    console.log("  Aadhar:", data.aadhar || "Not provided")
    console.log("")
    console.log("VITALS:")
    console.log("  Weight:", data.weight, "kg")
    console.log("  Height:", data.height, "cm")
    console.log("  BMI:", (data.weight / Math.pow(data.height / 100, 2)).toFixed(1))
    console.log("  Heart Rate:", data.heartRateBpm ?? "Not provided", "bpm")
    console.log(
      "  Body Temperature:",
      data.bodyTemperature != null ? `${data.bodyTemperature}°${data.bodyTemperatureUnit || "C"}` : "Not provided"
    )
    console.log("")
    console.log("CLINICAL QUESTIONNAIRE:")
    console.log("  Cough Duration:", data.coughDuration, "weeks")
    console.log("  Cough Nature:", data.coughNature)
    console.log("  Fever History:", data.feverHistory)
    console.log("  Night Sweats:", data.nightSweats || "Not provided")
    console.log("  Weight Loss:", data.weightLoss || "Not provided")
    console.log("  Physical Signs:", data.physicalSigns.length > 0 ? data.physicalSigns.join(", ") : "None")
    console.log("  Risk Factors:", data.riskFactors.length > 0 ? data.riskFactors.join(", ") : "None")
    console.log("  Risk Factor Answers:", data.riskFactorAnswers ? JSON.stringify(data.riskFactorAnswers) : "{}")
    console.log("  Other Observations:", data.otherObservations || "None")
    console.log("")
    console.log("AUDIO RECORDINGS:")
    console.log("  Slot 1:", data.audioRecordings.slot1 ? "Recorded" : "Not recorded")
    console.log("  Slot 2:", data.audioRecordings.slot2 ? "Recorded" : "Not recorded")
    console.log("  Slot 3:", data.audioRecordings.slot3 ? "Recorded" : "Not recorded")
    console.log("")
    console.log("METADATA:")
    console.log("  ASHA Worker ID:", data.ashaWorkerId)
    console.log("  Submitted At:", data.submittedAt)
    console.log("")
    console.log("FULL JSON PAYLOAD:")
    console.log(JSON.stringify(data, null, 2))
    console.log("==========================================")

    // Simulate API delay
    setTimeout(() => {
      resolve({
        success: true,
        patientId: `P${Date.now().toString().slice(-6)}`,
      })
    }, 1000)
  })
}

export function calculateRiskScore(data: Partial<ScreeningData>): number {
  let score = 0
  const answers = data.riskFactorAnswers || {}
  const hasPositive = (code: string) =>
    answers[code] === "yes" || Boolean(data.riskFactors && data.riskFactors.includes(code))
  const tempC =
    data.bodyTemperature == null
      ? null
      : data.bodyTemperatureUnit === "F"
      ? (data.bodyTemperature - 32) * (5 / 9)
      : data.bodyTemperature

  // Cough duration (0-3 points)
  if (data.coughDuration) {
    if (data.coughDuration >= 8) score += 3
    else if (data.coughDuration >= 4) score += 2
    else if (data.coughDuration >= 2) score += 1
  }

  // Cough nature (0-3 points)
  if (data.coughNature === "bloodStained") score += 3
  else if (data.coughNature === "wet") score += 1.5

  // Fever history (0-2 points)
  if (data.feverHistory === "highGrade") score += 2
  else if (data.feverHistory === "lowGrade") score += 1

  // Additional critical predictors
  if (data.nightSweats === "yes" || hasPositive("nightSweats")) score += 1.5
  if (data.weightLoss === "yes" || hasPositive("weightLoss")) score += 1.2

  // Physical signs (0-2 points)
  if (data.physicalSigns) {
    score += Math.min(data.physicalSigns.length * 0.5, 2)
  }

  // Risk factors (0-3 points)
  if (hasPositive("historyOfTB")) score += 1
  if (hasPositive("familyMemberHasTB")) score += 0.5
  if (hasPositive("diabetes")) score += 0.3
  if (hasPositive("smoker")) score += 0.2
  if (hasPositive("historyOfHIV")) score += 1.5
  if (hasPositive("historyOfCovid")) score += 0.3

  // Optional vitals
  if (data.heartRateBpm != null && data.heartRateBpm > 110) score += 0.4
  if (tempC != null && tempC >= 38) score += 0.6

  // Normalize to 0-10 scale
  return Math.min(Math.round(score * 10) / 10, 10)
}

export function notifyPatient(patient: Patient): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    console.log(`=== SMS Notification Sent ===`)
    console.log(`To: ${patient.phone}`)
    console.log(`Patient: ${patient.name}`)
    console.log(`Message: Please visit the Primary Health Centre for TB testing. Your screening indicates you need medical attention.`)
    console.log(`=============================`)

    setTimeout(() => {
      resolve({ success: true })
    }, 500)
  })
}
