// User type matching backend response
export interface User {
  id: string
  email: string
  name: string | null
}

export interface SigninResponse {
  message: string
}

export interface GetMeResponse {
  user: User
}

export interface LogoutResponse {
  message: string
}

// Project types
export interface Project {
  id: string
  name: string
  description: string | null
  userId: string
  s3basePath: string
  status: "ACTIVE" | "BUILDING" | "ARCHIVED" | "FAILED"
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  projectId: string
  role: "USER" | "ASSISTANT"
  content: string
  type: "CHAT" | "EDIT"
  parentMessageId: string | null
  toolCalls: any | null
  createdAt: string
}

export interface Job {
  id: string
  projectId: string
  type: "PROMPT" | "DEPLOY" | "BUILD"
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

export interface SandboxSession {
  id: string
  templateId: string
  projectId: string
  status: "ACTIVE" | "EXPIRED" | "FAILED" | "COMPLETED"
  startedAt: string
  endedAt: string | null
}

export interface ChangeSet {
  id: string
  projectId: string
  jobId: string
  message: string
  createdAt: string
}

export interface ProjectWithDetails extends Project {
  messages: Message[]
  jobs: Job[]
  sandboxSession: SandboxSession[]
  changeSets: ChangeSet[]
}

export interface CreateProjectResponse {
  message: string
  project: Project
  jobId: string
}

export interface GetProjectResponse {
  project: ProjectWithDetails
}

// WebSocket event types
export type WebSocketEventType =
  | "JOB_STARTED"
  | "SANDBOX_CREATED"
  | "SANDBOX_RECONNECTED"
  | "TOOL_CALL_START"
  | "TOOL_CALL_END"
  | "FILE_UPDATED"
  | "FILES_SYNCED"
  | "CHANGESET_CREATED"
  | "JOB_COMPLETED"
  | "JOB_FAILED"

export interface WSJobStarted {
  event: "JOB_STARTED"
  jobId: string
}

export interface WSSandboxCreated {
  event: "SANDBOX_CREATED"
  sandboxId: string
  jobId: string
  createDuration: number
  populateDuration: number
}

export interface WSSandboxReconnected {
  event: "SANDBOX_RECONNECTED"
  sandboxId: string
  jobId: string
  duration: number
}

export interface WSToolCallStart {
  event: "TOOL_CALL_START"
  toolName: string
  toolCallId: string
}

export interface WSToolCallEnd {
  event: "TOOL_CALL_END"
  toolCallId: string
  duration: number
}

export interface WSFileUpdated {
  event: "FILE_UPDATED"
  path: string
  isNew: boolean
}

export interface WSFilesSynced {
  event: "FILES_SYNCED"
  jobId: string
  duration: number
}

export interface WSChangeSetCreated {
  event: "CHANGESET_CREATED"
  jobId: string
  changedFilesCount: number
  changeSetId: string
}

export interface WSJobCompleted {
  event: "JOB_COMPLETED"
  jobId: string
  duration: number
}

export interface WSJobFailed {
  event: "JOB_FAILED"
  jobId: string
  error: string
  duration: number
}

export type WebSocketEvent =
  | WSJobStarted
  | WSSandboxCreated
  | WSSandboxReconnected
  | WSToolCallStart
  | WSToolCallEnd
  | WSFileUpdated
  | WSFilesSynced
  | WSChangeSetCreated
  | WSJobCompleted
  | WSJobFailed

// Error response
export interface ApiError {
  error: string
}

