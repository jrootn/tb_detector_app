"use client"

import { useState, useEffect, useCallback } from "react"
import { LanguageProvider } from "@/lib/language-context"
import { LoginScreen } from "./login-screen"
import { DashboardScreen } from "./dashboard-screen"
import { ScreeningFlow } from "./screening-flow"
import { PatientProfile } from "./patient-profile"
import { PriorityView } from "./priority-view"
import { mockPatients, type Patient } from "@/lib/mockData"
import { getAllPatients, savePatients, seedPatientsIfEmpty } from "@/lib/db"

type Screen = "login" | "dashboard" | "screening" | "profile" | "priority"

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

export function AppShell({
  initialScreen = "login",
  initialAshaId = "",
  initialAshaName = "",
  onLogout,
}: AppShellProps) {
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen)
  const [isOnline, setIsOnline] = useState(true)
  const [ashaId, setAshaId] = useState(initialAshaId)
  const [ashaName, setAshaName] = useState(initialAshaName)
  const [patients, setPatients] = useState<Patient[]>(mockPatients)
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

  // Load patients from IndexedDB (seed with mock data once)
  useEffect(() => {
    let isMounted = true
    const loadPatients = async () => {
      try {
        await seedPatientsIfEmpty(mockPatients)
        const stored = await getAllPatients()
        if (isMounted && stored.length > 0) {
          setPatients(stored)
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
  }, [])

  // Refresh from IndexedDB after sync completes
  useEffect(() => {
    const handler = async () => {
      const stored = await getAllPatients()
      setPatients(stored)
    }

    window.addEventListener("sync:complete", handler)
    return () => {
      window.removeEventListener("sync:complete", handler)
    }
  }, [])

  // When back online, refresh local cache to clear stale sync flags
  useEffect(() => {
    if (!dbReady || !isOnline) return
    getAllPatients().then(setPatients).catch(() => undefined)
  }, [dbReady, isOnline])

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
    setPatients((prev) => prev.map((patient) => (patient.id === updated.id ? updated : patient)))
    setSelectedPatient(updated)
  }, [])

  const handleScreeningComplete = useCallback((newPatient: Patient) => {
    setPatients((prev) => [newPatient, ...prev])
    setCurrentScreen("dashboard")
  }, [])

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
            onLogout={handleLogout}
            onNewScreening={() => setCurrentScreen("screening")}
            onViewPatient={handleViewPatient}
            onViewPriority={() => setCurrentScreen("priority")}
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
      </div>
    </LanguageProvider>
  )
}
