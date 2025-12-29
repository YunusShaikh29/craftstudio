"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAppDispatch, useAppSelector } from "@/store/hooks"
import { fetchProjectThunk, clearCurrentProject, addMessage } from "@/store/slices/projectSlice"
import { resetJobState } from "@/store/slices/websocketSlice"
import { useProjectWebSocket } from "@/hooks/useProjectWebSocket"
import { ChatInterface } from "@/components/chat/ChatInterface"
import { Loader2, ArrowLeft, Code, Eye } from "lucide-react"
import Link from "next/link"
import type { Message } from "@/lib/api/types"

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const dispatch = useAppDispatch()
  const projectId = params.id as string

  const { isAuthenticated, isLoading: authLoading } = useAppSelector(
    (state) => state.auth
  )
  const { currentProject, isLoading, error } = useAppSelector(
    (state) => state.project
  )
  const { lastEvent, jobStatus, activeSandboxId } = useAppSelector(
    (state) => state.websocket
  )

  // Connect to WebSocket for this project
  const { isConnected } = useProjectWebSocket({
    projectId,
    enabled: !!projectId && isAuthenticated,
  })

  // Fetch project details on mount
  useEffect(() => {
    if (projectId && isAuthenticated) {
      dispatch(fetchProjectThunk(projectId))
    }

    return () => {
      dispatch(clearCurrentProject())
      dispatch(resetJobState())
    }
  }, [projectId, isAuthenticated, dispatch])

  // Handle JOB_COMPLETED event - refetch to get the assistant message
  useEffect(() => {
    if (lastEvent?.event === "JOB_COMPLETED" && projectId) {
      // Refetch project to get the new assistant message
      dispatch(fetchProjectThunk(projectId))
    }
  }, [lastEvent, projectId, dispatch])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/")
    }
  }, [authLoading, isAuthenticated, router])

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-charcoal)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-pink)]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-charcoal)] flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error}</p>
        <Link
          href="/"
          className="text-[var(--color-pink)] hover:underline flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[var(--color-charcoal)] flex flex-col relative ">
      <header className="h-12 border-b border-[var(--color-deep-plum)]/30 flex items-center px-4 bg-[var(--color-charcoal)] sticky top-0 z-10">
        <Link
          href="/"
          className="flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-soft-white)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </Link>

        <div className="flex-1 flex items-center justify-center">
          <h1 className="text-sm font-medium text-[var(--color-soft-white)] truncate max-w-md">
            {currentProject?.name || "Loading..."}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-yellow-500 animate-pulse"
              }`}
            title={isConnected ? "Connected" : "Connecting..."}
          />
        </div>
      </header>

      <main className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-[400px] min-w-[350px] max-w-[500px] border-r border-[var(--color-deep-plum)]/30 flex flex-col bg-[var(--color-charcoal)]/50 min-h-0">
          <ChatInterface projectId={projectId} />
        </div>

        <div className="flex-1 flex flex-col bg-[var(--color-charcoal)] min-h-0">
          <div className="h-10 border-b border-[var(--color-deep-plum)]/30 flex items-center px-2 gap-1">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[var(--color-deep-plum)]/30 text-[var(--color-soft-white)]">
              <Code className="w-3.5 h-3.5" />
              Code
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-[var(--color-muted)] hover:text-[var(--color-soft-white)] hover:bg-[var(--color-charcoal)]">
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">

            <div className="min-h-full flex items-center justify-center">
              <div className="text-center p-8">
                <Code className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
                <h2 className="text-lg font-medium text-[var(--color-soft-white)] mb-2">
                  Code Editor Coming Soon
                </h2>
                <p className="text-sm text-[var(--color-muted)] max-w-md">
                  The code editor and preview will be available here. For now,
                  use the chat to interact with your project.
                </p>
                {activeSandboxId && (
                  <p className="text-xs text-[var(--color-muted)] mt-4">
                    Active Sandbox: {activeSandboxId}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}