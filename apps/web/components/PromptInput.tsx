"use client"

import { useState } from "react"
import { Textarea } from "@workspace/ui/components/textarea"
import { Button } from "@workspace/ui/components/button"
import { ArrowUp } from "lucide-react"

interface PromptInputProps {
  onSubmit: (prompt: string) => void
  isLoading?: boolean
  placeholder?: string
}

export function PromptInput({ onSubmit, isLoading, placeholder }: PromptInputProps) {
  const [prompt, setPrompt] = useState("")

  const handleSubmit = () => {
    if (!prompt.trim() || isLoading) return
    onSubmit(prompt.trim())
    setPrompt("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="relative bg-[var(--color-charcoal)] rounded-2xl border border-[var(--color-deep-plum)]/50 shadow-2xl">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Describe the app you want to build..."}
          disabled={isLoading}
          className="min-h-[120px] max-h-[300px] resize-none bg-transparent border-0 text-[var(--color-soft-white)] placeholder:text-[var(--color-muted)] focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pr-14 text-base"
        />
        
        <div className="absolute bottom-3 right-3">
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading}
            className="rounded-full bg-[var(--color-soft-white)] text-[var(--color-charcoal)] hover:bg-[var(--color-soft-white)]/90 disabled:opacity-50 h-10 w-10"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

