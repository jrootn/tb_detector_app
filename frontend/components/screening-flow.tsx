"use client"

import { useEffect, useRef, useState } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Activity, ArrowLeft, ArrowRight, Check, AlertTriangle, Mic, Square } from "lucide-react"
import { toast } from "sonner"
import { LanguageSwitcher } from "./language-switcher"
import { submitScreening, type ScreeningData } from "@/lib/api"
import { addUpload, assignPendingUploadsToPatient } from "@/lib/db"
import type { Patient, RiskLevel } from "@/lib/mockData"

interface GPSLocation {
  latitude: number | null
  longitude: number | null
  error: string | null
}

interface ScreeningFlowProps {
  ashaId: string
  ashaName?: string
  isOnline: boolean
  onComplete: (patient: Patient) => void
  onBack: () => void
  gpsLocation: GPSLocation
}

type CoughNature = "dry" | "wet" | "bloodStained"
type FeverHistory = "none" | "lowGrade" | "highGrade"
type Gender = "male" | "female" | "other"
type RiskFactorAnswer = "yes" | "no" | "dontKnow" | "preferNotToSay"

interface RiskFactorState {
  historyOfTB: RiskFactorAnswer
  familyMemberHasTB: RiskFactorAnswer
  diabetes: RiskFactorAnswer
  smoker: RiskFactorAnswer
  historyOfCovid: RiskFactorAnswer
  historyOfHIV: RiskFactorAnswer
}

interface FormData {
  // Identity
  name: string
  age: string
  gender: Gender
  phone: string
  address: string
  pincode: string
  aadhar: string
  
  // Vitals
  weight: string
  height: string
  heartRate: string
  bodyTemperature: string
  bodyTemperatureUnit: "C" | "F"
  
  // Clinical
  coughDuration: number // Now in days
  coughNature: CoughNature
  feverHistory: FeverHistory
  nightSweats: RiskFactorAnswer
  weightLoss: RiskFactorAnswer
  physicalSigns: string[]
  riskFactors: RiskFactorState
  otherObservations: string
  
  // Audio
  audioRecordings: {
    slot1: "idle" | "recording" | "tooShort" | "good"
    slot2: "idle" | "recording" | "tooShort" | "good"
    slot3: "idle" | "recording" | "tooShort" | "good"
  }
}

const initialRiskFactors: RiskFactorState = {
  historyOfTB: "no",
  familyMemberHasTB: "no",
  diabetes: "no",
  smoker: "no",
  historyOfCovid: "no",
  historyOfHIV: "no",
}

