"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { auth, db } from "@/lib/firebase"

export function RoleRouter() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(true)

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid))
        const role = snap.data()?.role
        if (role) {
          localStorage.setItem("user_role", role)
        }
        if (role === "ASHA") router.replace("/asha")
        else if (role === "DOCTOR") router.replace("/doctor")
        else if (role === "LAB_TECH") router.replace("/lab")
        else router.replace("/login")
      } catch (error) {
        const cachedRole = localStorage.getItem("user_role")
        if (!isOnline && cachedRole === "ASHA") {
          router.replace("/asha")
        } else {
          router.replace("/login")
        }
      }
      setLoading(false)
    })

    return () => unsub()
  }, [router, isOnline])

  if (loading) return <div className="p-6">Loading...</div>
  return null
}
