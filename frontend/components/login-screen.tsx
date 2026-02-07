"use client"

import React from "react"

import { useState } from "react"
import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Activity } from "lucide-react"
import { LanguageSwitcher } from "./language-switcher"

interface LoginScreenProps {
  onLogin: (ashaId: string) => void
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const { t } = useLanguage()
  const [ashaId, setAshaId] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (ashaId && password) {
      onLogin(ashaId)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg text-foreground">{t.appName}</span>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Activity className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">{t.appName}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t.login}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="ashaId" className="text-foreground font-medium">
                  {t.ashaId}
                </Label>
                <Input
                  id="ashaId"
                  type="text"
                  placeholder="ASHA-12345"
                  value={ashaId}
                  onChange={(e) => setAshaId(e.target.value)}
                  className="h-12 text-base"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground font-medium">
                  {t.password}
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-base"
                  required
                />
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-semibold"
                size="lg"
              >
                {t.loginButton}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
