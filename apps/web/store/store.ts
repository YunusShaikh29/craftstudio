import { configureStore } from "@reduxjs/toolkit"
import authReducers from "./slices/authSlice"
import projectReducers from "./slices/projectSlice"
import websocketReducers from "./slices/websocketSlice"

export const store = configureStore({
    reducer: {
        auth: authReducers,
        project: projectReducers,
        websocket: websocketReducers,
    }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
