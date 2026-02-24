"use client"

import { useState, useMemo } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  CalendarDays,
  UserCircle2,
} from "lucide-react"
import { LanguageSwitcher } from "./language-switcher"
import { getStats, type Patient, type RiskLevel } from "@/lib/mockData"

interface GPSLocation {
  latitude: number | null
  longitude: number | null
  error: string | null
}

interface DashboardScreenProps {
  ashaId: string
  ashaName?: string
  isOnline: boolean
  patients: Patient[]
  pendingUploads: number
  onLogout: () => void
  onNewScreening: () => void
  onViewPatient: (patient: Patient) => void
  onViewPriority: () => void
  onOpenProfile: () => void
  gpsLocation: GPSLocation
}

type FilterType = "all" | "critical" | "needsSync" | "completed"

export function DashboardScreen({
  ashaId,
  ashaName,
  isOnline,
  patients,
  pendingUploads,
  onLogout,
  onNewScreening,
  onViewPatient,
  onViewPriority,
  onOpenProfile,
  gpsLocation,
}: DashboardScreenProps) {
  const { t, language } = useLanguage()
  const [filter, setFilter] = useState<FilterType>("all")
  const [dateFilter, setDateFilter] = useState<string>("")
  const [showOfflineWarning, setShowOfflineWarning] = useState(false)
  const stats = getStats(patients)
  const hasPendingSync = pendingUploads > 0
  const hasAiResult = (patient: Patient) =>
    patient.aiStatus === "success" ||
    Boolean(patient.medGemmaReasoning || patient.medGemmaReasoningI18n?.en || patient.medGemmaReasoningI18n?.hi || patient.hearAudioScore != null)

  const filteredPatients = useMemo(() => {
    let filtered = patients

    // Apply status filter
    switch (filter) {
      case "critical":
        filtered = filtered.filter((patient) => hasAiResult(patient) && patient.riskScore >= 7)
        break
      case "needsSync":
        filtered = filtered.filter((patient) => patient.needsSync)
        break
      case "completed":
        filtered = filtered.filter(
          (patient) => patient.status === "cleared" || patient.status === "underTreatment"
        )
        break
    }

    // Apply date filter
    if (dateFilter) {
      filtered = filtered.filter((patient) => patient.collectionDate === dateFilter)
    }

    return [...filtered].sort((a, b) => {
      const aHasAi = hasAiResult(a)
      const bHasAi = hasAiResult(b)
      if (aHasAi !== bHasAi) return aHasAi ? -1 : 1
      if (aHasAi && bHasAi && b.riskScore !== a.riskScore) return b.riskScore - a.riskScore
      const aTime = new Date(a.collectionDate || a.createdAt).getTime()
      const bTime = new Date(b.collectionDate || b.createdAt).getTime()
      if (aTime !== bTime) return aTime - bTime
      return a.id.localeCompare(b.id)
    })
  }, [patients, filter, dateFilter])

  const handleLogoutClick = () => {
    if (!isOnline) {
      setShowOfflineWarning(true)
    } else {
      onLogout()
    }
  }

  const getRiskBadgeStyle = (level: RiskLevel, aiReady: boolean) => {
    if (!aiReady) {
      return "bg-slate-500 hover:bg-slate-600 text-white"
    }
    switch (level) {
      case "high":
        return "bg-red-500 hover:bg-red-600 text-white"
      case "medium":
        return "bg-amber-500 hover:bg-amber-600 text-white"
      case "low":
        return "bg-emerald-500 hover:bg-emerald-600 text-white"
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

  const getStatusLabel = (status: Patient["status"]) => {
    switch (status) {
      case "awaitingDoctor":
        return t.awaitingDoctor
      case "testPending":
        return t.testPending
      case "underTreatment":
        return t.underTreatment
      case "cleared":
        return t.cleared
    }
  }

  const formatScore = (score: number, aiReady: boolean) =>
    aiReady ? `${score.toFixed(1)} / 10 (${Math.round(score * 10)}%)` : language === "en" ? "Awaiting AI" : "एआई की प्रतीक्षा"

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground sm:text-xl">{t.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted">
            {isOnline ? (
              <>
                <Wifi className="h-4 w-4 text-emerald-500" />
                <span className="text-sm hidden sm:inline">{t.online}</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-amber-500" />
                <span className="text-sm hidden sm:inline">{t.offline}</span>
              </>
            )}
          </div>
          <Button 
            variant="ghost"
            size="icon"
            onClick={onOpenProfile}
          >
            <UserCircle2 className="h-5 w-5" />
            <span className="sr-only">Profile</span>
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleLogoutClick}
            disabled={!isOnline}
            className={!isOnline ? "opacity-50 cursor-not-allowed" : ""}
          >
            <LogOut className="h-5 w-5" />
            <span className="sr-only">{t.logout}</span>
          </Button>
        </div>
      </header>

      {/* Offline Warning Banner */}
      {!isOnline && (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center gap-2 text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{t.networkRequiredWarning}</span>
        </div>
      )}

      {/* Welcome Bar */}
      <div className="bg-primary text-primary-foreground px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-semibold opacity-95">
              {t.welcome}, {ashaName || ashaId || (language === "en" ? "ASHA Worker" : "आशा कार्यकर्ता")}
            </p>
            <p className="flex items-center gap-1.5 text-sm opacity-80">
              <MapPin className="h-3.5 w-3.5" />
              {gpsLocation.latitude && gpsLocation.longitude
                ? `${gpsLocation.latitude.toFixed(4)}, ${gpsLocation.longitude.toFixed(4)}`
                : gpsLocation.error || (language === "en" ? "Getting location..." : "स्थान प्राप्त कर रहे हैं...")}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline ? (
              <span className="flex items-center gap-1 text-xs bg-primary-foreground/20 px-2 py-1 rounded-full">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {t.online}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs bg-primary-foreground/20 px-2 py-1 rounded-full">
                <CloudOff className="h-3 w-3" />
                {t.offline}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 pb-24 space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-500"
            onClick={onViewPriority}
          >
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                {t.highRiskPatients}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-red-600">{stats.highRisk}</p>
            </CardContent>
          </Card>

          {(!isOnline || hasPendingSync) ? (
            <Card
              className="border-l-4 border-l-amber-500 cursor-pointer"
              onClick={() => setFilter("needsSync")}
            >
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
                  {t.pendingUploads}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <p className="text-2xl font-bold text-amber-600">{pendingUploads}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-l-4 border-l-emerald-500">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {language === "en" ? "All Synced" : "सभी सिंक हो चुके हैं"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <p className="text-2xl font-bold text-emerald-600">0</p>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Patient List */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-lg font-semibold">{t.patientList}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {language === "en"
                ? "Ranking: higher score first (0-10 scale). If score ties, earlier collected patient stays ahead."
                : "रैंकिंग: उच्च स्कोर पहले (0-10 स्केल)। समान स्कोर पर पहले संग्रहित मरीज आगे रहेगा।"}
            </p>
            {/* Filters */}
            <div className="space-y-3 pt-2">
              {/* Status Filters */}
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all" as FilterType, label: t.all },
                  { key: "critical" as FilterType, label: t.criticalRisk },
                  ...((!isOnline || hasPendingSync)
                    ? [{ key: "needsSync" as FilterType, label: t.needsSync }]
                    : []),
                  { key: "completed" as FilterType, label: language === "en" ? "Completed" : "पूर्ण" },
                ].map((item) => (
                  <Button
                    key={item.key}
                    variant={filter === item.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(item.key)}
                    className="h-8 text-xs"
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              
              {/* Date Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="dateFilter" className="text-sm font-medium whitespace-nowrap">
                  {t.filterByDate}:
                </Label>
                <Input
                  id="dateFilter"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="h-8 w-full text-sm sm:w-auto"
                />
                {dateFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDateFilter("")}
                    className="h-8 px-2 text-xs"
                  >
                    {language === "en" ? "Clear" : "हटाएं"}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-2 p-3 md:hidden">
              {filteredPatients.map((patient, index) => (
                <button
                  key={patient.id}
                  type="button"
                  className="w-full rounded-lg border bg-background p-3 text-left shadow-sm transition-colors hover:bg-muted/40"
                  onClick={() => onViewPatient(patient)}
                >
                  {(() => {
                    const aiReady = hasAiResult(patient)
                    return (
                      <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{language === "en" ? patient.name : patient.nameHi}</div>
                      <div className="text-xs text-muted-foreground">{patient.sampleId || "-"}</div>
                    </div>
                    <Badge className={getRiskBadgeStyle(patient.riskLevel, aiReady)}>
                      {aiReady ? getRiskLabel(patient.riskLevel) : language === "en" ? "Awaiting AI" : "एआई प्रतीक्षा"}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      #{index + 1} • {language === "en" ? patient.village : patient.villageHi}
                    </div>
                    <div className="text-right">{new Date(patient.collectionDate).toLocaleDateString(language === "en" ? "en-IN" : "hi-IN")}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{getStatusLabel(patient.status)}</span>
                    <span className="font-medium text-foreground">{formatScore(patient.riskScore, aiReady)}</span>
                  </div>
                      </>
                    )
                  })()}
                </button>
              ))}
              {filteredPatients.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {language === "en" ? "No patients found" : "कोई मरीज़ नहीं मिला"}
                </div>
              )}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">Rank</TableHead>
                    <TableHead className="font-semibold">{t.name}</TableHead>
                    <TableHead className="font-semibold">Sample ID</TableHead>
                    <TableHead className="font-semibold">{t.village}</TableHead>
                    <TableHead className="font-semibold">{t.collectionDate}</TableHead>
                    <TableHead className="font-semibold">{t.riskScore}</TableHead>
                    <TableHead className="font-semibold">{t.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map((patient, index) => (
                    <TableRow
                      key={patient.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onViewPatient(patient)}
                    >
                      <TableCell className="font-semibold">{index + 1}</TableCell>
                      <TableCell className="font-medium">
                        {language === "en" ? patient.name : patient.nameHi}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {patient.sampleId || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {language === "en" ? patient.village : patient.villageHi}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(patient.collectionDate).toLocaleDateString(
                          language === "en" ? "en-IN" : "hi-IN"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge className={getRiskBadgeStyle(patient.riskLevel, hasAiResult(patient))}>
                            {hasAiResult(patient) ? getRiskLabel(patient.riskLevel) : language === "en" ? "Awaiting AI" : "एआई प्रतीक्षा"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatScore(patient.riskScore, hasAiResult(patient))}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getStatusLabel(patient.status)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredPatients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {language === "en" ? "No patients found" : "कोई मरीज़ नहीं मिला"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6">
        <Button
          onClick={onNewScreening}
          size="lg"
          className="h-14 rounded-full px-5 shadow-lg hover:shadow-xl transition-shadow bg-emerald-600 hover:bg-emerald-700 gap-2 text-base font-semibold"
        >
          <Plus className="h-7 w-7" />
          <span>{language === "en" ? "Add Patient" : "मरीज जोड़ें"}</span>
        </Button>
      </div>

      {/* Offline Warning Dialog */}
      <AlertDialog open={showOfflineWarning} onOpenChange={setShowOfflineWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-amber-500" />
              {language === "en" ? "Network Required" : "नेटवर्क आवश्यक"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t.networkRequiredWarning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowOfflineWarning(false)}>
              {language === "en" ? "OK" : "ठीक है"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
