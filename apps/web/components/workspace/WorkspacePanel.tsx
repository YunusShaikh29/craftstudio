"use client"

import { useState, useEffect } from "react"
import { Code, Eye } from "lucide-react"
import { PreviewPanel } from "./PreviewPanel"
import { CodePanel } from "./CodePanel"

type Tab = "code" | "preview"

interface WorkspacePanelProps {
  projectId: string
}

// sessionStorage key is scoped to the project so switching projects doesn't
// restore the wrong tab
function tabKey(projectId: string) {
  return `workspace-tab:${projectId}`
}

export function WorkspacePanel({ projectId }: WorkspacePanelProps) {
  // initialise from sessionStorage so the tab survives a page refresh within
  // the same browser tab, but resets when the tab is closed
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "code"
    return (sessionStorage.getItem(tabKey(projectId)) as Tab) ?? "code"
  })

  // persist whenever the user switches tabs
  useEffect(() => {
    sessionStorage.setItem(tabKey(projectId), activeTab)
  }, [activeTab, projectId])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* tab bar */} 
      <div className="h-10 border-b border-[var(--color-deep-plum)]/30 flex items-center px-2 gap-1 shrink-0">
        <TabButton
          icon={<Code className="w-3.5 h-3.5" />}
          label="Code"
          active={activeTab === "code"}
          onClick={() => setActiveTab("code")}
        />
        <TabButton
          icon={<Eye className="w-3.5 h-3.5" />}
          label="Preview"
          active={activeTab === "preview"}
          onClick={() => setActiveTab("preview")}
        />
      </div>

      {/* panel area — both panels are mounted so the iframe doesn't reload on
          every tab switch; the inactive one is just hidden with CSS */}
      <div className="flex-1 flex min-h-0 relative">
        <div
          className={`absolute inset-0 flex flex-col ${activeTab === "code" ? "visible" : "invisible pointer-events-none"}`}
          aria-hidden={activeTab !== "code"}
        >
          <CodePanel projectId={projectId} />
        </div>

        <div
          className={`absolute inset-0 flex flex-col ${activeTab === "preview" ? "visible" : "invisible pointer-events-none"}`}
          aria-hidden={activeTab !== "preview"}
        >
          <PreviewPanel />
        </div>
      </div>
    </div>
  )
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-[var(--color-deep-plum)]/40 text-[var(--color-soft-white)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-soft-white)] hover:bg-[var(--color-charcoal)]"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
