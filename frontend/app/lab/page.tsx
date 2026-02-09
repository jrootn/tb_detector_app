"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { auth, db } from "@/lib/firebase"
import { LabQueue } from "@/components/lab-queue"
import { useAutoSync } from "@/hooks/useAutoSync"

export default function LabPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useAutoSync()

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
        localStorage.setItem("user_role", "LAB_TECH")
        setReady(true)
      } catch (error) {
        const cachedRole = localStorage.getItem("user_role")
        if (cachedRole !== "LAB_TECH") {
          router.replace("/login")
          return
        }
        setReady(true)
      }
    })
    return () => unsub()
  }, [router])

  if (!ready) return <div className="p-6">Loading...</div>
  return <LabQueue />
}
