"use client"

import type { Message } from "@/lib/api/types"
import { cn } from "@workspace/ui/lib/utils"
import { User, Bot } from "lucide-react"

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "USER"

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-xl",
        isUser
          ? "bg-[var(--color-deep-plum)]/30 ml-8"
          : "bg-[var(--color-charcoal)]/50 mr-8"
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser
            ? "bg-[var(--color-pink)]/20 text-[var(--color-pink)]"
            : "bg-[var(--color-soft-white)]/10 text-[var(--color-soft-white)]"
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[var(--color-soft-white)]">
            {isUser ? "You" : "Assistant"}
          </span>
          {message.type === "EDIT" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-warm-red)]/20 text-[var(--color-warm-red)]">
              edit
            </span>
          )}
          {message.type === "CHAT" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              chat
            </span>
          )}
        </div>

        <div className="text-[var(--color-soft-white)]/90 whitespace-pre-wrap break-words">
          {message.content}
        </div>

        <div className="mt-2 text-xs text-[var(--color-muted)]">
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}





