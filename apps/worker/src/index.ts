import { redis } from "redis/redis";
import { prisma } from "database/client";
import { QUEUE_NAME } from "redis/queue";
import { Sandbox } from "@e2b/code-interpreter";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as s3 from "./s3";
import dotenv from "dotenv";
import { streamText } from "ai";
import { SYSTEM_PROMPT } from "./prompt";
import { fileChangesMap, setSandbox, TOOLS } from "./tools";
import { createTwoFilesPatch } from "diff";
dotenv.config();

const E2B_TEMPLATE_ID = "35say9dtojwu03w1zcm9";
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

async function main() {
  console.log("Worker started, waiting for jobs...");

  while (true) {
   
    let jobId: string | undefined;
    let projectId: string | undefined;

    try {
      const result = await redis.brpop(QUEUE_NAME, 0);

      if (result) {
        const [queueName, jobDataString] = result;
        const jobData = JSON.parse(jobDataString);
        jobId = jobData.jobId;
        projectId = jobData.projectId;
        const { messageId, activeSessionId } = jobData;

        fileChangesMap.clear();

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

        // changeset implementation here, if the message is of type Edit, create a changeset
        interface ChangeSet {
          id: string;
          projectId: string;
          jobId: string;
          message: string;
          createdAt: Date;
        }
        let changeSet: ChangeSet | null = null;
        if (prompt?.type === "EDIT") {
         
          changeSet = await prisma.changeSet.create({
            data: {
              projectId: projectId!,
              jobId: jobId!,
              message: prompt?.content
            }
          })
        }

        const project = await prisma.project.findUnique({
          where: { id: projectId, userId },
        });

        if (!project) {
          throw new Error(`Project with ID ${projectId} not found.`);
        }

        let sandbox: Sandbox | null = null;
        let needsNewSandbox = true;

        const activeSession = await prisma.sandboxSession.findFirst({
          where: {
            projectId: projectId,
            status: "ACTIVE",
            id: activeSessionId,
          },
        });

        // if the sandbox is active, try to reconnect to it
        if (activeSession && activeSession.id) {
          try {
            sandbox = await Sandbox.connect(activeSession.id);
            console.log(`Reconnected to sandbox ${activeSession.id}`);
            needsNewSandbox = false;
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
            // needsNewSandbox remains true
          }
        }

        // Create new sandbox if needed (no active session or reconnect failed)
        if (needsNewSandbox) {
          // Retry logic: try once, if fails retry twice, then fail gracefully
          let retryCount = 0;
          const maxRetries = 2;

          while (retryCount <= maxRetries) {
            try {
              sandbox = await Sandbox.create(E2B_TEMPLATE_ID);
              const sandboxInfo = await sandbox.getInfo();
              const newSandbox = await prisma.sandboxSession.create({
                data: {
                  id: sandboxInfo.sandboxId,
                  projectId: projectId!,
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
              break;
            } catch (sandboxError: any) {
              retryCount++;
              if (retryCount > maxRetries) {
                console.error(`Failed to create sandbox after ${maxRetries + 1} attempts:`, sandboxError);
                throw new Error(`Sandbox creation failed: ${sandboxError?.message || "Unknown error"}`);
              }
              console.log(`Sandbox creation attempt ${retryCount} failed, retrying...`);
            }
          }
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
            projectId: projectId!,
            role: "ASSISTANT",
            type: prompt?.type!,
            content: fullResponse
          }
        });

        await s3.syncSandboxToS3(sandbox, project.s3basePath);

        await redis.publish(
          `project:${projectId}`,
          JSON.stringify({ event: "FILES_SYNCED", jobId })
        );

        // saving files diffs in changefile.
        if (prompt?.type === "EDIT" && changeSet) {
          const changedFilesCount = fileChangesMap.size;

          for (const [path, { oldContent, newContent }] of fileChangesMap.entries()) {
            const diff = createTwoFilesPatch(path, path, oldContent, newContent, "", "");

            await prisma.changeFile.create({
              data: {
                changeSetId: changeSet?.id,
                filePath: path,
                diff: diff
              }
            });
          }

          fileChangesMap.clear();

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({ event: "CHANGESET_CREATED", jobId, changedFilesCount })
          );
        }

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
    } catch (error: any) {
      console.error("Worker error:", error);

      if (jobId && projectId) {
        try {
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: "FAILED",
              errorMessage: error?.message || "Unknown error occurred"
            }
          });

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "JOB_FAILED",
              jobId,
              error: error?.message || "Unknown error occurred"
            })
          );

          console.log(`Job ${jobId} marked as FAILED`);
        } catch (dbError) {
          console.error("Failed to update job status to FAILED:", dbError);
        }
      }
    }
  }
}

main();
