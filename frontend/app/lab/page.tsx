"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { auth, db } from "@/lib/firebase"
import { LabQueue } from "@/components/lab-queue"
import { useAutoSync } from "@/hooks/useAutoSync"
import { Button } from "@/components/ui/button"

export default function LabPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [labName, setLabName] = useState("Lab")
  useAutoSync(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid))
        if (snap.data()?.role !== "LAB_TECH") {
          router.replace("/login")
          return
        }
        setLabName(snap.data()?.name || "Lab")
        setReady(true)
      } catch (error) {
        router.replace("/login")
        return
      }
    })
    return () => unsub()
  }, [router])

  useEffect(() => {
    const handler = () => setIsOnline(navigator.onLine)
    handler()
    window.addEventListener("online", handler)
    window.addEventListener("offline", handler)
    return () => {
      window.removeEventListener("online", handler)
      window.removeEventListener("offline", handler)
    }
  }, [])

  if (!ready) return <div className="p-6">Loading...</div>

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="text-sm font-medium">{labName} Queue</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${isOnline ? "text-emerald-600" : "text-amber-600"}`}>
            {isOnline ? "Online" : "Offline"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!isOnline) return
              await signOut(auth)
              router.replace("/login")
            }}
            disabled={!isOnline}
          >
            Logout
          </Button>
        </div>
      </div>
      {!isOnline ? (
        <div className="p-6 text-sm text-muted-foreground">
          Lab portal requires internet access. Please go online.
        </div>
      ) : (
        <LabQueue />
      )}
    </div>
  )
}
