import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import axios from "axios"
import type { User } from "@/lib/api/types"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v0"

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  error: null,
  isLoading: false,
}


export const loginThunk = createAsyncThunk(
  "auth/login",
  async (email: string, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${API_URL}/auth/signin`, { email }, { withCredentials: true })
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to send magic link")
    }
  }
)

export const getMeThunk = createAsyncThunk(
  "auth/getMe",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/auth/me`, { withCredentials: true })
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Not authenticated")
    }
  }
)

export const logoutThunk = createAsyncThunk(
  "auth/logout",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true })
      return data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.error || "Failed to logout")
    }
  }
)

const authSlice = createSlice({
  name: "auth",
  initialState,
  
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload
      state.isAuthenticated = true
      state.error = null
    },
    clearUser: (state) => {
      state.user = null
      state.isAuthenticated = false
      state.error = null
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    clearError: (state) => {
      state.error = null
    },
  },
  
  extraReducers: (builder) => {
    // Login
    builder
      .addCase(loginThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(loginThunk.fulfilled, (state) => {
        state.isLoading = false
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })
    
    // GetMe
    builder
      .addCase(getMeThunk.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(getMeThunk.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload.user
        state.isAuthenticated = true
      })
      .addCase(getMeThunk.rejected, (state) => {
        state.isLoading = false
        state.user = null
        state.isAuthenticated = false
      })
    
    // Logout
    builder
      .addCase(logoutThunk.pending, (state) => {
        state.isLoading = true
      })
      .addCase(logoutThunk.fulfilled, (state) => {
        state.isLoading = false
        state.user = null
        state.isAuthenticated = false
        state.error = null
      })
      .addCase(logoutThunk.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
      })
  },
})

export const { setUser, clearUser, setLoading, setError, clearError } = authSlice.actions
export default authSlice.reducer
