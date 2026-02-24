import { getDownloadURL, ref } from "firebase/storage"
import { storage } from "@/lib/firebase"

export function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export async function resolveStorageUrl(value?: string | null): Promise<string | null> {
  if (!value) return null
  if (looksLikeHttpUrl(value)) return value
  try {
    return await getDownloadURL(ref(storage, value))
  } catch {
    return null
  }
}
