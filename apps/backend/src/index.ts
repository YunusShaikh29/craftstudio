import express from "express";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { SYSTEM_PROMPT } from "./prompt";
import { createFile, updateFile, deleteFile, readFile } from "./tools";
import { z } from "zod";
import { Sandbox } from '@e2b/code-interpreter'
import dotenv from "dotenv"
import { authRouter } from "./v0/routes/authRouter";
dotenv.config()

const PORT = process.env.PORT || 8080

const TEMPLATE_ID = "35say9dtojwu03w1zcm9";

const app = express();

app.use(express.json());

app.post("/prompt", async(req, res) => {
    const { prompt } = req.body;
    const sandbox = await Sandbox.create(TEMPLATE_ID)
    const host = sandbox.getHost(5173)

    const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      const response = streamText({
        model: openrouter("gpt-4o-mini"),
        tools: {
            createFile: createFile,
            updateFile: updateFile,
            deleteFile: deleteFile,
            readFile: readFile
        },
        messages: [
            {
                role: "system",
                content: SYSTEM_PROMPT
            },
            {
                role: "user",
                content: prompt
            }
        ]
      });

      res.json({
        url: `https://${host}`
      })
});


app.use("/api/v0/auth", authRouter)

app.listen(PORT, () => {
  console.log("Server is running on port ", PORT);
});