"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { auth, db } from "@/lib/firebase"
import { UserProfileSettings } from "@/components/user-profile-settings"

export default function LabProfilePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

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
        setReady(true)
      } catch {
        router.replace("/login")
      }
    })
    return () => unsub()
  }, [router])

  if (!ready) return <div className="p-6">Loading...</div>

  return <UserProfileSettings expectedRole="LAB_TECH" title="Lab Profile" onBack={() => router.push("/lab")} />
}

