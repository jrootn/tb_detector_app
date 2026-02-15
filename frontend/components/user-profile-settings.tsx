"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type AppRole = "ASHA" | "DOCTOR" | "LAB_TECH"

interface UserProfileSettingsProps {
  expectedRole?: AppRole
  title?: string
  onBack?: () => void
}

interface UserDoc {
  name?: string
  role?: AppRole
  assigned_center?: string
  email?: string
  phone?: string
  address?: string
  preferred_language?: "en" | "hi"
  profile_photo_data_url?: string
}

async function imageFileToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Could not read image file"))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("Invalid image"))
    el.src = rawDataUrl
  })

  const maxSide = 320
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not available")
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", 0.8)
}

export function UserProfileSettings({ expectedRole, title = "My Profile", onBack }: UserProfileSettingsProps) {
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [uid, setUid] = useState<string>("")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<AppRole | "">("")
  const [assignedCenter, setAssignedCenter] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [preferredLanguage, setPreferredLanguage] = useState<"en" | "hi">("en")
  const [photoDataUrl, setPhotoDataUrl] = useState("")

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

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
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false)
        return
      }
      setUid(user.uid)
      setEmail(user.email || "")

      try {
        const snap = await getDoc(doc(db, "users", user.uid))
        const data = (snap.data() || {}) as UserDoc
        if (expectedRole && data.role && data.role !== expectedRole) {
          toast.error("Role mismatch. Please login with the correct account.")
          return
        }
        setName(data.name || "")
        setRole((data.role || "") as AppRole | "")
        setAssignedCenter(data.assigned_center || "")
        setPhone(data.phone || "")
        setAddress(data.address || "")
        setPreferredLanguage(data.preferred_language || "en")
        setPhotoDataUrl(data.profile_photo_data_url || "")
      } catch (error) {
        toast.error("Could not load profile.")
      } finally {
        setLoading(false)
      }
    })
    return () => unsub()
  }, [expectedRole])

  const saveProfile = async () => {
    if (!uid) return
    if (!isOnline) {
      toast.error("Go online to update profile.")
      return
    }
    const phoneDigits = phone.replace(/\D/g, "").slice(0, 10)
    if (phoneDigits.length !== 10) {
      toast.error("Phone number must be 10 digits.")
      return
    }

    setSavingProfile(true)
    try {
      await setDoc(
        doc(db, "users", uid),
        {
          phone: phoneDigits,
          address: address.trim() || null,
          preferred_language: preferredLanguage,
          profile_photo_data_url: photoDataUrl || null,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      )
      setPhone(phoneDigits)
      toast.success("Profile updated.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update profile."
      toast.error(message)
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePhotoChange = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.")
      return
    }
    try {
      const dataUrl = await imageFileToDataUrl(file)
      setPhotoDataUrl(dataUrl)
      toast.success("Profile photo ready. Click Save Profile.")
    } catch (error) {
      toast.error("Could not process image.")
    }
  }

  const handlePasswordChange = async () => {
    const user = auth.currentUser
    if (!user || !user.email) {
      toast.error("User session not ready.")
      return
    }
    if (!isOnline) {
      toast.error("Go online to change password.")
      return
    }
    if (!currentPassword || !newPassword) {
      toast.error("Enter current and new password.")
      return
    }
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match.")
      return
    }

    setSavingPassword(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, cred)
      await updatePassword(user, newPassword)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      toast.success("Password updated.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change password."
      toast.error(message)
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return <div className="p-6">Loading profile...</div>
  }

  return (
    <div className="min-h-screen p-4 bg-background space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-full overflow-hidden border bg-muted flex items-center justify-center">
              {photoDataUrl ? (
                <img src={photoDataUrl} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">No Photo</span>
              )}
            </div>
            <div className="space-y-2">
              <Input type="file" accept="image/*" onChange={(e) => handlePhotoChange(e.target.files?.[0])} />
              <p className="text-xs text-muted-foreground">Image is compressed and stored in Firestore.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name (Admin managed)</Label>
              <Input value={name} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={email} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Input value={role} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Assigned Center</Label>
              <Input value={assignedCenter} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Phone (10 digits)</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
              />
            </div>
            <div className="space-y-1">
              <Label>Preferred Language</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm bg-background"
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage((e.target.value === "hi" ? "hi" : "en"))}
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Village/Town, District" />
          </div>

          <Button onClick={saveProfile} disabled={savingProfile || !isOnline}>
            {savingProfile ? "Saving..." : "Save Profile"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Current Password</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>New Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <Button onClick={handlePasswordChange} disabled={savingPassword || !isOnline}>
            {savingPassword ? "Updating..." : "Update Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

