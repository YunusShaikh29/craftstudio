"use client"

import { useState } from "react"
import { Textarea } from "@workspace/ui/components/textarea"
import { Button } from "@workspace/ui/components/button"
import { ArrowUp, MessageSquare, Pencil } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

interface ChatInputProps {
  onSubmit: (prompt: string, type: "CHAT" | "EDIT") => void
  isDisabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSubmit, isDisabled, placeholder }: ChatInputProps) {
  const [prompt, setPrompt] = useState("")
  const [mode, setMode] = useState<"EDIT" | "CHAT">("EDIT")

  const handleSubmit = () => {
    if (!prompt.trim() || isDisabled) return
    onSubmit(prompt.trim(), mode)
    setPrompt("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-[var(--color-deep-plum)]/30 bg-[var(--color-charcoal)]/80 p-4">

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setMode("EDIT")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
            mode === "EDIT"
              ? "bg-[var(--color-warm-red)]/20 text-[var(--color-warm-red)] border border-[var(--color-warm-red)]/50"
              : "text-[var(--color-muted)] hover:text-[var(--color-soft-white)] hover:bg-[var(--color-charcoal)]"
          )}
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
        <button
          onClick={() => setMode("CHAT")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
            mode === "CHAT"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/50"
              : "text-[var(--color-muted)] hover:text-[var(--color-soft-white)] hover:bg-[var(--color-charcoal)]"
          )}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Ask
        </button>
      </div>


      <div className="relative">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ||
            (mode === "EDIT"
              ? "Describe the changes you want to make..."
              : "Ask a question about your code...")
          }
          disabled={isDisabled}
          className="min-h-[80px] max-h-[200px] resize-none bg-[var(--color-charcoal)] border-[var(--color-deep-plum)]/50 text-[var(--color-soft-white)] placeholder:text-[var(--color-muted)] focus-visible:ring-[var(--color-pink)]/50 pr-14 text-sm"
        />

        <div className="absolute bottom-2 right-2">
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!prompt.trim() || isDisabled}
            className={cn(
              "rounded-full h-9 w-9 transition-colors",
              mode === "EDIT"
                ? "bg-[var(--color-warm-red)] hover:bg-[var(--color-warm-red)]/90"
                : "bg-blue-500 hover:bg-blue-600",
              "text-white disabled:opacity-50"
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isDisabled && (
        <p className="text-xs text-[var(--color-muted)] mt-2">
          Processing your request...
        </p>
      )}
    </div>
  )
}





