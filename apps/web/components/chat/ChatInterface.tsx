"use client"

import { useEffect, useRef } from "react"
import { useAppSelector, useAppDispatch } from "@/store/hooks"
import { sendMessageThunk } from "@/store/slices/projectSlice"
import { setJobPending } from "@/store/slices/websocketSlice"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { JobStatus } from "./JobStatus"

interface ChatInterfaceProps {
  projectId: string
}

export function ChatInterface({ projectId }: ChatInterfaceProps) {
  const dispatch = useAppDispatch()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { messages, isSending, currentProject } = useAppSelector(
    (state) => state.project
  )
  const { jobStatus, activeSandboxId } = useAppSelector(
    (state) => state.websocket
  )

  console.log("Active sandbox Id", activeSandboxId)

  const isProcessing = isSending || jobStatus === "running" || jobStatus === "pending"

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSendMessage = async (prompt: string, type: "CHAT" | "EDIT") => {
    const result = await dispatch(
      sendMessageThunk({
        projectId,
        prompt,
        type,
        sandboxId: activeSandboxId,
      })
    )

    if (sendMessageThunk.fulfilled.match(result)) {
      dispatch(setJobPending(result.payload.jobId))
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-[var(--color-deep-plum)]/30 bg-[var(--color-charcoal)]/80">
        <h1 className="text-lg font-semibold text-[var(--color-soft-white)] truncate">
          {currentProject?.name || "Project"}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              currentProject?.status === "BUILDING"
                ? "bg-yellow-500/20 text-yellow-400"
                : currentProject?.status === "ACTIVE"
                  ? "bg-green-500/20 text-green-400"
                  : currentProject?.status === "FAILED"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-gray-500/20 text-gray-400"
            }`}
          >
            {currentProject?.status?.toLowerCase() || "loading"}
          </span>
          {activeSandboxId && (
            <span className="text-xs text-[var(--color-muted)]">
              Sandbox: {activeSandboxId.slice(0, 8)}...
            </span>
          )}
        </div>
      </div>

      <JobStatus />

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--color-muted)] text-center">
              No messages yet. Start by describing what you want to build!
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSubmit={handleSendMessage}
        isDisabled={isProcessing}
        placeholder={
          isProcessing
            ? "Processing..."
            : "Describe what you want to build or change..."
        }
      />
    </div>
  )
}





