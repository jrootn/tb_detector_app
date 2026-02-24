import { useEffect } from "react"
import { syncData } from "@/lib/sync"
import { onAuthStateChanged } from "firebase/auth"
import { auth } from "@/lib/firebase"

export function useAutoSync(uploadsOnly = false) {
  useEffect(() => {
    const handler = () => {
      if (navigator.onLine) {
        syncData({ uploadsOnly })
      }
    }

    if (navigator.onLine) {
      syncData({ uploadsOnly })
    }

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user && navigator.onLine) {
        syncData({ uploadsOnly })
      }
    })
    window.addEventListener("online", handler)
    return () => {
      unsubAuth()
      window.removeEventListener("online", handler)
    }
  }, [uploadsOnly])
}
