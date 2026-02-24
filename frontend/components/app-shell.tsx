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
import {
  cleanupLegacyMockPatients,
  cleanupOrphanUploads,
  getPatientsForAsha,
  savePatients,
  seedPatientsIfEmpty,
  getPendingUploads,
  type UploadRecord,
} from "@/lib/db"
import { hydrateAshaPatientsFromCloud, syncData } from "@/lib/sync"

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
    const aHasAi = a.aiStatus === "success"
    const bHasAi = b.aiStatus === "success"
    if (aHasAi !== bHasAi) return aHasAi ? -1 : 1
    if (aHasAi && bHasAi && b.riskScore !== a.riskScore) return b.riskScore - a.riskScore
    const aTime = new Date(a.collectionDate || a.createdAt).getTime()
    const bTime = new Date(b.collectionDate || b.createdAt).getTime()
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

function withCollectorName(patients: Patient[], ashaId?: string, ashaName?: string) {
  if (!ashaId || !ashaName) return patients
  return patients.map((patient) => {
    if (patient.ashaName) return patient
    if (patient.ashaId && patient.ashaId !== ashaId) return patient
    return { ...patient, ashaId, ashaName }
  })
}

function withPendingSyncOverlay(patients: Patient[], pendingPatientIds: Set<string>) {
  if (pendingPatientIds.size === 0) return patients
  return patients.map((patient) =>
    pendingPatientIds.has(patient.id) ? { ...patient, needsSync: true } : patient
  )
}

function getRelevantAshaPendingUploads(uploads: UploadRecord[], visiblePatientIds?: Set<string>) {
  return uploads.filter((upload) => {
    if (upload.role !== "ASHA") return false
    if (upload.kind !== "audio") return false
    if (upload.patientId === "pending") return false
    if (visiblePatientIds && !visiblePatientIds.has(upload.patientId)) return false
    return true
  })
}

