"use client"

import { useState, useEffect, useCallback } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
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
  upsertPatient,
  type UploadRecord,
} from "@/lib/db"
import { db } from "@/lib/firebase"
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
    if (visiblePatientIds && visiblePatientIds.size > 0 && !visiblePatientIds.has(upload.patientId)) return false
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

  const refreshLocal = useCallback(async (targetAshaId: string, targetAshaName = "") => {
    if (!targetAshaId) {
      setPatients([])
      setPendingUploads(0)
      setPendingUploadPatientIds([])
      return []
    }

    await cleanupOrphanUploads(targetAshaId || undefined)
    const stored = await getPatientsForAsha(targetAshaId || undefined)
    const visiblePatientIds = new Set(stored.map((patient) => patient.id))
    const rawUploads = await getPendingUploads(targetAshaId || undefined)
    const pendingUploads = getRelevantAshaPendingUploads(rawUploads, visiblePatientIds)
    const pendingPatientIds = new Set(pendingUploads.map((upload) => upload.patientId))
    const ordered = sortPatientsForQueue(
      withCollectorName(withPendingSyncOverlay(stored, pendingPatientIds), targetAshaId, targetAshaName)
    )
    setPatients(ordered)
    setPendingUploads(pendingUploads.length)
    setPendingUploadPatientIds(Array.from(pendingPatientIds))
    return ordered
  }, [])

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
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    const canUseGeolocation = typeof window !== "undefined" && (window.isSecureContext || isLocalhost)

    if (!canUseGeolocation) {
      setGpsLocation({
        latitude: null,
        longitude: null,
        error: "Location unavailable on non-secure connection",
      })
      return
    }

    if (!navigator.geolocation) {
      setGpsLocation({
        latitude: null,
        longitude: null,
        error: "Location not supported on this device",
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
        const secureOriginError = error.message?.includes("Only secure origins are allowed")
        const friendlyError = secureOriginError
          ? "Location unavailable on non-secure connection"
          : error.code === error.PERMISSION_DENIED
          ? "Location permission denied"
          : error.code === error.POSITION_UNAVAILABLE
          ? "Location unavailable"
          : error.code === error.TIMEOUT
          ? "Location request timed out"
          : "Location unavailable"

        setGpsLocation({
          latitude: null,
          longitude: null,
          error: friendlyError,
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
        const ordered = await refreshLocal(initialAshaId, initialAshaName)
        if (!isMounted) return

        // If local cache is empty but user is online, force a direct cloud hydration.
        // This prevents "no patients" states caused by local cache resets/timing races.
        if (ordered.length === 0 && initialAshaId && typeof navigator !== "undefined" && navigator.onLine) {
          try {
            await hydrateAshaPatientsFromCloud(initialAshaId)
            if (isMounted) {
              await refreshLocal(initialAshaId, initialAshaName)
            }
          } catch {
            // Keep local state as-is; sync listener will retry when cloud changes.
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
  }, [enableMockSeed, initialAshaId, initialAshaName, refreshLocal])

  // Refresh from IndexedDB after sync completes
  useEffect(() => {
    const syncCompleteHandler = () => void refreshLocal(ashaId, ashaName)
    const storageHandler = (event: StorageEvent) => {
      if (event.key === "tb_last_sync_at" || event.key === "tb_local_patients_updated_at") {
        void refreshLocal(ashaId, ashaName)
      }
    }

    window.addEventListener("sync:complete", syncCompleteHandler)
    window.addEventListener("storage", storageHandler)
    return () => {
      window.removeEventListener("sync:complete", syncCompleteHandler)
      window.removeEventListener("storage", storageHandler)
    }
  }, [ashaId, ashaName, refreshLocal])

  // When back online, refresh from local cache immediately.
  useEffect(() => {
    if (!dbReady || !isOnline || !ashaId) return
    void refreshLocal(ashaId, ashaName).catch(() => undefined)
  }, [dbReady, isOnline, ashaId, ashaName, refreshLocal])

  // Foreground sync runs on entry/focus (instead of timed polling) while online.
  useEffect(() => {
    if (!dbReady || !isOnline || !ashaId || currentScreen === "login") return
    let inFlight = false

    const runSync = async () => {
      if (inFlight) return
      inFlight = true
      try {
        await syncData()
      } catch (error) {
        console.warn("Periodic sync failed", error)
      } finally {
        inFlight = false
      }
    }

    void runSync()

    const focusHandler = () => void runSync()
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void runSync()
      }
    }

    window.addEventListener("focus", focusHandler)
    document.addEventListener("visibilitychange", visibilityHandler)

    return () => {
      window.removeEventListener("focus", focusHandler)
      document.removeEventListener("visibilitychange", visibilityHandler)
    }
  }, [dbReady, isOnline, ashaId, currentScreen])

  // Realtime cloud listener keeps ASHA list fresh as soon as patient docs change in Firestore.
  useEffect(() => {
    if (!dbReady || !isOnline || !ashaId || currentScreen === "login") return

    const q = query(collection(db, "patients"), where("asha_id", "==", ashaId))
    const unsubscribe = onSnapshot(
      q,
      () => {
        void (async () => {
          try {
            await hydrateAshaPatientsFromCloud(ashaId)
            await refreshLocal(ashaId, ashaName)
          } catch (error) {
            console.warn("Realtime ASHA refresh failed", error)
          }
        })()
      },
      (error) => {
        console.warn("Realtime ASHA listener failed", error)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [dbReady, isOnline, ashaId, ashaName, currentScreen, refreshLocal])

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
    setCurrentScreen("dashboard")
    localStorage.setItem("tb_local_patients_updated_at", String(Date.now()))

    void (async () => {
      try {
        await upsertPatient(next)
      } catch (error) {
        console.warn("Failed to persist new patient before sync", error)
      }

      try {
        const uploads = await getPendingUploads(ashaId || undefined)
        const pending = getRelevantAshaPendingUploads(uploads)
        const pendingIds = pending.map((upload) => upload.patientId)
        setPendingUploads(pending.length)
        setPendingUploadPatientIds(Array.from(new Set(pendingIds)))
      } catch {
        // no-op
      }

      if (navigator.onLine) {
        try {
          await syncData()
        } catch (error) {
          console.warn("Auto-sync after screening failed", error)
        }
        try {
          await syncData({ uploadsOnly: true })
        } catch (error) {
          console.warn("Immediate upload sync after screening failed", error)
        }
        try {
          await refreshLocal(ashaId, ashaName)
        } catch {
          // keep existing UI state; event listeners continue to refresh
        }
      }
    })()
  }, [ashaId, ashaName, refreshLocal])

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
