"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Activity,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ClipboardList,
  Mic,
  Shield,
  User,
} from "lucide-react"
import { LanguageSwitcher } from "./language-switcher"
import type { Patient, RiskLevel } from "@/lib/mockData"
import { PatientNotesThread } from "@/components/patient-notes-thread"

interface PatientProfileProps {
  patient: Patient
  onBack: () => void
  onUpdatePatient: (patient: Patient) => void
}

export function PatientProfile({ patient, onBack, onUpdatePatient }: PatientProfileProps) {
  const { t, language } = useLanguage()
  const [activeHelpStage, setActiveHelpStage] = useState<string | null>(null)

  const getRiskBadgeStyle = (level: RiskLevel) => {
    switch (level) {
      case "high":
        return "bg-red-500 text-white"
      case "medium":
        return "bg-amber-500 text-white"
      case "low":
        return "bg-emerald-500 text-white"
    }
  }

  const getRiskLabel = (level: RiskLevel) => {
    switch (level) {
      case "high":
        return t.high
      case "medium":
        return t.medium
      case "low":
        return t.low
    }
  }

  const getCoughNatureLabel = (nature?: string) => {
    switch (nature) {
      case "dry":
        return t.dry
      case "wet":
        return t.wetSputum
      case "bloodStained":
        return t.bloodStained
      default:
        return "-"
    }
  }

  const getFeverLabel = (fever?: string) => {
    switch (fever) {
      case "none":
        return t.none
      case "lowGrade":
        return t.lowGrade
      case "highGrade":
        return t.highGradeNightSweats
      default:
        return "-"
    }
  }

  const getPhysicalSignLabel = (sign: string) => {
    switch (sign) {
      case "chestPain":
        return t.chestPain
      case "shortnessOfBreath":
        return t.shortnessOfBreath
      case "lossOfAppetite":
        return t.lossOfAppetite
      case "extremeFatigue":
        return t.extremeFatigue
      default:
        return sign
    }
  }

  const getRiskFactorLabel = (factor: string) => {
    switch (factor) {
      case "historyOfTB":
        return t.historyOfTB
      case "familyMemberHasTB":
        return t.familyMemberHasTB
      case "diabetes":
        return t.diabetes
      case "smoker":
        return t.smoker
      case "historyOfCovid":
        return t.historyOfCovid
      case "historyOfHIV":
        return t.historyOfHIV
      case "nightSweats":
        return t.nightSweats
      case "weightLoss":
        return t.weightLoss
      default:
        return factor
    }
  }

  const getAnswerLabel = (answer?: Patient["nightSweats"]) => {
    if (!answer) return "-"
    if (answer === "yes") return t.yes
    if (answer === "no") return t.no
    if (answer === "dontKnow") return t.dontKnow
    return t.preferNotToSay
  }

  const getLocalizedReasoning = (p: Patient) => {
    const i18n = p.medGemmaReasoningI18n
    if (language === "hi") {
      return i18n?.hi || i18n?.en || p.medGemmaReasoning || ""
    }
    return i18n?.en || p.medGemmaReasoning || i18n?.hi || ""
  }

  const aiReady =
    patient.aiStatus === "success" ||
    Boolean(patient.medGemmaReasoning || patient.medGemmaReasoningI18n?.en || patient.medGemmaReasoningI18n?.hi || patient.hearAudioScore != null)
  const roundedRiskScore = Number.isFinite(patient.riskScore) ? Number(patient.riskScore.toFixed(1)) : 0
  const collectorDisplayName = (() => {
    if (patient.ashaName) return patient.ashaName
    if (typeof window !== "undefined") {
      const localCollectorName = localStorage.getItem("user_name")
      if (localCollectorName) return localCollectorName
    }
    return language === "en" ? "ASHA Worker" : "आशा कार्यकर्ता"
  })()
  const collectedAtLabel = (() => {
    const raw = patient.collectedAt || patient.createdAt
    if (!raw) return "-"
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString(language === "en" ? "en-IN" : "hi-IN")
  })()
  const aiActionItems = (() => {
    const items = language === "hi" ? patient.aiActionItemsI18n?.hi || patient.aiActionItemsI18n?.en : patient.aiActionItemsI18n?.en || patient.aiActionItemsI18n?.hi
    return Array.isArray(items) ? items.filter(Boolean) : []
  })()
  
  const stages = [
    { key: "collected", label: t.collected, help: t.collectedHelp, done: true },
    { key: "synced", label: t.synced, help: t.syncedHelp, done: !patient.needsSync },
    {
      key: "ai",
      label: t.aiAnalysisDone,
      help: t.aiAnalysisDoneHelp,
      done: Boolean(patient.medGemmaReasoning || patient.medGemmaReasoningI18n?.en || patient.medGemmaReasoningI18n?.hi || patient.hearAudioScore),
    },
    {
      key: "doctor",
      label: t.doctorReviewed,
      help: t.doctorReviewedHelp,
      done: patient.status !== "awaitingDoctor",
    },
    {
      key: "completed",
      label: t.testCompleted,
      help: t.testCompletedHelp,
      done: patient.status === "underTreatment" || patient.status === "cleared",
    },
  ]

  useEffect(() => {
    if (!activeHelpStage) return
    const timer = setTimeout(() => setActiveHelpStage(null), 2500)
    return () => clearTimeout(timer)
  }, [activeHelpStage])

  // Helper to format cough duration (now in days)
  const formatCoughDuration = (days?: number) => {
    if (!days) return "-"
    if (days < 7) return `${days} ${t.days}`
    const weeks = Math.floor(days / 7)
    const remainingDays = days % 7
    if (remainingDays === 0) {
      return `${weeks} ${t.weeks}`
    }
    return `${weeks} ${t.weeks} ${remainingDays} ${t.days}`
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
            <User className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">
            {language === "en" ? patient.name : patient.nameHi}
          </span>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Patient Header */}
      <div className="bg-card border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {language === "en" ? patient.name : patient.nameHi}
            </h1>
            <p className="text-sm text-muted-foreground">
              {patient.age} {language === "en" ? "years" : "वर्ष"} | {patient.pincode}
            </p>
            <p className="text-sm font-medium text-foreground">
              Sample ID: {patient.sampleId || "-"}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {language === "en" ? patient.address : patient.addressHi}
            </p>
            <p className="text-sm text-muted-foreground">{patient.phone}</p>
          </div>
          <div className="text-right">
            <Badge className={`${aiReady ? getRiskBadgeStyle(patient.riskLevel) : "bg-slate-500 text-white"} text-lg px-3 py-1`}>
              {aiReady ? `${roundedRiskScore.toFixed(1)}/10` : language === "en" ? "AI Pending" : "एआई प्रतीक्षा"}
            </Badge>
            <p className="text-sm font-medium mt-1">
              {aiReady ? `${getRiskLabel(patient.riskLevel)} ${t.riskScore}` : language === "en" ? "Awaiting AI risk score" : "एआई जोखिम स्कोर की प्रतीक्षा"}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
          <p>{language === "en" ? "Collected by" : "नमूना संग्रहकर्ता"}: {collectorDisplayName}</p>
          <p>{language === "en" ? "Collected at" : "संग्रह समय"}: {collectedAtLabel}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stages.map((stage) => (
            <div key={stage.key} className="relative group">
              <button
                type="button"
                onClick={() => setActiveHelpStage((prev) => (prev === stage.key ? null : stage.key))}
                className={`w-full rounded-md border px-2.5 py-2 text-center text-xs font-medium ${
                  stage.done
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {stage.label}
              </button>
              <div
                className={`pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-44 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[10px] text-background shadow-md ${
                  activeHelpStage === stage.key ? "block" : "hidden group-hover:block group-focus-within:block"
                }`}
              >
                {stage.help}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4">
        <Tabs defaultValue="clinical" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-11">
            <TabsTrigger value="clinical" className="gap-1.5">
              <ClipboardList className="h-4 w-4" />
              <span className="hidden sm:inline">{t.clinicalData}</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-1.5">
              <Brain className="h-4 w-4" />
              <span className="hidden sm:inline">{t.aiAnalysis}</span>
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">{t.actions}</span>
            </TabsTrigger>
          </TabsList>

          {/* Clinical Data Tab */}
          <TabsContent value="clinical" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.vitals}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t.weight}</p>
                    <p className="font-medium">{patient.weight || "-"} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.height}</p>
                    <p className="font-medium">{patient.height || "-"} cm</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.heartRate}</p>
                    <p className="font-medium">{patient.heartRateBpm || "-"} bpm</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.bodyTemperature}</p>
                    <p className="font-medium">
                      {patient.bodyTemperature != null ? `${patient.bodyTemperature}°${patient.bodyTemperatureUnit || "C"}` : "-"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.clinicalQuestionnaire}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t.coughDuration}</p>
                    <p className="font-medium">{formatCoughDuration(patient.coughDuration)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.coughNature}</p>
                    <p className={`font-medium ${patient.coughNature === "bloodStained" ? "text-red-600" : ""}`}>
                      {getCoughNatureLabel(patient.coughNature)}
                      {patient.coughNature === "bloodStained" && ` (${t.redAlert})`}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">{t.feverHistory}</p>
                  <p className="font-medium">{getFeverLabel(patient.feverHistory)}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t.nightSweats}</p>
                    <p className="font-medium">{getAnswerLabel(patient.nightSweats)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.weightLoss}</p>
                    <p className="font-medium">{getAnswerLabel(patient.weightLoss)}</p>
                  </div>
                </div>

                {patient.physicalSigns && patient.physicalSigns.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">{t.physicalSigns}</p>
                    <div className="flex flex-wrap gap-2">
                      {patient.physicalSigns.map((sign) => (
                        <Badge key={sign} variant="secondary">
                          {getPhysicalSignLabel(sign)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {patient.riskFactors && patient.riskFactors.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">{t.riskFactors}</p>
                    <div className="flex flex-wrap gap-2">
                      {patient.riskFactors.map((factor) => (
                        <Badge key={factor} variant="outline" className="border-amber-500 text-amber-700">
                          {getRiskFactorLabel(factor)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {patient.otherObservations && (
                  <div>
                    <p className="text-sm text-muted-foreground">{t.otherObservations}</p>
                    <p className="font-medium text-sm bg-muted p-2 rounded-md mt-1">
                      {patient.otherObservations}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Analysis Tab */}
          <TabsContent value="ai" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mic className="h-5 w-5 text-primary" />
                  {t.hearAudioScore}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="text-3xl font-bold text-foreground">
                    {patient.hearAudioScore != null ? patient.hearAudioScore.toFixed(2) : "--"}
                  </div>
                  <div className="flex-1">
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (patient.hearAudioScore || 0) > 0.7
                            ? "bg-red-500"
                            : (patient.hearAudioScore || 0) > 0.4
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${(patient.hearAudioScore || 0) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {!aiReady
                        ? language === "en"
                          ? "AI is still processing this case."
                          : "इस केस के लिए एआई अभी प्रोसेस कर रहा है।"
                        : (patient.hearAudioScore || 0) > 0.7
                        ? language === "en"
                          ? "High probability of lung abnormality"
                          : "फेफड़ों की असामान्यता की उच्च संभावना"
                        : (patient.hearAudioScore || 0) > 0.4
                        ? language === "en"
                          ? "Moderate probability of lung abnormality"
                          : "फेफड़ों की असामान्यता की मध्यम संभावना"
                        : language === "en"
                        ? "Low probability of lung abnormality"
                        : "फेफड़ों की असामान्यता की कम संभावना"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  {t.medGemmaReasoning}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-2 text-xs text-muted-foreground">
                  {aiReady
                    ? language === "en"
                      ? "AI recommendations are ready."
                      : "एआई सिफारिशें तैयार हैं।"
                    : language === "en"
                    ? "No AI summary yet. Keep baseline precautions active."
                    : "एआई सारांश अभी नहीं है। बेसलाइन सावधानियां जारी रखें।"}
                </div>
                <p className="text-sm leading-relaxed text-foreground bg-muted/50 p-3 rounded-lg border">
                  {getLocalizedReasoning(patient) || (language === "en"
                    ? "No AI analysis available for this patient."
                    : "इस मरीज के लिए कोई एआई विश्लेषण उपलब्ध नहीं है।")}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actions Tab */}
          <TabsContent value="actions" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  {t.precautionInstructions}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {language === "en"
                    ? "Follow these instructions during screening and while awaiting test completion."
                    : "जांच पूरी होने तक स्क्रीनिंग अवधि में इन निर्देशों का पालन करें।"}
                </div>
                <ul className="space-y-3">
                  {aiActionItems.length > 0
                    ? aiActionItems.map((text, index) => (
                        <li key={`${text}-${index}`} className="flex items-start gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                          <span className="text-sm">{text}</span>
                        </li>
                      ))
                    : [
                        { text: t.isolateFromChildren },
                        { text: t.wearMask },
                        { text: t.ventilateRoom },
                      ].map((instruction, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                          <span className="text-sm">{instruction.text}</span>
                        </li>
                      ))}
                </ul>
              </CardContent>
            </Card>

            {patient.doctorInstructions && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {language === "en" ? "Doctor Instructions" : "डॉक्टर के निर्देश"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {language === "en"
                      ? "Top priority: follow doctor instructions first."
                      : "सर्वोच्च प्राथमिकता: पहले डॉक्टर के निर्देशों का पालन करें।"}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground bg-muted/50 p-3 rounded-lg border">
                    {patient.doctorInstructions}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Case Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <PatientNotesThread patientId={patient.id} viewerRole="ASHA" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
