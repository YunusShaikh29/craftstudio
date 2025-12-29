"use client"

import { useEffect, useRef, useState } from "react"
import { useAppDispatch } from "@/store/hooks"
import {
  wsConnected,
  wsDisconnected,
  wsEventReceived,
} from "@/store/slices/websocketSlice"
import type { WebSocketEvent } from "@/lib/api/types"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080"

interface UseProjectWebSocketOptions {
  projectId: string | null
  enabled?: boolean
}

export function useProjectWebSocket({
  projectId,
  enabled = true,
}: UseProjectWebSocketOptions) {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!projectId || !enabled) {
      return
    }

    if (wsRef.current) {
      wsRef.current.close(1000, "Reconnecting with new projectId")
      wsRef.current = null
    }

    const ws = new WebSocket(`${WS_URL}?projectId=${projectId}`)

    ws.onopen = () => {
      console.log(`[WS] Connected to project ${projectId}`)
      setIsConnected(true)
      dispatch(wsConnected({ projectId }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketEvent
        console.log(`[WS] Event received:`, data)
        dispatch(wsEventReceived(data))
      } catch (error) {
        console.error("[WS] Failed to parse message:", error)
      }
    }

    ws.onerror = (error) => {
      console.error("[WS] Error:", error)
    }

    ws.onclose = (event) => {
      console.log(`[WS] Disconnected from project ${projectId}`, event.code)
      setIsConnected(false)
      dispatch(wsDisconnected())
      // No auto-reconnect - let the component handle reconnection if needed
    }

    wsRef.current = ws

    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting")
        wsRef.current = null
      }
      setIsConnected(false)
      dispatch(wsDisconnected())
    }
  }, [projectId, enabled, dispatch])

  return {
    isConnected,
  }
}

