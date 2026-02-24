"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { auth, db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { AdminDashboard } from "@/components/admin-dashboard"

export default function AdminPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [adminName, setAdminName] = useState("Admin")

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid))
        if (snap.data()?.role !== "ADMIN") {
          router.replace("/login")
          return
        }
        localStorage.setItem("user_role", "ADMIN")
        localStorage.setItem("user_uid", user.uid)
        localStorage.setItem("user_name", snap.data()?.name || "Admin")
        setAdminName(snap.data()?.name || "Admin")
        setReady(true)
      } catch {
        router.replace("/login")
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
        <div className="text-sm font-medium">{adminName} - Block Monitoring Admin</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${isOnline ? "text-emerald-600" : "text-amber-600"}`}>
            {isOnline ? "Online" : "Offline"}
          </span>
          <Button variant="outline" size="sm" onClick={() => router.push("/admin/profile")}>
            Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!isOnline) return
              await signOut(auth)
              localStorage.removeItem("user_role")
              localStorage.removeItem("user_name")
              localStorage.removeItem("user_uid")
              router.replace("/login")
            }}
            disabled={!isOnline}
          >
            Logout
          </Button>
        </div>
      </div>
      {!isOnline ? (
        <div className="p-6 text-sm text-muted-foreground">Admin dashboard requires internet access.</div>
      ) : (
        <AdminDashboard />
      )}
    </div>
  )
}
