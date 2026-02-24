import { doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"

const nameCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()
const missingCache = new Set<string>()

export function getCachedUserName(uid?: string): string | undefined {
  if (!uid) return undefined
  return nameCache.get(uid)
}

export async function resolveUserName(uid?: string): Promise<string | null> {
  if (!uid) return null
  if (missingCache.has(uid)) return null
  const cached = nameCache.get(uid)
  if (cached) return cached

  const pending = inFlight.get(uid)
  if (pending) return pending

  const req = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid))
      if (!snap.exists()) return null
      const data = snap.data() as Record<string, unknown>
      const name = typeof data.name === "string" ? data.name.trim() : ""
      if (!name) return null
      nameCache.set(uid, name)
      missingCache.delete(uid)
      return name
    } catch {
      return null
    } finally {
      inFlight.delete(uid)
    }
  })()

  inFlight.set(uid, req)
  const resolved = await req
  if (!resolved) missingCache.add(uid)
  return resolved
}
