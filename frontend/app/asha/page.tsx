"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { useRouter } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { auth } from "@/lib/firebase"
import { doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"

export default function AshaPage() {
  const router = useRouter()
  const [ashaId, setAshaId] = useState<string | null>(null)
  const [ashaName, setAshaName] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid))
        const data = snap.data()
        if (data?.role !== "ASHA") {
          router.replace("/login")
          return
        }
        localStorage.setItem("user_role", "ASHA")
        localStorage.setItem("user_uid", user.uid)
        if (data?.name) {
          localStorage.setItem("user_name", data.name)
          setAshaName(data.name)
        }
        if (data?.preferred_language === "en" || data?.preferred_language === "hi") {
          localStorage.setItem("user_preferred_language", data.preferred_language)
          if (!localStorage.getItem("app_language")) {
            localStorage.setItem("app_language", data.preferred_language)
          }
        }
      } catch (error) {
        const cachedRole = localStorage.getItem("user_role")
        const cachedName = localStorage.getItem("user_name")
        if (cachedRole !== "ASHA") {
          router.replace("/login")
          return
        }
        if (cachedName) setAshaName(cachedName)
      }

      setAshaId(user.uid)
    })

    return () => unsub()
  }, [router])

  if (!ashaId) return <div className="p-6">Loading...</div>

  return (
    <AppShell
      initialScreen="dashboard"
      initialAshaId={ashaId}
      initialAshaName={ashaName || ""}
      onLogout={async () => {
        await signOut(auth)
        localStorage.removeItem("user_role")
        localStorage.removeItem("user_name")
        localStorage.removeItem("user_uid")
        router.replace("/login")
      }}
    />
  )
}