export function ScreeningFlow({ ashaId, ashaName, isOnline, onComplete, onBack, gpsLocation }: ScreeningFlowProps) {
  const { t, language } = useLanguage()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState("")
  const [showSampleId, setShowSampleId] = useState(false)
  const [generatedSampleId, setGeneratedSampleId] = useState<string | null>(null)
  const [pendingPatient, setPendingPatient] = useState<Patient | null>(null)
  const [uploadedAudioName, setUploadedAudioName] = useState<string>("")
  const [uploadedAudioPreview, setUploadedAudioPreview] = useState<string>("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingError, setRecordingError] = useState("")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const totalSteps = 4
  
  const [formData, setFormData] = useState<FormData>({
    name: "",
    age: "",
    gender: "male",
    phone: "",
    address: "",
    pincode: "",
    aadhar: "",
    weight: "",
    height: "",
    heartRate: "",
    bodyTemperature: "",
    bodyTemperatureUnit: "C",
    coughDuration: 0,
    coughNature: "dry",
    feverHistory: "none",
    nightSweats: "no",
    weightLoss: "no",
    physicalSigns: [],
    riskFactors: initialRiskFactors,
    otherObservations: "",
    audioRecordings: {
      slot1: "idle",
      slot2: "idle",
      slot3: "idle",
    },
  })
  const answerOptions = [
    { value: "yes" as const, label: t.yes },
    { value: "no" as const, label: t.no },
    { value: "dontKnow" as const, label: t.dontKnow },
    { value: "preferNotToSay" as const, label: t.preferNotToSay },
  ]

  const validateStep = (stepNumber: number): string | null => {
    const phoneDigits = formData.phone.replace(/\D/g, "")
    if (stepNumber === 1) {
      if (formData.name.trim().length < 2) {
        return language === "en" ? "Please enter patient name." : "कृपया मरीज का नाम दर्ज करें।"
      }
      const age = Number(formData.age)
      if (!Number.isFinite(age) || age < 1 || age > 120) {
        return language === "en" ? "Please enter a valid age." : "कृपया सही उम्र दर्ज करें।"
      }
      if (phoneDigits.length !== 10) {
        return language === "en" ? "Please enter a valid 10-digit phone number." : "कृपया सही 10 अंकों का फोन नंबर दर्ज करें।"
      }
      if (formData.address.trim().length < 5) {
        return language === "en" ? "Please enter full address." : "कृपया पूरा पता दर्ज करें।"
      }
      if (!/^\d{6}$/.test(formData.pincode.trim())) {
        return language === "en" ? "Please enter a valid 6-digit pincode." : "कृपया सही 6 अंकों का पिनकोड दर्ज करें।"
      }
    }
    if (stepNumber === 2) {
      const weight = Number(formData.weight)
      const height = Number(formData.height)
      const heartRate = Number(formData.heartRate)
      const bodyTemperature = Number(formData.bodyTemperature)
      if (!Number.isFinite(weight) || weight <= 0) {
        return language === "en" ? "Please enter valid weight." : "कृपया सही वजन दर्ज करें।"
      }
      if (!Number.isFinite(height) || height <= 0) {
        return language === "en" ? "Please enter valid height." : "कृपया सही ऊंचाई दर्ज करें।"
      }
      if (formData.heartRate.trim() && (!Number.isFinite(heartRate) || heartRate < 20 || heartRate > 250)) {
        return language === "en" ? "Heart rate should be between 20 and 250 bpm." : "हृदय गति 20 से 250 bpm के बीच होनी चाहिए।"
      }
      if (formData.bodyTemperature.trim()) {
        const min = formData.bodyTemperatureUnit === "F" ? 86 : 30
        const max = formData.bodyTemperatureUnit === "F" ? 113 : 45
        if (!Number.isFinite(bodyTemperature) || bodyTemperature < min || bodyTemperature > max) {
          return language === "en"
            ? `Temperature should be between ${min} and ${max}°${formData.bodyTemperatureUnit}.`
            : `तापमान ${min} और ${max}°${formData.bodyTemperatureUnit} के बीच होना चाहिए।`
        }
      }
    }
    if (stepNumber === 4 && !uploadedAudioName) {
      return language === "en" ? "Please upload one cough audio file before submit." : "सबमिट से पहले एक खांसी ऑडियो फ़ाइल अपलोड करें।"
    }
    return null
  }

  const handleNext = () => {
    const error = validateStep(step)
    if (error) {
      setFormError(error)
      return
    }
    setFormError("")
    if (step < totalSteps) {
      setStep(step + 1)
    }
  }

  const handlePrevious = () => {
    setFormError("")
    if (step > 1) {
      setStep(step - 1)
    }
  }

  const handleAudioUpload = async (file: File) => {
    const upload = {
      id: `${Date.now()}-${file.name}`,
      ownerUid: ashaId,
      patientId: "pending",
      role: "ASHA" as const,
      kind: "audio" as const,
      fileName: file.name,
      mimeType: file.type || "audio/wav",
      blob: file,
      createdAt: new Date().toISOString(),
    }
    await addUpload(upload)
    if (uploadedAudioPreview) {
      URL.revokeObjectURL(uploadedAudioPreview)
    }
    const preview = URL.createObjectURL(file)
    setUploadedAudioName(file.name)
    setUploadedAudioPreview(preview)
    setFormError("")
    setFormData((prev) => ({
      ...prev,
      audioRecordings: { ...prev.audioRecordings, slot1: "good", slot2: "idle", slot3: "idle" },
    }))
    toast.success(language === "en" ? "Audio saved for sync." : "ऑडियो सिंक के लिए सहेजा गया।")
  }

  const stopMediaTracks = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError(
        language === "en"
          ? "Microphone recording is not supported on this device/browser."
          : "इस डिवाइस/ब्राउज़र में माइक्रोफोन रिकॉर्डिंग सपोर्ट नहीं है।"
      )
      return
    }
    try {
      setRecordingError("")
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordedChunksRef.current = []

      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
      const recorder = new MediaRecorder(stream, { mimeType: preferredMime })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size === 0) {
          setRecordingError(language === "en" ? "Recording failed. Please retry." : "रिकॉर्डिंग विफल हुई। फिर प्रयास करें।")
          stopMediaTracks()
          return
        }
        const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"
        const file = new File([blob], `cough-${Date.now()}.${ext}`, { type: blob.type })
        await handleAudioUpload(file)
        stopMediaTracks()
      }

      recorder.start(250)
      setRecordingSeconds(0)
      setIsRecording(true)
    } catch (error) {
      setRecordingError(
        language === "en"
          ? "Microphone permission denied or unavailable."
          : "माइक्रोफोन अनुमति नहीं मिली या उपलब्ध नहीं है।"
      )
      stopMediaTracks()
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
    }
    setIsRecording(false)
  }

  useEffect(() => {
    return () => {
      if (uploadedAudioPreview) URL.revokeObjectURL(uploadedAudioPreview)
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
      }
      stopMediaTracks()
    }
  }, [uploadedAudioPreview])

  useEffect(() => {
    if (!isRecording) return
    const timer = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRecording])

  const handleSubmit = async () => {
    for (const s of [1, 2, 3, 4]) {
      const error = validateStep(s)
      if (error) {
        setFormError(error)
        setStep(s)
        return
      }
    }
    setFormError("")
    setIsSubmitting(true)

    const riskFactorAnswers = {
      ...formData.riskFactors,
      nightSweats: formData.nightSweats,
      weightLoss: formData.weightLoss,
    }
    const parsedBodyTemperature = formData.bodyTemperature ? parseFloat(formData.bodyTemperature) : undefined
    const normalizedBodyTemperature =
      parsedBodyTemperature == null || Number.isNaN(parsedBodyTemperature)
        ? undefined
        : formData.bodyTemperatureUnit === "F"
        ? Math.round((((parsedBodyTemperature - 32) * 5) / 9) * 10) / 10
        : parsedBodyTemperature

    // Keep positive flags for lightweight ranking UIs, while preserving full answers separately.
    const positiveRiskFactors = Object.entries(riskFactorAnswers)
      .filter(([, value]) => value === "yes")
      .map(([key]) => key)

    const today = new Date().toISOString().split("T")[0]

    const screeningData: ScreeningData = {
      name: formData.name,
      age: parseInt(formData.age) || 0,
      gender: formData.gender,
      phone: formData.phone,
      villageName: formData.address, // Using address as the location
      aadhar: formData.aadhar || undefined,
      weight: parseFloat(formData.weight) || 0,
      height: parseFloat(formData.height) || 0,
      coughDuration: Math.ceil(formData.coughDuration / 7), // Convert days to weeks for API
      coughNature: formData.coughNature,
      feverHistory: formData.feverHistory,
      nightSweats: formData.nightSweats,
      weightLoss: formData.weightLoss,
      physicalSigns: formData.physicalSigns,
      riskFactors: positiveRiskFactors,
      riskFactorAnswers,
      otherObservations: formData.otherObservations,
      audioRecordings: {
        slot1: formData.audioRecordings.slot1 === "good",
        slot2: false,
        slot3: false,
      },
      submittedAt: new Date().toISOString(),
      ashaWorkerId: ashaId,
      isOffline: !isOnline,
      heartRateBpm: formData.heartRate ? parseFloat(formData.heartRate) : undefined,
      bodyTemperature: normalizedBodyTemperature,
      bodyTemperatureUnit: "C",
    }

    const result = await submitScreening(screeningData)

    // Create new patient
    const sampleId = `TX-${Math.floor(100 + Math.random() * 900)}`
    const collectedAtIso = new Date().toISOString()
    const riskLevel: RiskLevel = "low"
    const newPatient: Patient = {
      id: result.patientId,
      ashaId,
      ashaName: ashaName || undefined,
      name: formData.name,
      nameHi: formData.name,
      age: parseInt(formData.age) || 0,
      gender: formData.gender,
      phone: formData.phone,
      address: formData.address,
      addressHi: formData.address,
      pincode: formData.pincode,
      aadhar: formData.aadhar || undefined,
      village: formData.address.split(",").pop()?.trim() || formData.address,
      villageHi: formData.address.split(",").pop()?.trim() || formData.address,
      riskScore: 0,
      riskLevel,
      aiStatus: "pending",
      status: "awaitingDoctor",
      distanceToPHC: Math.round(Math.random() * 20 + 2),
      needsSync: true,
      testScheduled: false,
      weight: parseFloat(formData.weight) || undefined,
      height: parseFloat(formData.height) || undefined,
      heartRateBpm: formData.heartRate ? parseFloat(formData.heartRate) : undefined,
      bodyTemperature: normalizedBodyTemperature,
      bodyTemperatureUnit: "C",
      coughDuration: formData.coughDuration,
      coughNature: formData.coughNature,
      feverHistory: formData.feverHistory,
      nightSweats: formData.nightSweats,
      weightLoss: formData.weightLoss,
      physicalSigns: formData.physicalSigns,
      riskFactors: positiveRiskFactors,
      riskFactorAnswers,
      otherObservations: formData.otherObservations,
      createdAt: collectedAtIso,
      collectedAt: collectedAtIso,
      collectionDate: today,
      latitude: gpsLocation.latitude || undefined,
      longitude: gpsLocation.longitude || undefined,
      sampleId,
    }

    await assignPendingUploadsToPatient(newPatient.id, ashaId)

    setGeneratedSampleId(sampleId)
    setPendingPatient(newPatient)
    setShowSampleId(true)
    setIsSubmitting(false)
  }

  const togglePhysicalSign = (sign: string) => {
    setFormData((prev) => ({
      ...prev,
      physicalSigns: prev.physicalSigns.includes(sign)
        ? prev.physicalSigns.filter((s) => s !== sign)
        : [...prev.physicalSigns, sign],
    }))
  }

  const updateRiskFactor = (factor: keyof RiskFactorState, value: RiskFactorAnswer) => {
    setFormData((prev) => ({
      ...prev,
      riskFactors: {
        ...prev.riskFactors,
        [factor]: value,
      },
    }))
  }

  // Helper to format days into readable string
  const formatDuration = (days: number) => {
    if (days === 0) return language === "en" ? "0 days" : "0 दिन"
    if (days < 7) return `${days} ${t.days}`
    const weeks = Math.floor(days / 7)
    const remainingDays = days % 7
    if (remainingDays === 0) {
      return `${weeks} ${t.weeks}`
    }
    return `${weeks} ${t.weeks} ${remainingDays} ${t.days}`
  }

  if (showSampleId && generatedSampleId && pendingPatient) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
        <div className="max-w-md space-y-4">
          <div className="text-sm text-muted-foreground">
            {language === "en"
              ? "Write this ID on the Sputum Cup using a marker."
              : "इस आईडी को मार्कर से सैंपल कप पर लिखें।"}
          </div>
          <div className="text-5xl font-bold tracking-widest">{generatedSampleId}</div>
          <Button
            className="w-full"
            onClick={() => {
              if (!isOnline) {
                toast.success(t.savedToLocal)
              } else {
                toast.success(t.screeningSubmitted)
              }
              setShowSampleId(false)
              onComplete(pendingPatient)
              setPendingPatient(null)
              setGeneratedSampleId(null)
            }}
          >
            {language === "en" ? "Continue" : "जारी रखें"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">{t.newScreening}</span>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Progress */}
      <div className="px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">
            {t.step} {step} / {totalSteps}
          </span>
          <span className="text-sm text-muted-foreground">
            {step === 1 && t.identity}
            {step === 2 && t.vitals}
            {step === 3 && t.clinicalQuestionnaire}
            {step === 4 && t.audioCollection}
          </span>
        </div>
        <Progress value={(step / totalSteps) * 100} className="h-2" />
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 pb-24">
        {formError && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}
        {/* Step 1: Identity */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t.identity}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t.name}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-11"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">{t.age}</Label>
                  <Input
                    id="age"
                    type="number"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.gender}</Label>
                  <div className="flex gap-2">
                    {(["male", "female", "other"] as Gender[]).map((g) => (
                      <Button
                        key={g}
                        type="button"
                        variant={formData.gender === g ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFormData({ ...formData, gender: g })}
                        className="flex-1"
                      >
                        {g === "male" ? t.male : g === "female" ? t.female : t.other}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t.phone}</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  className="h-11"
                  placeholder="10-digit e.g. 9876543210"
                  maxLength={10}
                />
                <p className="text-xs text-muted-foreground">
                  {language === "en" ? "Enter exactly 10 digits." : "ठीक 10 अंक दर्ज करें।"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">{t.address}</Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder={language === "en" ? "House No., Street, Village/Town, District" : "मकान नंबर, गली, गाँव/शहर, जिला"}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pincode">{t.pincode}</Label>
                <Input
                  id="pincode"
                  type="text"
                  value={formData.pincode}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  className="h-11"
                  placeholder="6-digit e.g. 847226"
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground">
                  {language === "en" ? "Use 6-digit India PIN code." : "6 अंकों का भारत PIN कोड दर्ज करें।"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="aadhar">
                  {t.aadhar} <span className="text-muted-foreground text-sm">({t.optional})</span>
                </Label>
                <Input
                  id="aadhar"
                  value={formData.aadhar}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      aadhar: e.target.value.replace(/[^\d\s]/g, "").slice(0, 14),
                    })
                  }
                  className="h-11"
                  placeholder="12-digit optional (e.g. 1234 5678 9012)"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Vitals */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t.vitals}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="weight">{t.weight}</Label>
                <Input
                  id="weight"
                  type="number"
                  value={formData.weight}
                  onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  className="h-11"
                  placeholder="e.g., 55"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="height">{t.height}</Label>
                <Input
                  id="height"
                  type="number"
                  value={formData.height}
                  onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                  className="h-11"
                  placeholder="e.g., 165"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="heartRate">{t.heartRate} <span className="text-muted-foreground text-sm">({t.optional})</span></Label>
                  <Input
                    id="heartRate"
                    type="number"
                    value={formData.heartRate}
                    onChange={(e) => setFormData({ ...formData, heartRate: e.target.value })}
                    className="h-11"
                    placeholder="e.g., 88"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bodyTemperature">{t.bodyTemperature} <span className="text-muted-foreground text-sm">({t.optional})</span></Label>
                  <div className="flex gap-2">
                    <Input
                      id="bodyTemperature"
                      type="number"
                      value={formData.bodyTemperature}
                      onChange={(e) => setFormData({ ...formData, bodyTemperature: e.target.value })}
                      className="h-11"
                      placeholder={formData.bodyTemperatureUnit === "C" ? "e.g., 37.2" : "e.g., 99.0"}
                    />
                    <select
                      className="h-11 w-20 rounded-md border px-2 text-sm bg-background"
                      value={formData.bodyTemperatureUnit}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          bodyTemperatureUnit: e.target.value === "F" ? "F" : "C",
                        })
                      }
                    >
                      <option value="C">C</option>
                      <option value="F">F</option>
                    </select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Clinical Questionnaire */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Cough Duration - Smooth slider with days */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.coughDuration}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-center">
                    <span className="text-2xl font-bold text-primary">{formatDuration(formData.coughDuration)}</span>
                  </div>
                  <Slider
                    value={[formData.coughDuration]}
                    onValueChange={(value) => setFormData({ ...formData, coughDuration: value[0] })}
                    max={90}
                    min={0}
                    step={1}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span>1 {language === "en" ? "week" : "सप्ताह"}</span>
                    <span>2 {language === "en" ? "weeks" : "सप्ताह"}</span>
                    <span>1 {language === "en" ? "month" : "महीना"}</span>
                    <span>2 {language === "en" ? "months" : "महीने"}</span>
                    <span>3 {language === "en" ? "months" : "महीने"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cough Nature */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.coughNature}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={formData.coughNature === "dry" ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, coughNature: "dry" })}
                  >
                    {t.dry}
                  </Button>
                  <Button
                    type="button"
                    variant={formData.coughNature === "wet" ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, coughNature: "wet" })}
                  >
                    {t.wetSputum}
                  </Button>
                  <Button
                    type="button"
                    variant={formData.coughNature === "bloodStained" ? "destructive" : "outline"}
                    onClick={() => setFormData({ ...formData, coughNature: "bloodStained" })}
                    className="gap-1.5"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    {t.bloodStained}
                    {formData.coughNature === "bloodStained" && (
                      <span className="ml-1 text-xs font-bold">({t.redAlert})</span>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Fever History */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.feverHistory}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={formData.feverHistory === "none" ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, feverHistory: "none" })}
                  >
                    {t.none}
                  </Button>
                  <Button
                    type="button"
                    variant={formData.feverHistory === "lowGrade" ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, feverHistory: "lowGrade" })}
                  >
                    {t.lowGrade}
                  </Button>
                  <Button
                    type="button"
                    variant={formData.feverHistory === "highGrade" ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, feverHistory: "highGrade" })}
                  >
                    {t.highGradeNightSweats}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Critical Predictors */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.criticalPredictors}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.nightSweats}</Label>
                  <RadioGroup
                    value={formData.nightSweats}
                    onValueChange={(value) => setFormData({ ...formData, nightSweats: value as RiskFactorAnswer })}
                    className="flex flex-wrap gap-2"
                  >
                    {answerOptions.map((option) => (
                      <div key={option.value} className="flex items-center">
                        <RadioGroupItem value={option.value} id={`nightSweats-${option.value}`} className="peer sr-only" />
                        <Label
                          htmlFor={`nightSweats-${option.value}`}
                          className={`px-3 py-1.5 rounded-md border cursor-pointer text-sm transition-colors ${
                            formData.nightSweats === option.value
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-input hover:bg-muted"
                          }`}
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.weightLoss}</Label>
                  <RadioGroup
                    value={formData.weightLoss}
                    onValueChange={(value) => setFormData({ ...formData, weightLoss: value as RiskFactorAnswer })}
                    className="flex flex-wrap gap-2"
                  >
                    {answerOptions.map((option) => (
                      <div key={option.value} className="flex items-center">
                        <RadioGroupItem value={option.value} id={`weightLoss-${option.value}`} className="peer sr-only" />
                        <Label
                          htmlFor={`weightLoss-${option.value}`}
                          className={`px-3 py-1.5 rounded-md border cursor-pointer text-sm transition-colors ${
                            formData.weightLoss === option.value
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-input hover:bg-muted"
                          }`}
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              </CardContent>
            </Card>

            {/* Physical Signs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.physicalSigns}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: "chestPain", label: t.chestPain },
                    { id: "shortnessOfBreath", label: t.shortnessOfBreath },
                    { id: "lossOfAppetite", label: t.lossOfAppetite },
                    { id: "extremeFatigue", label: t.extremeFatigue },
                  ].map((sign) => (
                    <Button
                      key={sign.id}
                      type="button"
                      variant={formData.physicalSigns.includes(sign.id) ? "default" : "outline"}
                      onClick={() => togglePhysicalSign(sign.id)}
                      className="justify-start h-auto py-3"
                    >
                      <span className={`mr-2 h-4 w-4 rounded border flex items-center justify-center ${
                        formData.physicalSigns.includes(sign.id) 
                          ? "bg-primary-foreground border-primary-foreground" 
                          : "border-current"
                      }`}>
                        {formData.physicalSigns.includes(sign.id) && <Check className="h-3 w-3 text-primary" />}
                      </span>
                      {sign.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Risk Factors - with Yes/No/Don't Know/Prefer Not to Say */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.riskFactors}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {[
                  { id: "historyOfTB" as const, label: t.historyOfTB },
                  { id: "familyMemberHasTB" as const, label: t.familyMemberHasTB },
                  { id: "diabetes" as const, label: t.diabetes },
                  { id: "smoker" as const, label: t.smoker },
                  { id: "historyOfCovid" as const, label: t.historyOfCovid },
                  { id: "historyOfHIV" as const, label: t.historyOfHIV },
                ].map((factor) => (
                  <div key={factor.id} className="space-y-2">
                    <Label className="text-sm font-medium">{factor.label}</Label>
                    <RadioGroup
                      value={formData.riskFactors[factor.id]}
                      onValueChange={(value) => updateRiskFactor(factor.id, value as RiskFactorAnswer)}
                      className="flex flex-wrap gap-2"
                    >
                      {answerOptions.map((option) => (
                        <div key={option.value} className="flex items-center">
                          <RadioGroupItem
                            value={option.value}
                            id={`${factor.id}-${option.value}`}
                            className="peer sr-only"
                          />
                          <Label
                            htmlFor={`${factor.id}-${option.value}`}
                            className={`px-3 py-1.5 rounded-md border cursor-pointer text-sm transition-colors ${
                              formData.riskFactors[factor.id] === option.value
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background border-input hover:bg-muted"
                            }`}
                          >
                            {option.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Other Observations */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.otherObservations}</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={formData.otherObservations}
                  onChange={(e) => setFormData({ ...formData, otherObservations: e.target.value })}
                  placeholder={t.otherObservationsPlaceholder}
                  rows={3}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Audio Collection */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t.audioCollection}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium mb-2">
                  {language === "en" ? "Record Cough Audio" : "खांसी का ऑडियो रिकॉर्ड करें"}
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {language === "en"
                    ? "Use microphone to record one clear cough sample (3-10 seconds)."
                    : "माइक्रोफोन से 3-10 सेकंड का एक साफ खांसी सैंपल रिकॉर्ड करें।"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!isRecording ? (
                    <Button type="button" onClick={startRecording}>
                      <Mic className="mr-2 h-4 w-4" />
                      {language === "en" ? "Start Recording" : "रिकॉर्डिंग शुरू करें"}
                    </Button>
                  ) : (
                    <Button type="button" variant="destructive" onClick={stopRecording}>
                      <Square className="mr-2 h-4 w-4" />
                      {language === "en" ? "Stop Recording" : "रिकॉर्डिंग रोकें"}
                    </Button>
                  )}
                  {isRecording && (
                    <span className="text-sm text-red-600">
                      {language === "en" ? "Recording" : "रिकॉर्डिंग"}: {recordingSeconds}s
                    </span>
                  )}
                </div>
                {recordingError && (
                  <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {recordingError}
                  </div>
                )}
                {uploadedAudioName && (
                  <div className="mt-3 rounded-md bg-muted p-3">
                    <div className="text-xs text-muted-foreground">
                      {language === "en" ? "Selected file" : "चयनित फ़ाइल"}: {uploadedAudioName}
                    </div>
                    {uploadedAudioPreview && (
                      <audio controls className="mt-2 w-full" src={uploadedAudioPreview} />
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Navigation */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-card border-t border-border">
        <div className="flex gap-3 max-w-lg mx-auto">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={handlePrevious}
              className="flex-1 h-12 bg-transparent"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t.previous}
            </Button>
          )}
          {step < totalSteps ? (
            <Button onClick={handleNext} className="flex-1 h-12">
              {t.next}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t.submit}...
                </span>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {t.submit}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
