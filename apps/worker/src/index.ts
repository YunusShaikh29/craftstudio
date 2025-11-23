import { redis } from "redis/redis";
import { prisma } from "database/client";
import { QUEUE_NAME } from "redis/queue";
import { Sandbox } from "@e2b/code-interpreter";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as s3 from "./s3";
import dotenv from "dotenv";
import { streamText } from "ai";
import { SYSTEM_PROMPT } from "./prompt";
import { setSandbox, TOOLS } from "./tools";
dotenv.config();

const E2B_TEMPLATE_ID = "35say9dtojwu03w1zcm9";
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

async function main() {
  console.log("Worker started, waiting for jobs...");

  while (true) {
    try {
      const result = await redis.brpop(QUEUE_NAME, 0);

      if (result) {
        const [queueName, jobDataString] = result;
        const jobData = JSON.parse(jobDataString);
        const { jobId, projectId, messageId, activeSessionId } = jobData;

        console.log(`Processing job ${jobId} for project ${projectId}`);

        const prompt = await prisma.message.findFirst({
          where: {
            id: messageId,
          },
          select: {
            content: true,
            role: true,
            type: true,
            project: true,
          },
        });

        const userId = prompt?.project.userId || "";

        await prisma.job.update({
          where: { id: jobId },
          data: { status: "RUNNING" },
        });

        await redis.publish(
          `project:${projectId}`,
          JSON.stringify({ event: "JOB_STARTED", jobId })
        );

        const project = await prisma.project.findUnique({
          where: { id: projectId, userId },
        });

        if (!project) {
          throw new Error(`Project with ID ${projectId} not found.`);
        }

        let sandbox: Sandbox | null = null;

        const activeSession = await prisma.sandboxSession.findFirst({
          where: {
            projectId: projectId,
            status: "ACTIVE",
            id: activeSessionId,
          },
        });

        // if the sandbox is active, reconnect to it
        if (activeSession && activeSession.id) {
          try {
            sandbox = await Sandbox.connect(activeSession.id);
            console.log(`Reconnected to sandbox ${activeSession.id}`);
            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({ event: "SANDBOX_RECONNECTED", jobId })
            );
          } catch (error) {
            console.log(
              `Failed to reconnect to sandbox ${activeSession.id}, creating a new one.`
            );
            await prisma.sandboxSession.update({
              where: { id: activeSession.id },
              data: { status: "EXPIRED" },
            });
          }
        }

        // creating new sandbox if the active sandbox is not found
        if (!activeSession || !activeSession.id) {
          sandbox = await Sandbox.create("35say9dtojwu03w1zcm9");
          const sandboxInfo = await sandbox.getInfo();
          const newSandbox = await prisma.sandboxSession.create({
            data: {
              id: sandboxInfo.sandboxId,
              projectId: projectId,
              templateId: sandboxInfo.templateId,
              status: "ACTIVE",
            },
          });
          console.log(`Created new sandbox ${newSandbox.id}`);
          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "SANDBOX_CREATED",
              sandboxId: newSandbox.id,
              jobId,
            })
          );

          await s3.populateSandbox(sandbox, project);
        }

        const conversationHistory = await prisma.message.findMany({
          where: {
            projectId,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 20,
        });

        const messages = conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

        setSandbox(sandbox);

        
        //main llm logic here
        const response = streamText({
          model: openrouter("gpt-4o-mini"),
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            ...messages,
            {
              role: "user",
              content: prompt?.content || "",
            },
          ],
          tools: TOOLS,
        });

        let fullResponse = "";

        for await (const delta of response.fullStream) {
          if (delta.type === "text-delta") {
            process.stdout.write(delta.text);
            fullResponse += delta.text;
          } else if (delta.type === "tool-call") {
            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({
                event: "TOOL_EXECUTED",
                toolname: delta.toolName,
              })
            );
            console.log("Tool call executed: ", delta.toolName);
          }
        }

        await prisma.message.create({
          data: {
            projectId,
            role: "ASSISTANT",
            type: prompt?.type!,
            content: fullResponse
          }
        });




        await prisma.job.update({
          where: { id: jobId },
          data: { status: "COMPLETED" },
        });

        await redis.publish(
          `project:${projectId}`,
          JSON.stringify({ event: "JOB_COMPLETED", jobId })
        );

        console.log(`Finished job ${jobId}`);
      }
    } catch (error) {
      console.error("Worker error:", error);
    }
  }
}

main();
