"use client"

import { useState, useEffect, useCallback } from "react"
import { LanguageProvider } from "@/lib/language-context"
import { LoginScreen } from "./login-screen"
import { DashboardScreen } from "./dashboard-screen"
import { ScreeningFlow } from "./screening-flow"
import { PatientProfile } from "./patient-profile"
import { PriorityView } from "./priority-view"
import { mockPatients, type Patient } from "@/lib/mockData"

type Screen = "login" | "dashboard" | "screening" | "profile" | "priority"

interface GPSLocation {
  latitude: number | null
  longitude: number | null
  error: string | null
}

export function AppShell() {
  const [currentScreen, setCurrentScreen] = useState<Screen>("login")
  const [isOnline, setIsOnline] = useState(true)
  const [ashaId, setAshaId] = useState("")
  const [patients, setPatients] = useState<Patient[]>(mockPatients)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
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

  const handleLogin = useCallback((id: string) => {
    setAshaId(id)
    setCurrentScreen("dashboard")
  }, [])

  const handleLogout = useCallback(() => {
    if (!isOnline) {
      // Can't logout when offline - this will be handled in dashboard
      return
    }
    setAshaId("")
    setCurrentScreen("login")
  }, [isOnline])

  const handleViewPatient = useCallback((patient: Patient) => {
    setSelectedPatient(patient)
    setCurrentScreen("profile")
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
