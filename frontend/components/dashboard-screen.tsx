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
  Calendar,
  CloudOff,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  CalendarDays,
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
  gpsLocation: GPSLocation
}

type FilterType = "all" | "critical" | "needsSync" | "testScheduled" | "completed"

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
  gpsLocation,
}: DashboardScreenProps) {
  const { t, language } = useLanguage()
  const [filter, setFilter] = useState<FilterType>("all")
  const [dateFilter, setDateFilter] = useState<string>("")
  const [showOfflineWarning, setShowOfflineWarning] = useState(false)
  const stats = getStats(patients)

  const filteredPatients = useMemo(() => {
    let filtered = patients

    // Apply status filter
    switch (filter) {
      case "critical":
        filtered = filtered.filter((patient) => patient.riskLevel === "high")
        break
      case "needsSync":
        filtered = filtered.filter((patient) => patient.needsSync)
        break
      case "testScheduled":
        filtered = filtered.filter((patient) => patient.testScheduled || Boolean(patient.scheduledTestDate))
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

    return filtered
  }, [patients, filter, dateFilter])

  const handleLogoutClick = () => {
    if (!isOnline) {
      setShowOfflineWarning(true)
    } else {
      onLogout()
    }
  }

  const getRiskBadgeStyle = (level: RiskLevel) => {
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

  // Get unique dates from patients for date filter
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(patients.map((p) => p.collectionDate))]
    return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  }, [patients])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground hidden sm:block">{t.appName}</span>
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
            <p className="text-sm opacity-90">
              {t.welcome}, {ashaName || ashaId || (language === "en" ? "ASHA Worker" : "आशा कार्यकर्ता")}
            </p>
            <p className="flex items-center gap-1.5 text-xs opacity-75">
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
        <div className="grid grid-cols-3 gap-3">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-500"
            onClick={onViewPriority}
          >
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                {t.highRiskPatients}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-red-600">{stats.highRisk}</p>
            </CardContent>
          </Card>

          <Card
            className="border-l-4 border-l-amber-500 cursor-pointer"
            onClick={() => setFilter("needsSync")}
          >
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
                {t.pendingUploads}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-amber-600">{pendingUploads}</p>
            </CardContent>
          </Card>

          <Card
            className="border-l-4 border-l-sky-500 cursor-pointer"
            onClick={() => setFilter("testScheduled")}
          >
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-sky-500" />
                {t.testsScheduledToday}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-sky-600">{stats.testsToday}</p>
            </CardContent>
          </Card>
        </div>

        {/* Patient List */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-lg font-semibold">{t.patientList}</CardTitle>
            {/* Filters */}
            <div className="space-y-3 pt-2">
              {/* Status Filters */}
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all" as FilterType, label: t.all },
                  { key: "critical" as FilterType, label: t.criticalRisk },
                  { key: "needsSync" as FilterType, label: t.needsSync },
                  { key: "testScheduled" as FilterType, label: t.testScheduled },
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
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="dateFilter" className="text-sm font-medium whitespace-nowrap">
                  {t.filterByDate}:
                </Label>
                <Input
                  id="dateFilter"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="h-8 w-auto text-sm"
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">{t.name}</TableHead>
                    <TableHead className="font-semibold">Sample ID</TableHead>
                    <TableHead className="font-semibold">{t.village}</TableHead>
                    <TableHead className="font-semibold">{t.collectionDate}</TableHead>
                    <TableHead className="font-semibold">{t.riskScore}</TableHead>
                    <TableHead className="font-semibold">{t.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map((patient) => (
                    <TableRow
                      key={patient.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onViewPatient(patient)}
                    >
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
                        <Badge className={getRiskBadgeStyle(patient.riskLevel)}>
                          {getRiskLabel(patient.riskLevel)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getStatusLabel(patient.status)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredPatients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
          className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-6 w-6" />
          <span className="sr-only">{t.newScreening}</span>
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
