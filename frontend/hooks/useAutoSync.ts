import { useEffect } from "react"
import { syncData } from "@/lib/sync"

export function useAutoSync() {
  useEffect(() => {
    const handler = () => {
      if (navigator.onLine) {
        syncData()
      }
    }

    if (navigator.onLine) {
      syncData()
    }

    window.addEventListener("online", handler)
    return () => window.removeEventListener("online", handler)
  }, [])
}
