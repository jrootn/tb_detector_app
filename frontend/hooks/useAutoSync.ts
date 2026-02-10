import { useEffect } from "react"
import { syncData } from "@/lib/sync"

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

    window.addEventListener("online", handler)
    return () => window.removeEventListener("online", handler)
  }, [uploadsOnly])
}
