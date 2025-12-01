import { configureStore } from "@reduxjs/toolkit"
import authReducers from "./slices/authSlice"
import projectReducers from "./slices/projectSlice"

export const store = configureStore({
    reducer: {
        auth: authReducers,
        project: projectReducers,
    }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
