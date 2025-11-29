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

// Error response
export interface ApiError {
  error: string
}

