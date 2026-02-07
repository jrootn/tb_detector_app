"use client"

import { useLanguage } from "@/lib/language-context"
import { Button } from "@/components/ui/button"
import { Languages } from "lucide-react"

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage()

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <Button
        variant={language === "en" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLanguage("en")}
        className="h-8 px-3 text-sm font-medium"
      >
        <Languages className="h-4 w-4 mr-1.5" />
        ENG
      </Button>
      <Button
        variant={language === "hi" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLanguage("hi")}
        className="h-8 px-3 text-sm font-medium"
      >
        हिन्दी
      </Button>
    </div>
  )
}
