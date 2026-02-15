"use client"

import { useEffect, useMemo, useState } from "react"
import { addDoc, collection, onSnapshot, orderBy, query } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type NoteRole = "ASHA" | "DOCTOR" | "LAB_TECH"
type NoteVisibility = "ALL" | "DOCTOR_ASHA" | "DOCTOR_LAB"

interface PatientNote {
  id: string
  author_uid?: string
  author_role?: NoteRole
  author_name?: string
  message?: string
  visibility?: NoteVisibility
  created_at?: string
  created_at_ms?: number
}

interface PatientNotesThreadProps {
  patientId: string
  viewerRole: NoteRole
  className?: string
}

function isVisibleToRole(note: PatientNote, role: NoteRole): boolean {
  const visibility = note.visibility || "ALL"
  if (visibility === "ALL") return true
  if (visibility === "DOCTOR_ASHA") return role === "DOCTOR" || role === "ASHA"
  if (visibility === "DOCTOR_LAB") return role === "DOCTOR" || role === "LAB_TECH"
  return false
}

function defaultVisibilityForRole(role: NoteRole): NoteVisibility {
  if (role === "LAB_TECH") return "DOCTOR_LAB"
  if (role === "ASHA") return "DOCTOR_ASHA"
  return "ALL"
}

function allowedVisibilities(role: NoteRole): NoteVisibility[] {
  if (role === "DOCTOR") return ["ALL", "DOCTOR_ASHA", "DOCTOR_LAB"]
  if (role === "ASHA") return ["ALL", "DOCTOR_ASHA"]
  return ["ALL", "DOCTOR_LAB"]
}

function roleBadge(role?: NoteRole): string {
  if (role === "DOCTOR") return "bg-blue-100 text-blue-700"
  if (role === "LAB_TECH") return "bg-violet-100 text-violet-700"
  return "bg-emerald-100 text-emerald-700"
}

export function PatientNotesThread({ patientId, viewerRole, className }: PatientNotesThreadProps) {
  const [isOnline, setIsOnline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [visibility, setVisibility] = useState<NoteVisibility>(defaultVisibilityForRole(viewerRole))
  const [notes, setNotes] = useState<PatientNote[]>([])

  useEffect(() => {
    const handler = () => setIsOnline(navigator.onLine)
    handler()
    window.addEventListener("online", handler)
    window.addEventListener("offline", handler)
    return () => {
      window.removeEventListener("online", handler)
      window.removeEventListener("offline", handler)
    }
  }, [])

  useEffect(() => {
    const notesRef = collection(db, "patients", patientId, "notes")
    const notesQuery = query(notesRef, orderBy("created_at_ms", "desc"))
    const unsub = onSnapshot(
      notesQuery,
      (snap) => {
        const rows: PatientNote[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PatientNote, "id">),
        }))
        setNotes(rows)
      },
      (error) => {
        console.error("Failed to load notes", error)
      }
    )
    return () => unsub()
  }, [patientId])

  useEffect(() => {
    setVisibility(defaultVisibilityForRole(viewerRole))
  }, [viewerRole])

  const visibleNotes = useMemo(
    () => notes.filter((note) => isVisibleToRole(note, viewerRole)),
    [notes, viewerRole]
  )

  const handleAddNote = async () => {
    const user = auth.currentUser
    if (!user) {
      toast.error("User session not ready.")
      return
    }
    if (!isOnline) {
      toast.error("Go online to add notes.")
      return
    }
    const text = message.trim()
    if (!text) {
      toast.error("Please enter a note.")
      return
    }

    setSaving(true)
    try {
      const authorName = localStorage.getItem("user_name") || user.email || "User"
      await addDoc(collection(db, "patients", patientId, "notes"), {
        author_uid: user.uid,
        author_role: viewerRole,
        author_name: authorName,
        message: text,
        visibility,
        created_at: new Date().toISOString(),
        created_at_ms: Date.now(),
      })
      setMessage("")
      toast.success("Note added.")
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not add note."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={className}>
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Case Notes</div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border px-2 text-sm bg-background"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as NoteVisibility)}
          >
            {allowedVisibilities(viewerRole).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Add a note for this case..."
        />
        <Button onClick={handleAddNote} disabled={saving || !isOnline}>
          {saving ? "Posting..." : "Post Note"}
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {visibleNotes.length === 0 && (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">No notes yet.</div>
        )}
        {visibleNotes.map((note) => (
          <div key={note.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${roleBadge(note.author_role)}`}>
                  {note.author_role || "USER"}
                </span>
                <span className="text-sm font-medium">{note.author_name || "Unknown"}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {note.created_at ? new Date(note.created_at).toLocaleString() : ""}
              </span>
            </div>
            <div className="mt-2 text-sm whitespace-pre-wrap">{note.message || ""}</div>
            <div className="mt-2 text-xs text-muted-foreground">Visibility: {note.visibility || "ALL"}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

