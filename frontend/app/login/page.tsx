"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signInWithEmailAndPassword } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await signInWithEmailAndPassword(auth, email, password)
      localStorage.removeItem("user_role")
      localStorage.removeItem("user_name")
      localStorage.removeItem("user_uid")
      const snap = await getDoc(doc(db, "users", result.user.uid))
      const role = snap.data()?.role
      const name = snap.data()?.name
      if (role) {
        localStorage.setItem("user_role", role)
      }
      if (name) {
        localStorage.setItem("user_name", name)
      }
      localStorage.setItem("user_uid", result.user.uid)

      if (role === "ASHA") router.replace("/asha")
      else if (role === "DOCTOR") router.replace("/doctor")
      else if (role === "LAB_TECH") router.replace("/lab")
      else if (role === "ADMIN") router.replace("/admin")
      else setError("No role assigned to this user")
    } catch (err) {
      setError("Invalid credentials or missing role")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
