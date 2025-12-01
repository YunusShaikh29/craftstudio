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

export interface CreateProjectResponse {
  message: string
  project: Project
  jobId: string
}

// Error response
export interface ApiError {
  error: string
}

