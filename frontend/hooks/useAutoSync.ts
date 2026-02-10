import { useEffect } from "react"
import { syncData } from "@/lib/sync"

interface AutoSyncOptions {
  uploadsOnly?: boolean
}

export function useAutoSync(options: AutoSyncOptions = {}) {
  useEffect(() => {
    const handler = () => {
      if (navigator.onLine) {
        syncData(options)
      }
    }

    if (navigator.onLine) {
      syncData(options)
    }

    window.addEventListener("online", handler)
    return () => window.removeEventListener("online", handler)
  }, [options])
}
