"use client"

import React from "react"

import { useState } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  MapPin,
  User,
} from "lucide-react"
import { LanguageSwitcher } from "./language-switcher"
import { notifyPatient } from "@/lib/api"
import type { Patient, RiskLevel } from "@/lib/mockData"
import { toast } from "sonner"

interface PriorityViewProps {
  patients: Patient[]
  onBack: () => void
  onViewPatient: (patient: Patient) => void
}

export function PriorityView({ patients, onBack, onViewPatient }: PriorityViewProps) {
  const { t, language } = useLanguage()
  const [notifyingId, setNotifyingId] = useState<string | null>(null)

  // Sort by risk score (highest first)
  const sortedPatients = [...patients].sort((a, b) => b.riskScore - a.riskScore)

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

  const getRecommendedAction = (patient: Patient) => {
    if (patient.riskScore >= 8) {
      return {
        text: t.immediateIsolation,
        color: "text-red-600",
        bgColor: "bg-red-50",
      }
    } else if (patient.riskScore >= 5) {
      return {
        text: t.urgentTesting,
        color: "text-amber-600",
        bgColor: "bg-amber-50",
      }
    }
    return {
      text: t.routineFollowUp,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    }
  }

  const handleNotify = async (patient: Patient, e: React.MouseEvent) => {
    e.stopPropagation()
    setNotifyingId(patient.id)
    await notifyPatient(patient)
    toast.success(t.notificationSent)
    setNotifyingId(null)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500">
            <AlertTriangle className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-foreground">{t.priorityLogistics}</span>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Info Bar */}
      <div className="bg-red-50 border-b border-red-100 px-4 py-2">
        <p className="text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {language === "en"
            ? `${sortedPatients.length} patients requiring immediate attention`
            : `${sortedPatients.length} मरीजों को तत्काल ध्यान देने की आवश्यकता`}
        </p>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 space-y-3">
        {sortedPatients.map((patient, index) => {
          const action = getRecommendedAction(patient)
          return (
            <Card
              key={patient.id}
              className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
              style={{
                borderLeftColor: patient.riskLevel === "high" ? "#ef4444" : "#f59e0b",
              }}
              onClick={() => onViewPatient(patient)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Rank Number */}
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-bold shrink-0">
                    #{index + 1}
                  </div>

                  {/* Patient Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h3 className="font-semibold text-foreground truncate">
                          {language === "en" ? patient.name : patient.nameHi}
                        </h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {language === "en" ? patient.village : patient.villageHi}
                        </p>
                      </div>
                      <Badge className={`${getRiskBadgeStyle(patient.riskLevel)} text-base px-2.5 py-0.5 shrink-0`}>
                        {patient.riskScore}/10
                      </Badge>
                    </div>

                    {/* Distance */}
                    <p className="text-sm text-muted-foreground mb-2">
                      {t.distanceToPHC}: <span className="font-medium">{patient.distanceToPHC} km</span>
                    </p>

                    {/* Recommended Action */}
                    <div className={`${action.bgColor} rounded-md p-2 mb-3`}>
                      <p className="text-xs text-muted-foreground">{t.recommendedAction}</p>
                      <p className={`text-sm font-medium ${action.color}`}>{action.text}</p>
                    </div>

                    {/* Notify Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-transparent"
                      onClick={(e) => handleNotify(patient, e)}
                      disabled={notifyingId === patient.id}
                    >
                      {notifyingId === patient.id ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          {language === "en" ? "Sending..." : "भेज रहा है..."}
                        </span>
                      ) : (
                        <>
                          <Bell className="h-4 w-4 mr-2" />
                          {t.notifyPatient}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}

        {sortedPatients.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 mb-4">
                <Activity className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-muted-foreground">
                {language === "en"
                  ? "No high-risk patients at this time"
                  : "इस समय कोई उच्च जोखिम वाले मरीज नहीं हैं"}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
