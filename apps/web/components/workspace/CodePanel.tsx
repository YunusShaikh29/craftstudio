"use client"

import { useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import { useAppDispatch, useAppSelector } from "@/store/hooks"
import {
  fetchProjectFilesThunk,
  fetchFileContentThunk,
  setSelectedFilePath,
} from "@/store/slices/projectSlice"
import { FileText, Loader2, ChevronRight } from "lucide-react"

// Monaco ships a large bundle; load it only on the client side
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false }
)

interface CodePanelProps {
  projectId: string
}

// derive a Monaco language id from a file extension
function getLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
  }
  return map[ext] ?? "plaintext"
}

// group flat file paths into a tree structure so we can render folders
interface TreeNode {
  name: string
  fullPath: string
  isFile: boolean
  children: Record<string, TreeNode>
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", isFile: false, children: {} }
  for (const p of paths) {
    const parts = p.split("/")
    let node = root
    parts.forEach((part, i) => {
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          isFile: i === parts.length - 1,
          children: {},
        }
      }
      node = node.children[part]
    })
  }
  return root
}

export function CodePanel({ projectId }: CodePanelProps) {
  const dispatch = useAppDispatch()
  const { projectFiles, selectedFilePath, selectedFileContent, isLoadingFiles, isLoadingFileContent } =
    useAppSelector((state) => state.project)
  const { changedFiles, lastEvent } = useAppSelector((state) => state.websocket)

  // fetch file list on mount
  useEffect(() => {
    if (projectId) {
      dispatch(fetchProjectFilesThunk(projectId))
    }
  }, [projectId, dispatch])

  // re-fetch file list when a job finishes so newly created files appear
  useEffect(() => {
    if (lastEvent?.event === "JOB_COMPLETED" && projectId) {
      dispatch(fetchProjectFilesThunk(projectId))
    }
  }, [lastEvent, projectId, dispatch])

  const handleSelectFile = useCallback(
    (filePath: string) => {
      dispatch(setSelectedFilePath(filePath))
      dispatch(fetchFileContentThunk({ projectId, filePath }))
    },
    [dispatch, projectId]
  )

  const fileTree = buildTree(projectFiles.map((f) => f.path))
  const changedSet = new Set(changedFiles)

  return (
    <div className="flex-1 flex min-h-0">
      {/* file tree sidebar */}
      <div className="w-56 shrink-0 border-r border-[var(--color-deep-plum)]/30 overflow-y-auto bg-[var(--color-charcoal)]/60">
        <div className="px-3 py-2 text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">
          Files
        </div>

        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-muted)]" />
          </div>
        ) : projectFiles.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
            No files yet.
          </p>
        ) : (
          <TreeChildren
            nodes={fileTree.children}
            depth={0}
            selectedFilePath={selectedFilePath}
            changedSet={changedSet}
            onSelect={handleSelectFile}
          />
        )}
      </div>

      {/* editor area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* tab-style header for the open file */}
        {selectedFilePath && (
          <div className="h-8 border-b border-[var(--color-deep-plum)]/30 flex items-center px-3 gap-2 shrink-0 bg-[var(--color-charcoal)]/80">
            <FileText className="w-3.5 h-3.5 text-[var(--color-muted)]" />
            <span className="text-xs text-[var(--color-soft-white)] font-mono">
              {selectedFilePath}
            </span>
            {/* dot to indicate this file changed in the last job */}
            {changedSet.has(selectedFilePath) && (
              <span
                className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-pink)] shrink-0"
                title="Modified in last job"
              />
            )}
          </div>
        )}

        {isLoadingFileContent ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
          </div>
        ) : selectedFileContent !== null ? (
          <div className="flex-1 min-h-0">
            <MonacoEditor
              height="100%"
              language={getLanguage(selectedFilePath ?? "")}
              value={selectedFileContent}
              theme="vs-dark"
              options={{
                readOnly: true,
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                // hide the read-only overlay message Monaco shows by default
                readOnlyMessage: { value: "" },
                renderLineHighlight: "none",
              }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
            <FileText className="w-8 h-8 opacity-30" />
            <p className="text-sm">Select a file to view its contents.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// --- recursive tree renderer ---

interface TreeChildrenProps {
  nodes: Record<string, TreeNode>
  depth: number
  selectedFilePath: string | null
  changedSet: Set<string>
  onSelect: (path: string) => void
}

function TreeChildren({ nodes, depth, selectedFilePath, changedSet, onSelect }: TreeChildrenProps) {
  const sorted = Object.values(nodes).sort((a, b) => {
    // directories first, then files, both alphabetically
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {sorted.map((node) =>
        node.isFile ? (
          <FileRow
            key={node.fullPath}
            node={node}
            depth={depth}
            isSelected={selectedFilePath === node.fullPath}
            isChanged={changedSet.has(node.fullPath)}
            onSelect={onSelect}
          />
        ) : (
          <FolderRow
            key={node.fullPath}
            node={node}
            depth={depth}
            selectedFilePath={selectedFilePath}
            changedSet={changedSet}
            onSelect={onSelect}
          />
        )
      )}
    </>
  )
}

function FileRow({
  node,
  depth,
  isSelected,
  isChanged,
  onSelect,
}: {
  node: TreeNode
  depth: number
  isSelected: boolean
  isChanged: boolean
  onSelect: (path: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(node.fullPath)}
      className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-left text-xs transition-colors ${
        isSelected
          ? "bg-[var(--color-deep-plum)]/50 text-[var(--color-soft-white)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-soft-white)] hover:bg-[var(--color-deep-plum)]/20"
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <FileText className="w-3 h-3 shrink-0" />
      <span className="truncate">{node.name}</span>
      {/* orange dot for files changed in the current job */}
      {isChanged && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-pink)] shrink-0" />
      )}
    </button>
  )
}

function FolderRow({
  node,
  depth,
  selectedFilePath,
  changedSet,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selectedFilePath: string | null
  changedSet: Set<string>
  onSelect: (path: string) => void
}) {
  // folders are always expanded — collapsible tree is out of scope for now
  return (
    <>
      <div
        className="flex items-center gap-1 px-2 py-0.5 text-xs text-[var(--color-muted)]"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="truncate font-medium">{node.name}</span>
      </div>
      <TreeChildren
        nodes={node.children}
        depth={depth + 1}
        selectedFilePath={selectedFilePath}
        changedSet={changedSet}
        onSelect={onSelect}
      />
    </>
  )
}
