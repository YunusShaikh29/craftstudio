import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import axios from "axios"
import type {
  Project,
  CreateProjectResponse,
  GetProjectResponse,
  Message,
  ProjectWithDetails,
} from "@/lib/api/types"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v0"

export interface ProjectState {
  projects: Project[]
  currentProject: ProjectWithDetails | null
  messages: Message[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  pendingPrompt: string | null
}

const initialState: ProjectState = {
  projects: [],
  currentProject: null,
  messages: [],
  isLoading: false,
  isSending: false,
  error: null,
  pendingPrompt: null,
}

export const createProjectThunk = createAsyncThunk(
  "project/create",
  async ({ prompt, type }: { prompt: string; type: "CHAT" | "EDIT" }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post<CreateProjectResponse>(
        `${API_URL}/api/v0/projects`,
        { prompt, type },
        { withCredentials: true }
      )
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to create project")
    }
  }
)

export const fetchProjectsThunk = createAsyncThunk(
  "project/fetchAll",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get<{ projects: Project[] }>(
        `${API_URL}/api/v0/projects/getAll`,
        { withCredentials: true }
      )
      return data.projects
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to fetch projects")
    }
  }
)

export const fetchProjectThunk = createAsyncThunk(
  "project/fetchOne",
  async (projectId: string, { rejectWithValue }) => {
    try {
      const { data } = await axios.get<GetProjectResponse>(
        `${API_URL}/api/v0/projects/${projectId}`,
        { withCredentials: true }
      )
      return data.project
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to fetch project")
    }
  }
)

// Send a message to an existing project
export const sendMessageThunk = createAsyncThunk(
  "project/sendMessage",
  async (
    {
      projectId,
      prompt,
      type,
      sandboxId,
    }: {
      projectId: string
      prompt: string
      type: "CHAT" | "EDIT"
      sandboxId?: string | null
    },
    { rejectWithValue }
  ) => {
    try {
      const { data } = await axios.post<CreateProjectResponse>(
        `${API_URL}/api/v0/projects`,
        { projectId, prompt, type, sandboxId },
        { withCredentials: true }
      )
      return { ...data, prompt, type }
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to send message")
    }
  }
)

const projectSlice = createSlice({
  name: "project",
  initialState,

  reducers: {
    setPendingPrompt: (state, action: PayloadAction<string | null>) => {
      state.pendingPrompt = action.payload
    },
    setCurrentProject: (state, action: PayloadAction<ProjectWithDetails | null>) => {
      state.currentProject = action.payload
      state.messages = action.payload?.messages || []
    },
    clearError: (state) => {
      state.error = null
    },
    clearCurrentProject: (state) => {
      state.currentProject = null
      state.messages = []
    },
    // Add a message to the current conversation (for optimistic UI or WS updates)
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload)
    },
    // Update project status (from WebSocket events)
    updateProjectStatus: (
      state,
      action: PayloadAction<{ status: Project["status"] }>
    ) => {
      if (state.currentProject) {
        state.currentProject.status = action.payload.status
      }
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(createProjectThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(createProjectThunk.fulfilled, (state, action) => {
        state.isLoading = false
        // Add to projects list
        state.projects.unshift(action.payload.project)
        state.pendingPrompt = null
      })
      .addCase(createProjectThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })

    builder
      .addCase(fetchProjectsThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(fetchProjectsThunk.fulfilled, (state, action) => {
        state.isLoading = false
        state.projects = action.payload
      })
      .addCase(fetchProjectsThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })

    builder
      .addCase(fetchProjectThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(fetchProjectThunk.fulfilled, (state, action) => {
        state.isLoading = false
        state.currentProject = action.payload
        state.messages = action.payload.messages || []
      })
      .addCase(fetchProjectThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })

    // Send Message/editing or asking in the project
    builder
      .addCase(sendMessageThunk.pending, (state, action) => {
        state.isSending = true
        state.error = null
        // Optimistically add user message
        const tempMessage: Message = {
          id: `temp-${Date.now()}`,
          projectId: action.meta.arg.projectId,
          role: "USER",
          type: action.meta.arg.type,
          content: action.meta.arg.prompt,
          parentMessageId: null,
          toolCalls: null,
          createdAt: new Date().toISOString(),
        }
        state.messages.push(tempMessage)
      })
      .addCase(sendMessageThunk.fulfilled, (state) => {
        state.isSending = false
        // The actual message is already added optimistically
        // WebSocket will provide updates as the job progresses
      })
      .addCase(sendMessageThunk.rejected, (state, action) => {
        state.isSending = false
        state.error = action.payload as string
        // Remove the optimistic message on failure
        state.messages = state.messages.filter(
          (msg) => !msg.id.startsWith("temp-")
        )
      })
  },
})

export const {
  setPendingPrompt,
  setCurrentProject,
  clearError,
  clearCurrentProject,
  addMessage,
  updateProjectStatus,
} = projectSlice.actions
export default projectSlice.reducer

