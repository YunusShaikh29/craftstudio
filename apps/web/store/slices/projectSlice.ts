import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import axios from "axios"
import type { Project, CreateProjectResponse } from "@/lib/api/types"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v0"

export interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  isLoading: boolean
  error: string | null
  pendingPrompt: string | null
}

const initialState: ProjectState = {
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,
  pendingPrompt: null,
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
        `${API_URL}/projects`,
        { withCredentials: true }
      )
      return data.projects
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to fetch projects")
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
    setCurrentProject: (state, action: PayloadAction<Project | null>) => {
      state.currentProject = action.payload
    },
    clearError: (state) => {
      state.error = null
    },
  },

  extraReducers: (builder) => {
    // Create Project
    builder
      .addCase(createProjectThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(createProjectThunk.fulfilled, (state, action) => {
        state.isLoading = false
        state.currentProject = action.payload.project
        state.projects.unshift(action.payload.project)
        state.pendingPrompt = null
      })
      .addCase(createProjectThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })

    // Fetch Projects
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
  },
})

export const { setPendingPrompt, setCurrentProject, clearError } = projectSlice.actions
export default projectSlice.reducer

