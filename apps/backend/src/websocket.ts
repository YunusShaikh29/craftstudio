import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { redisSubscriber } from "redis/redis";

class WebSocketManager {
  private static instance: WebSocketManager;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocket>> = new Map();

  private constructor() {}

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  public init(server: HttpServer) {
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url!, `https://${req.headers.host}`);
      const projectId = url.searchParams.get("projectId");

      if (!projectId) {
        ws.close(1008, "Project ID required");
        return;
      }

      this.addClient(projectId, ws);

      ws.on("close", () => {
        this.removeClient(projectId, ws);
      });
    });

    this.handleRedisSubscription();
  }

  private addClient(projectId: string, ws: WebSocket) {
    if (!this.clients.has(projectId)) {
      this.clients.set(projectId, new Set());
    }
    this.clients.get(projectId)!.add(ws);
  }

  private removeClient(projectId: string, ws: WebSocket) {
    const projectClients = this.clients.get(projectId);
    if (projectClients) {
      projectClients.delete(ws);
      if (projectClients.size === 0) {
        this.clients.delete(projectId);
      }
    }
  }

  private handleRedisSubscription() {
    redisSubscriber.psubscribe("project:*");

    redisSubscriber.on("pmessage", (pattern, channel, message) => {
      //channel will be "project:some-project-id"
      const projectId = channel.split(":")[1];
      if (projectId) {
        try {
          const data = JSON.parse(message);
          this.broadcast(projectId, data);
        } catch (error) {
          console.log("Error parsing message from redis", error, message);
        }
      }
    });
  }

  public broadcast(projectId: string, message: object) {
    const projectClients = this.clients.get(projectId);
    if (projectClients) {
      const payload = JSON.stringify(message);
      projectClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }
}

export const wsManager = WebSocketManager.getInstance();