export function AppShell({
  initialScreen = "login",
  initialAshaId = "",
  initialAshaName = "",
  onLogout,
}: AppShellProps) {
  const enableMockSeed = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCK_SEED === "1"
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen)
  const [isOnline, setIsOnline] = useState(true)
  const [ashaId, setAshaId] = useState(initialAshaId)
  const [ashaName, setAshaName] = useState(initialAshaName)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [pendingUploadPatientIds, setPendingUploadPatientIds] = useState<string[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [dbReady, setDbReady] = useState(false)
  const [gpsLocation, setGpsLocation] = useState<GPSLocation>({
    latitude: null,
    longitude: null,
    error: null,
  })

  useEffect(() => {
    setAshaId(initialAshaId)
  }, [initialAshaId])

  useEffect(() => {
    setAshaName(initialAshaName)
  }, [initialAshaName])

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
        } else {
          await cleanupLegacyMockPatients()
        }
        await cleanupOrphanUploads(initialAshaId || undefined)
        const stored = await getPatientsForAsha(initialAshaId || undefined)
        const visiblePatientIds = new Set(stored.map((patient) => patient.id))
        const rawUploads = await getPendingUploads(initialAshaId || undefined)
        const pendingUploads = getRelevantAshaPendingUploads(rawUploads, visiblePatientIds)
        const pendingPatientIds = new Set(pendingUploads.map((upload) => upload.patientId))
        const ordered = sortPatientsForQueue(
          withCollectorName(withPendingSyncOverlay(stored, pendingPatientIds), initialAshaId, initialAshaName)
        )
        if (isMounted) setPatients(ordered)
        const pendingCount = pendingUploads.length
        if (isMounted) setPendingUploads(pendingCount)
        if (isMounted) setPendingUploadPatientIds(Array.from(pendingPatientIds))

        // If local cache is empty but user is online, force a direct cloud hydration.
        // This prevents "no patients" states caused by local cache resets/timing races.
        if (ordered.length === 0 && initialAshaId && typeof navigator !== "undefined" && navigator.onLine) {
          try {
            const refreshed = await hydrateAshaPatientsFromCloud(initialAshaId)
            const refreshedUploadsRaw = await getPendingUploads(initialAshaId)
            const refreshedPending = getRelevantAshaPendingUploads(
              refreshedUploadsRaw,
              new Set(refreshed.map((patient) => patient.id))
            )
            const refreshedPendingIds = new Set(refreshedPending.map((upload) => upload.patientId))
            const refreshedOrdered = sortPatientsForQueue(
              withCollectorName(withPendingSyncOverlay(refreshed, refreshedPendingIds), initialAshaId, initialAshaName)
            )
            if (isMounted) setPatients(refreshedOrdered)
            if (isMounted) setPendingUploads(refreshedPending.length)
            if (isMounted) setPendingUploadPatientIds(Array.from(refreshedPendingIds))
          } catch {
            // Keep local state as-is; periodic sync will retry.
          }
        }
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
  }, [enableMockSeed, initialAshaId, initialAshaName])

  // Refresh from IndexedDB after sync completes
  useEffect(() => {
    const refreshLocal = async () => {
      await cleanupOrphanUploads(ashaId || undefined)
      const stored = await getPatientsForAsha(ashaId || undefined)
      const visiblePatientIds = new Set(stored.map((patient) => patient.id))
      const rawUploads = await getPendingUploads(ashaId || undefined)
      const pendingUploads = getRelevantAshaPendingUploads(rawUploads, visiblePatientIds)
      const pendingPatientIds = new Set(pendingUploads.map((upload) => upload.patientId))
      const ordered = sortPatientsForQueue(
        withCollectorName(withPendingSyncOverlay(stored, pendingPatientIds), ashaId, ashaName)
      )
      setPatients(ordered)
      setPendingUploads(pendingUploads.length)
      setPendingUploadPatientIds(Array.from(pendingPatientIds))
    }

    const syncCompleteHandler = () => void refreshLocal()
    const storageHandler = (event: StorageEvent) => {
      if (event.key === "tb_last_sync_at" || event.key === "tb_local_patients_updated_at") {
        void refreshLocal()
      }
    }

    window.addEventListener("sync:complete", syncCompleteHandler)
    window.addEventListener("storage", storageHandler)
    return () => {
      window.removeEventListener("sync:complete", syncCompleteHandler)
      window.removeEventListener("storage", storageHandler)
    }
  }, [ashaId, ashaName])

  // When back online, refresh local cache to clear stale sync flags
  useEffect(() => {
    if (!dbReady || !isOnline) return
    Promise.all([
      cleanupOrphanUploads(ashaId || undefined),
      getPatientsForAsha(ashaId || undefined),
      getPendingUploads(ashaId || undefined),
    ])
      .then(([, stored, uploads]) => {
        const visiblePatientIds = new Set(stored.map((patient) => patient.id))
        const pendingUploads = getRelevantAshaPendingUploads(uploads, visiblePatientIds)
        const pendingPatientIds = new Set(pendingUploads.map((upload) => upload.patientId))
        const ordered = sortPatientsForQueue(
          withCollectorName(withPendingSyncOverlay(stored, pendingPatientIds), ashaId, ashaName)
        )
        setPatients(ordered)
        setPendingUploads(pendingUploads.length)
        setPendingUploadPatientIds(Array.from(pendingPatientIds))
      })
      .catch(() => undefined)
  }, [dbReady, isOnline, ashaId, ashaName])

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

  // Drain pending uploads aggressively while online so AI pipeline can trigger without manual retries.
  useEffect(() => {
    if (!dbReady || !isOnline || !ashaId || pendingUploads <= 0 || currentScreen === "login") return
    let cancelled = false
    let inFlight = false

    const runUploadSync = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        await syncData({ uploadsOnly: true })
      } catch (error) {
        console.warn("Pending upload sync retry failed", error)
      } finally {
        inFlight = false
      }
    }

    runUploadSync()
    const timer = window.setInterval(runUploadSync, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [dbReady, isOnline, ashaId, pendingUploads, currentScreen])

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
    setSelectedPatient(next)
  }, [ashaId])

  const handleScreeningComplete = useCallback((newPatient: Patient) => {
    const next = newPatient.ashaId ? newPatient : { ...newPatient, ashaId, ashaName }
    setPatients((prev) => sortPatientsForQueue([next, ...prev]))
    localStorage.setItem("tb_local_patients_updated_at", String(Date.now()))
    getPendingUploads(ashaId || undefined)
      .then((uploads) => {
        const pending = getRelevantAshaPendingUploads(uploads)
        const pendingIds = pending.map((upload) => upload.patientId)
        setPendingUploads(pending.length)
        setPendingUploadPatientIds(Array.from(new Set(pendingIds)))
      })
      .catch(() => undefined)
    if (navigator.onLine) {
      syncData().catch((error) => {
        console.warn("Auto-sync after screening failed", error)
      })
    }
    setCurrentScreen("dashboard")
  }, [ashaId, ashaName])

  const handlePendingUploadsSync = useCallback(async () => {
    if (!navigator.onLine || !ashaId) return
    try {
      await syncData({ uploadsOnly: true })
      const uploads = await getPendingUploads(ashaId)
      const visiblePatientIds = new Set((await getPatientsForAsha(ashaId)).map((patient) => patient.id))
      const pending = getRelevantAshaPendingUploads(uploads, visiblePatientIds)
      const pendingIds = pending.map((upload) => upload.patientId)
      setPendingUploads(pending.length)
      setPendingUploadPatientIds(Array.from(new Set(pendingIds)))
    } catch (error) {
      console.warn("Pending uploads sync failed", error)
    }
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
            pendingUploadPatientIds={pendingUploadPatientIds}
            onLogout={handleLogout}
            onNewScreening={() => setCurrentScreen("screening")}
            onViewPatient={handleViewPatient}
            onViewPriority={() => setCurrentScreen("priority")}
            onOpenProfile={() => setCurrentScreen("settings")}
            onSyncPendingUploads={handlePendingUploadsSync}
            gpsLocation={gpsLocation}
          />
        )}

        {currentScreen === "screening" && (
          <ScreeningFlow
            ashaId={ashaId}
            ashaName={ashaName}
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
