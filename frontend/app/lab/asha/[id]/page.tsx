"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface AshaUserDoc {
  name?: string
  role?: string
  email?: string
  phone?: string
  address?: string
  assigned_center?: string
  preferred_language?: string
  profile_photo_data_url?: string
}

export default function LabAshaProfilePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [asha, setAsha] = useState<AshaUserDoc | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login")
        return
      }
      try {
        const viewerSnap = await getDoc(doc(db, "users", user.uid))
        if (viewerSnap.data()?.role !== "LAB_TECH") {
          router.replace("/login")
          return
        }

        const uid = params.id
        const ashaSnap = await getDoc(doc(db, "users", uid))
        if (!ashaSnap.exists()) {
          router.replace("/lab")
          return
        }
        const data = ashaSnap.data() as AshaUserDoc
        if (data.role !== "ASHA") {
          router.replace("/lab")
          return
        }
        setAsha(data)
        setReady(true)
      } catch {
        router.replace("/lab")
      }
    })
    return () => unsub()
  }, [params.id, router])

  if (!ready || !asha) return <div className="p-6">Loading...</div>

  return (
    <div className="min-h-screen p-4 space-y-4 bg-background">
      <Button variant="outline" onClick={() => router.push("/lab")}>
        Back to Lab Queue
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>ASHA Worker Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-full overflow-hidden border bg-muted flex items-center justify-center">
              {asha.profile_photo_data_url ? (
                <img src={asha.profile_photo_data_url} alt={asha.name || "ASHA"} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">No Photo</span>
              )}
            </div>
            <div>
              <div className="text-lg font-semibold">{asha.name || "Unknown"}</div>
              <div className="text-muted-foreground">Role: {asha.role || "ASHA"}</div>
            </div>
          </div>

          <div>Phone: {asha.phone || "-"}</div>
          <div>Address: {asha.address || "-"}</div>
          <div>Assigned Center: {asha.assigned_center || "-"}</div>
          <div>Preferred Language: {asha.preferred_language || "-"}</div>
          <div>Email: {asha.email || "-"}</div>
        </CardContent>
      </Card>
    </div>
  )
}

