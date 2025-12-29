import { createSlice, PayloadAction } from "@reduxjs/toolkit"
import type { WebSocketEvent } from "@/lib/api/types"

export type JobStatus = "idle" | "pending" | "running" | "completed" | "failed"

export interface ActiveTool {
  toolCallId: string
  toolName: string
  startTime: number
}

export interface WebSocketState {
  connected: boolean
  projectId: string | null
  currentJobId: string | null
  jobStatus: JobStatus
  activeSandboxId: string | null
  activeTools: ActiveTool[]
  lastEvent: WebSocketEvent | null
  changedFiles: string[]
  error: string | null
}

const initialState: WebSocketState = {
  connected: false,
  projectId: null,
  currentJobId: null,
  jobStatus: "idle",
  activeSandboxId: null,
  activeTools: [],
  lastEvent: null,
  changedFiles: [],
  error: null,
}

const websocketSlice = createSlice({
  name: "websocket",
  initialState,

  reducers: {
    wsConnected: (state, action: PayloadAction<{ projectId: string }>) => {
      state.connected = true
      state.projectId = action.payload.projectId
      state.error = null
    },

    wsDisconnected: (state) => {
      state.connected = false
    },

    wsEventReceived: (state, action: PayloadAction<WebSocketEvent>) => {
      const event = action.payload
      state.lastEvent = event

      switch (event.event) {
        case "JOB_STARTED":
          state.currentJobId = event.jobId
          state.jobStatus = "running"
          state.error = null
          state.changedFiles = []
          break

        case "SANDBOX_CREATED":
          state.activeSandboxId = event.sandboxId
          break

        case "SANDBOX_RECONNECTED":
          state.activeSandboxId = event.sandboxId
          break

        case "TOOL_CALL_START":
          state.activeTools.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            startTime: Date.now(),
          })
          break

        case "TOOL_CALL_END":
          state.activeTools = state.activeTools.filter(
            (tool) => tool.toolCallId !== event.toolCallId
          )
          break

        case "FILE_UPDATED":
          if (!state.changedFiles.includes(event.path)) {
            state.changedFiles.push(event.path)
          }
          break

        case "FILES_SYNCED":
          // Files are synced to S3, could trigger a refresh
          break

        case "CHANGESET_CREATED":
          // ChangeSet was created
          break

        case "JOB_COMPLETED":
          state.jobStatus = "completed"
          state.activeTools = []
          break

        case "JOB_FAILED":
          state.jobStatus = "failed"
          state.error = event.error
          state.activeTools = []
          break
      }
    },

    resetJobState: (state) => {
      state.currentJobId = null
      state.jobStatus = "idle"
      state.activeTools = []
      state.changedFiles = []
      state.error = null
    },

    setJobPending: (state, action: PayloadAction<string>) => {
      state.currentJobId = action.payload
      state.jobStatus = "pending"
    },

    clearSandboxId: (state) => {
      state.activeSandboxId = null
    },
  },
})

export const {
  wsConnected,
  wsDisconnected,
  wsEventReceived,
  resetJobState,
  setJobPending,
  clearSandboxId,
} = websocketSlice.actions

export default websocketSlice.reducer





