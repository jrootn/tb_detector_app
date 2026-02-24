"use client"

import { useState, useEffect, useCallback } from "react"
import { LanguageProvider } from "@/lib/language-context"
import { LoginScreen } from "./login-screen"
import { DashboardScreen } from "./dashboard-screen"
import { ScreeningFlow } from "./screening-flow"
import { PatientProfile } from "./patient-profile"
import { PriorityView } from "./priority-view"
import { UserProfileSettings } from "./user-profile-settings"
import { mockPatients, type Patient } from "@/lib/mockData"
import { getPatientsForAsha, savePatients, seedPatientsIfEmpty, getPendingUploadCount } from "@/lib/db"
import { syncData } from "@/lib/sync"

type Screen = "login" | "dashboard" | "screening" | "profile" | "priority" | "settings"

interface GPSLocation {
  latitude: number | null
  longitude: number | null
  error: string | null
}

interface AppShellProps {
  initialScreen?: Screen
  initialAshaId?: string
  initialAshaName?: string
  onLogout?: () => void
}

function sortPatientsForQueue(patients: Patient[]) {
  return [...patients].sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore
    const aTime = new Date(a.collectionDate || a.createdAt).getTime()
    const bTime = new Date(b.collectionDate || b.createdAt).getTime()
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

export function AppShell({
  initialScreen = "login",
  initialAshaId = "",
  initialAshaName = "",
  onLogout,
}: AppShellProps) {
  const enableMockSeed = process.env.NEXT_PUBLIC_ENABLE_MOCK_SEED === "1"
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen)
  const [isOnline, setIsOnline] = useState(true)
  const [ashaId, setAshaId] = useState(initialAshaId)
  const [ashaName, setAshaName] = useState(initialAshaName)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [dbReady, setDbReady] = useState(false)
  const [gpsLocation, setGpsLocation] = useState<GPSLocation>({
    latitude: null,
    longitude: null,
    error: null,
  })

  // Auto-detect network status
  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine)
    }

    // Set initial status
    updateOnlineStatus()

    // Listen for network changes
    window.addEventListener("online", updateOnlineStatus)
    window.addEventListener("offline", updateOnlineStatus)

    return () => {
      window.removeEventListener("online", updateOnlineStatus)
      window.removeEventListener("offline", updateOnlineStatus)
    }
  }, [])

  // Auto-detect GPS location
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsLocation({
        latitude: null,
        longitude: null,
        error: "Geolocation not supported",
      })
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGpsLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          error: null,
        })
      },
      (error) => {
        setGpsLocation({
          latitude: null,
          longitude: null,
          error: error.message,
        })
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  // Load patients from IndexedDB
  useEffect(() => {
    let isMounted = true
    const loadPatients = async () => {
      try {
        if (enableMockSeed) {
          await seedPatientsIfEmpty(mockPatients)
        }
        const stored = await getPatientsForAsha(initialAshaId || undefined)
        const scoped = stored.map((patient) =>
          initialAshaId && !patient.ashaId ? { ...patient, ashaId: initialAshaId } : patient
        )
        const ordered = sortPatientsForQueue(scoped)
        if (isMounted) setPatients(ordered)
        const pendingCount = await getPendingUploadCount(initialAshaId || undefined)
        const needsSyncCount = ordered.filter((p) => p.needsSync).length
        if (isMounted) setPendingUploads(pendingCount + needsSyncCount)
      } catch (error) {
        console.error("Failed to load patients from IndexedDB", error)
      } finally {
        if (isMounted) setDbReady(true)
      }
    }

    loadPatients()
    return () => {
      isMounted = false
    }
  }, [enableMockSeed, initialAshaId])

  // Refresh from IndexedDB after sync completes
  useEffect(() => {
    const handler = async () => {
      const stored = await getPatientsForAsha(ashaId || undefined)
      const ordered = sortPatientsForQueue(stored)
      setPatients(ordered)
      const pendingCount = await getPendingUploadCount(ashaId || undefined)
      const needsSyncCount = ordered.filter((p) => p.needsSync).length
      setPendingUploads(pendingCount + needsSyncCount)
    }

    window.addEventListener("sync:complete", handler)
    return () => {
      window.removeEventListener("sync:complete", handler)
    }
  }, [])

  // When back online, refresh local cache to clear stale sync flags
  useEffect(() => {
    if (!dbReady || !isOnline) return
    getPatientsForAsha(ashaId || undefined)
      .then((stored) => setPatients(sortPatientsForQueue(stored)))
      .catch(() => undefined)
    Promise.all([getPatientsForAsha(ashaId || undefined), getPendingUploadCount(ashaId || undefined)])
      .then(([stored, pendingCount]) => {
        const ordered = sortPatientsForQueue(stored)
        setPatients(ordered)
        const needsSyncCount = stored.filter((p) => p.needsSync).length
        setPendingUploads(pendingCount + needsSyncCount)
      })
      .catch(() => undefined)
  }, [dbReady, isOnline])

  // Periodic foreground sync keeps ASHA risk/status cards aligned with backend AI updates.
  useEffect(() => {
    if (!dbReady || !isOnline || !ashaId || currentScreen === "login") return
    let cancelled = false
    let inFlight = false

    const runSync = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        await syncData()
      } catch (error) {
        console.warn("Periodic sync failed", error)
      } finally {
        inFlight = false
      }
    }

    runSync()
    const timer = window.setInterval(runSync, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [dbReady, isOnline, ashaId, currentScreen])

  // Persist patient changes to IndexedDB
  useEffect(() => {
    if (!dbReady) return
    savePatients(patients).catch((error) => {
      console.error("Failed to save patients to IndexedDB", error)
    })
  }, [patients, dbReady])

  const handleLogin = useCallback((id: string) => {
    setAshaId(id)
    setCurrentScreen("dashboard")
  }, [])

  const handleLogout = useCallback(() => {
    if (!isOnline) {
      // Can't logout when offline - this will be handled in dashboard
      return
    }
    if (onLogout) {
      onLogout()
      return
    }
    setAshaId("")
    setCurrentScreen("login")
  }, [isOnline, onLogout])

  const handleViewPatient = useCallback((patient: Patient) => {
    setSelectedPatient(patient)
    setCurrentScreen("profile")
  }, [])

  const handleUpdatePatient = useCallback((updated: Patient) => {
    const next = updated.ashaId ? updated : { ...updated, ashaId }
    setPatients((prev) => sortPatientsForQueue(prev.map((patient) => (patient.id === next.id ? next : patient))))
    setSelectedPatient(updated)
  }, [ashaId])

  const handleScreeningComplete = useCallback((newPatient: Patient) => {
    const next = newPatient.ashaId ? newPatient : { ...newPatient, ashaId }
    setPatients((prev) => sortPatientsForQueue([next, ...prev]))
    if (navigator.onLine) {
      syncData().catch((error) => {
        console.warn("Auto-sync after screening failed", error)
      })
    }
    setCurrentScreen("dashboard")
  }, [ashaId])

  return (
    <LanguageProvider>
      <div className="min-h-screen bg-background">
        {currentScreen === "login" && <LoginScreen onLogin={handleLogin} />}

        {currentScreen === "dashboard" && (
          <DashboardScreen
            ashaId={ashaId}
            ashaName={ashaName}
            isOnline={isOnline}
            patients={patients}
            pendingUploads={pendingUploads}
            onLogout={handleLogout}
            onNewScreening={() => setCurrentScreen("screening")}
            onViewPatient={handleViewPatient}
            onViewPriority={() => setCurrentScreen("priority")}
            onOpenProfile={() => setCurrentScreen("settings")}
            gpsLocation={gpsLocation}
          />
        )}

        {currentScreen === "screening" && (
          <ScreeningFlow
            ashaId={ashaId}
            isOnline={isOnline}
            onComplete={handleScreeningComplete}
            onBack={() => setCurrentScreen("dashboard")}
            gpsLocation={gpsLocation}
          />
        )}

        {currentScreen === "profile" && selectedPatient && (
          <PatientProfile
            patient={selectedPatient}
            onBack={() => setCurrentScreen("dashboard")}
            onUpdatePatient={handleUpdatePatient}
          />
        )}

        {currentScreen === "priority" && (
          <PriorityView
            patients={patients.filter((p) => p.riskLevel === "high" || p.riskLevel === "medium")}
            onBack={() => setCurrentScreen("dashboard")}
            onViewPatient={handleViewPatient}
          />
        )}

        {currentScreen === "settings" && (
          <UserProfileSettings
            expectedRole="ASHA"
            title="ASHA Profile"
            onBack={() => setCurrentScreen("dashboard")}
          />
        )}
      </div>
    </LanguageProvider>
  )
}
