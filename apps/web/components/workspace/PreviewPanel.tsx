"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { useAppSelector, useAppDispatch } from "@/store/hooks"
import { RefreshCw, ExternalLink, AlertTriangle, Loader2, PlayCircle } from "lucide-react"
import { restartPreviewThunk } from "@/store/slices/projectSlice"

type PreviewState = "waiting" | "loading" | "ready" | "error" | "expired"

export function PreviewPanel() {
  const dispatch = useAppDispatch()
  const { previewUrl, jobStatus, lastEvent, activeSandboxId } = useAppSelector(
    (state) => state.websocket
  )
  const { currentProject, isLoading: isRestartingPreview } = useAppSelector((state) => state.project)

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // tracks what the iframe is actually showing right now
  const [previewState, setPreviewState] = useState<PreviewState>("waiting")

  // incremented to force a re-mount of the iframe (hard reload without touching src)
  const [reloadKey, setReloadKey] = useState(0)

  // Check if sandbox is expired (older than 5 minutes)
  const isSandboxExpired = useCallback(() => {
    console.log("[PREVIEW PANEL] Checking if sandbox expired:", {
      currentProject: !!currentProject,
      sandboxSessions: currentProject?.sandboxSession?.length,
      activeSandboxId
    })
    
    if (!currentProject?.sandboxSession || currentProject.sandboxSession.length === 0 || !activeSandboxId) {
      console.log("[PREVIEW PANEL] No sandbox sessions or no active sandbox ID")
      return false
    }
    
    // Find the session by ID (regardless of status)
    const session = currentProject.sandboxSession.find(
      (s) => s.id === activeSandboxId
    )
    
    console.log("[PREVIEW PANEL] Found session:", session)
    
    if (!session) {
      console.log("[PREVIEW PANEL] No matching session found for ID:", activeSandboxId)
      return false
    }
    
    const sandboxAge = Date.now() - new Date(session.startedAt).getTime()
    const FIVE_MINUTES = 5 * 60 * 1000
    const isExpired = sandboxAge > FIVE_MINUTES
    
    console.log("[PREVIEW PANEL] Sandbox age:", {
      ageSeconds: Math.round(sandboxAge / 1000),
      ageMinutes: Math.round(sandboxAge / 60000),
      isExpired,
      status: session.status
    })
    
    return isExpired
  }, [currentProject, activeSandboxId])

  const handleRestartPreview = useCallback(() => {
    if (currentProject?.id) {
      dispatch(restartPreviewThunk(currentProject.id))
    }
  }, [dispatch, currentProject])

  // --- derived state helpers ---

  // no URL yet and the job is still running -> waiting for the sandbox to boot
  const isWaiting = !previewUrl && (jobStatus === "pending" || jobStatus === "running")

  // we have a URL but haven't heard the iframe's onload yet
  const isLoading = !!previewUrl && previewState === "loading"
  
  // Log state changes for debugging
  useEffect(() => {
    console.log("[PREVIEW PANEL] State:", {
      previewUrl,
      activeSandboxId,
      jobStatus,
      previewState,
      isWaiting,
      isLoading
    })
  }, [previewUrl, activeSandboxId, jobStatus, previewState, isWaiting, isLoading])

  const triggerReload = useCallback(() => {
    if (!previewUrl) return
    setPreviewState("loading")
    // bumping the key unmounts and remounts the iframe — the cleanest way to
    // force a full reload since calling iframeRef.current.src = same-url is
    // a no-op in some browsers when the src hasn't changed
    setReloadKey((k) => k + 1)
  }, [previewUrl])

  // when a new previewUrl arrives, transition to loading so the spinner shows
  useEffect(() => {
    if (previewUrl) {
      setPreviewState("loading")
    } else {
      setPreviewState("waiting")
    }
  }, [previewUrl])

  // reload the iframe whenever the worker signals files were written and the
  // preview is already visible — PREVIEW_READY fires after every writeFile too
  useEffect(() => {
    if (
      lastEvent?.event === "PREVIEW_READY" &&
      previewUrl &&
      previewState === "ready"
    ) {
      triggerReload()
    }
  }, [lastEvent, previewUrl, previewState, triggerReload])

  const handleLoad = () => {
    setPreviewState("ready")
  }

  const handleError = () => {
    setPreviewState("error")
  }

  // --- render states ---

  // Check if sandbox is expired but we still have session data
  // Show restart button even if previewUrl is null (sandbox might have expired before preview was set)
  if (activeSandboxId && isSandboxExpired() && !isRestartingPreview && !isWaiting) {
    console.log("[PREVIEW PANEL] Showing expired sandbox UI")
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <AlertTriangle className="w-8 h-8 text-yellow-500" />
        <p className="text-sm font-medium">Preview Expired</p>
        <p className="text-xs opacity-60 text-center max-w-sm">
          Sandboxes expire after 5 minutes. Click below to restart without using AI credits.
        </p>
        <button
          onClick={handleRestartPreview}
          disabled={isRestartingPreview}
          className="mt-2 flex items-center gap-2 px-4 py-2 bg-[var(--color-pink)] hover:bg-[var(--color-pink)]/80 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {isRestartingPreview ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Restarting...</span>
            </>
          ) : (
            <>
              <PlayCircle className="w-4 h-4" />
              <span>Restart Preview</span>
            </>
          )}
        </button>
      </div>
    )
  }

  if (isWaiting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-pink)]" />
        <p className="text-sm">Waiting for sandbox preview…</p>
        <p className="text-xs opacity-60">
          The dev server starts when the agent begins running.
        </p>
      </div>
    )
  }

  if (!previewUrl) {
    // idle — no job has run yet for this session
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
        <p className="text-sm">No preview available yet.</p>
        <p className="text-xs opacity-60">
          Send a message to generate your app.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* toolbar */}
      <div className="h-9 border-b border-[var(--color-deep-plum)]/30 flex items-center px-3 gap-2 shrink-0">
        {/* url pill */}
        <div className="flex-1 bg-[var(--color-charcoal)] border border-[var(--color-deep-plum)]/40 rounded px-2 py-0.5 truncate">
          <span className="text-xs text-[var(--color-muted)] font-mono truncate">
            {previewUrl}
          </span>
        </div>

        <button
          onClick={triggerReload}
          title="Refresh preview"
          className="p-1.5 rounded hover:bg-[var(--color-deep-plum)]/30 text-[var(--color-muted)] hover:text-[var(--color-soft-white)] transition-colors"
        >
          {/* spin the icon while loading */}
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </button>

        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in new tab"
          className="p-1.5 rounded hover:bg-[var(--color-deep-plum)]/30 text-[var(--color-muted)] hover:text-[var(--color-soft-white)] transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* iframe area */}
      <div className="flex-1 relative min-h-0">
        {/* loading overlay — sits on top of the iframe until it fires onLoad */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-charcoal)] text-[var(--color-muted)]">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-pink)]" />
            <p className="text-sm">Loading preview…</p>
          </div>
        )}

        {/* error overlay */}
        {previewState === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-charcoal)] text-[var(--color-muted)]">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <p className="text-sm text-red-400">Preview failed to load.</p>
            <button
              onClick={triggerReload}
              className="text-xs underline hover:text-[var(--color-soft-white)] transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* key prop forces a full remount on reload — avoids stale iframe cache */}
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={previewUrl}
          onLoad={handleLoad}
          onError={handleError}
          className="w-full h-full border-0"
          // sandbox flags: allow scripts and same-origin so the Vite app works,
          // but block top-level navigation so the app can't redirect out of the pane
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          title="App preview"
        />
      </div>
    </div>
  )
}
