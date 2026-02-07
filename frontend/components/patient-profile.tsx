"use client"

import { useState } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Activity,
  ArrowLeft,
  Brain,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Mic,
  Shield,
  User,
} from "lucide-react"
import { LanguageSwitcher } from "./language-switcher"
import type { Patient, RiskLevel } from "@/lib/mockData"

interface PatientProfileProps {
  patient: Patient
  onBack: () => void
}

export function PatientProfile({ patient, onBack }: PatientProfileProps) {
  const { t, language } = useLanguage()
  const [scheduledDate, setScheduledDate] = useState(patient.scheduledTestDate || "")
  const [showDatePicker, setShowDatePicker] = useState(false)

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
      default:
        return factor
    }
  }
  
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

  const handleScheduleTest = () => {
    if (scheduledDate) {
      alert(`${t.testScheduled}: ${scheduledDate}`)
      setShowDatePicker(false)
    }
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
            <p className="text-xs text-muted-foreground line-clamp-1">
              {language === "en" ? patient.address : patient.addressHi}
            </p>
            <p className="text-sm text-muted-foreground">{patient.phone}</p>
          </div>
          <div className="text-right">
            <Badge className={`${getRiskBadgeStyle(patient.riskLevel)} text-lg px-3 py-1`}>
              {patient.riskScore}/10
            </Badge>
            <p className="text-sm font-medium mt-1">{getRiskLabel(patient.riskLevel)} {t.riskScore}</p>
          </div>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t.weight}</p>
                    <p className="font-medium">{patient.weight || "-"} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.height}</p>
                    <p className="font-medium">{patient.height || "-"} cm</p>
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
                    {patient.hearAudioScore?.toFixed(2) || "0.00"}
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
                      {(patient.hearAudioScore || 0) > 0.7
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
                <p className="text-sm leading-relaxed text-foreground bg-muted/50 p-3 rounded-lg border">
                  {patient.medGemmaReasoning || (language === "en"
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
                  <Calendar className="h-5 w-5 text-primary" />
                  {t.scheduleTest}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!showDatePicker ? (
                  <div>
                    {scheduledDate ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {language === "en" ? "Test scheduled for:" : "परीक्षण निर्धारित:"}
                          </p>
                          <p className="font-medium text-lg">{scheduledDate}</p>
                        </div>
                        <Button variant="outline" onClick={() => setShowDatePicker(true)}>
                          {language === "en" ? "Change" : "बदलें"}
                        </Button>
                      </div>
                    ) : (
                      <Button onClick={() => setShowDatePicker(true)} className="w-full">
                        <Calendar className="h-4 w-4 mr-2" />
                        {t.scheduleTest}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>{language === "en" ? "Select Date" : "तारीख चुनें"}</Label>
                      <Input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        min={new Date().toISOString().split("T")[0]}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setShowDatePicker(false)} className="flex-1">
                        {language === "en" ? "Cancel" : "रद्द करें"}
                      </Button>
                      <Button onClick={handleScheduleTest} className="flex-1">
                        {language === "en" ? "Confirm" : "पुष्टि करें"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  {t.precautionInstructions}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    { icon: CheckCircle2, text: t.isolateFromChildren },
                    { icon: CheckCircle2, text: t.wearMask },
                    { icon: CheckCircle2, text: t.ventilateRoom },
                  ].map((instruction, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <instruction.icon className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                      <span className="text-sm">{instruction.text}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
