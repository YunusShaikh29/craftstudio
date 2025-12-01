import http from "http"
import express from "express";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { SYSTEM_PROMPT } from "./prompt";
import { createFile, updateFile, deleteFile, readFile } from "./tools";
import { z } from "zod";
import { Sandbox } from '@e2b/code-interpreter'
import dotenv from "dotenv"
import { authRouter } from "./v0/routes/authRouter";
import { projectRouter } from "./v0/routes/projectRouter";
import cookieParser from "cookie-parser";
import { wsManager } from "./websocket";
import cors from "cors"
dotenv.config()

const PORT = process.env.PORT || 8080

const TEMPLATE_ID = "35say9dtojwu03w1zcm9";

const app = express();

const server = http.createServer(app)
wsManager.init(server)

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}))
app.use(express.json());
app.use(cookieParser())




app.use("/api/v0/auth", authRouter)
app.use("/api/v0/projects", projectRouter)

server.listen(PORT, () => {
  console.log("Server is running on port ", PORT);
});