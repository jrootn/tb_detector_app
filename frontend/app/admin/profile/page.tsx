"use client"

import { useRouter } from "next/navigation"
import { UserProfileSettings } from "@/components/user-profile-settings"

export default function AdminProfilePage() {
  const router = useRouter()
  return (
    <UserProfileSettings
      expectedRole="ADMIN"
      title="Admin Profile"
      onBack={() => router.push("/admin")}
    />
  )
}
