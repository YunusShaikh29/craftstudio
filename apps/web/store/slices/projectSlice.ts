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

export interface FileEntry {
  path: string
  size: number
  lastModified?: string
}

export interface ProjectState {
  projects: Project[]
  currentProject: ProjectWithDetails | null
  messages: Message[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  pendingPrompt: string | null
  // file browser state
  projectFiles: FileEntry[]
  selectedFilePath: string | null
  selectedFileContent: string | null
  isLoadingFiles: boolean
  isLoadingFileContent: boolean
}

const initialState: ProjectState = {
  projects: [],
  currentProject: null,
  messages: [],
  isLoading: false,
  isSending: false,
  error: null,
  pendingPrompt: null,
  projectFiles: [],
  selectedFilePath: null,
  selectedFileContent: null,
  isLoadingFiles: false,
  isLoadingFileContent: false,
}

export const createProjectThunk = createAsyncThunk(
  "project/create",
  async ({ prompt, type }: { prompt: string; type: "CHAT" | "EDIT" }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post<CreateProjectResponse>(
        `${API_URL}/projects`,
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
        `${API_URL}/projects/getAll`,
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
        `${API_URL}/projects/${projectId}`,
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
        `${API_URL}/projects`,
        { projectId, prompt, type, sandboxId },
        { withCredentials: true }
      )
      return { ...data, prompt, type }
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to send message")
    }
  }
)

export const fetchProjectFilesThunk = createAsyncThunk(
  "project/fetchFiles",
  async (projectId: string, { rejectWithValue }) => {
    try {
      const { data } = await axios.get<{ files: FileEntry[] }>(
        `${API_URL}/projects/${projectId}/files`,
        { withCredentials: true }
      )
      return data.files
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to fetch files")
    }
  }
)

export const fetchFileContentThunk = createAsyncThunk(
  "project/fetchFileContent",
  async (
    { projectId, filePath }: { projectId: string; filePath: string },
    { rejectWithValue }
  ) => {
    try {
      const { data } = await axios.get<{ content: string; path: string }>(
        // filePath already starts without a leading slash from the backend response
        `${API_URL}/projects/${projectId}/files/${filePath}`,
        { withCredentials: true }
      )
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to fetch file content")
    }
  }
)

export const restartPreviewThunk = createAsyncThunk(
  "project/restartPreview",
  async (projectId: string, { rejectWithValue }) => {
    try {
      const { data } = await axios.post<{ message: string; jobId: string }>(
        `${API_URL}/projects/${projectId}/restart-preview`,
        {},
        { withCredentials: true }
      )
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to restart preview")
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
      state.projectFiles = []
      state.selectedFilePath = null
      state.selectedFileContent = null
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

    setSelectedFilePath: (state, action: PayloadAction<string | null>) => {
      state.selectedFilePath = action.payload
      // clear stale content immediately so the editor doesn't flash old code
      state.selectedFileContent = null
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

    builder
      .addCase(fetchProjectFilesThunk.pending, (state) => {
        state.isLoadingFiles = true
      })
      .addCase(fetchProjectFilesThunk.fulfilled, (state, action) => {
        state.isLoadingFiles = false
        state.projectFiles = action.payload
      })
      .addCase(fetchProjectFilesThunk.rejected, (state) => {
        state.isLoadingFiles = false
      })

    builder
      .addCase(fetchFileContentThunk.pending, (state) => {
        state.isLoadingFileContent = true
      })
      .addCase(fetchFileContentThunk.fulfilled, (state, action) => {
        state.isLoadingFileContent = false
        state.selectedFileContent = action.payload.content
        state.selectedFilePath = action.payload.path
      })
      .addCase(fetchFileContentThunk.rejected, (state) => {
        state.isLoadingFileContent = false
        state.selectedFileContent = null
      })

    builder
      .addCase(restartPreviewThunk.pending, (state) => {
        state.isLoading = true
      })
      .addCase(restartPreviewThunk.fulfilled, (state) => {
        state.isLoading = false
        // Preview URL will be updated via WebSocket JOB_COMPLETED event
      })
      .addCase(restartPreviewThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
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
  setSelectedFilePath,
} = projectSlice.actions
export default projectSlice.reducer

