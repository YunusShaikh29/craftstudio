"use client"

import { useAppSelector } from "@/store/hooks"
import { Loader2, CheckCircle, XCircle, Wrench } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

export function JobStatus() {
  const { jobStatus, activeTools, error, connected } = useAppSelector(
    (state) => state.websocket
  )

  if (jobStatus === "idle" && !activeTools.length) {
    return null
  }

  return (
    <div className="px-4 py-2 border-b border-[var(--color-deep-plum)]/30 bg-[var(--color-charcoal)]/50">
      {!connected && (
        <div className="flex items-center gap-2 text-yellow-500 text-sm mb-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Reconnecting to server...</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {jobStatus === "pending" && (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-muted)]" />
            <span className="text-sm text-[var(--color-muted)]">
              Job queued...
            </span>
          </>
        )}

        {jobStatus === "running" && (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-pink)]" />
            <span className="text-sm text-[var(--color-soft-white)]">
              Processing...
            </span>
          </>
        )}

        {jobStatus === "completed" && (
          <>
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-500">Completed</span>
          </>
        )}

        {jobStatus === "failed" && (
          <>
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm text-red-500">
              Failed: {error || "Unknown error"}
            </span>
          </>
        )}
      </div>

      {activeTools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeTools.map((tool) => (
            <div
              key={tool.toolCallId}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs",
                "bg-[var(--color-deep-plum)]/30 text-[var(--color-soft-white)]"
              )}
            >
              <Wrench className="w-3 h-3 animate-pulse" />
              <span>{tool.toolName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}





