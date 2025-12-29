import { redis } from "redis/redis";
import { prisma } from "database/client";
import { QUEUE_NAME } from "redis/queue";
import { Sandbox } from "@e2b/code-interpreter";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as s3 from "./s3";
import dotenv from "dotenv";
import { stepCountIs, streamText } from "ai";
import { SYSTEM_PROMPT } from "./prompt";
import { fileChangesMap, setSandbox, setProjectId, TOOLS } from "./tools";
import { createTwoFilesPatch } from "diff";
import type { ModelMessage } from "ai";
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
    let jobStartTime: number = 0;

    try {
      const result = await redis.brpop(QUEUE_NAME, 0);

      if (result) {
        const [queueName, jobDataString] = result;
        const jobData = JSON.parse(jobDataString);
        jobId = jobData.jobId;
        projectId = jobData.projectId;
        const { messageId, activeSessionId } = jobData;

        fileChangesMap.clear();
        jobStartTime = Date.now();

        console.log(`[JOB ${jobId}] Processing job for project ${projectId}`);

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
          const truncatedMessage = prompt?.content.substring(0, 100) || "";
          changeSet = await prisma.changeSet.create({
            data: {
              projectId: projectId!,
              jobId: jobId!,
              message: truncatedMessage
            }
          });
          console.log(`[JOB ${jobId}] ChangeSet created: ${changeSet.id} | Message: "${truncatedMessage}"`);
        }

        const project = await prisma.project.findUnique({
          where: { id: projectId, userId },
        });

        if (!project) {
          console.error(`Project with ID ${projectId} not found.`);
          continue;
        }

        let sandbox: Sandbox | null = null;
        let needsNewSandbox = true;
        const e2bApiKey = process.env.E2B_API_KEY
        if (!e2bApiKey) {
          console.error("E2B API key is not set");
          return;
        }

        const activeSession = await prisma.sandboxSession.findFirst({
          where: {
            projectId: projectId,
            status: "ACTIVE",
            id: activeSessionId,
          },
        });

        // if the sandbox is active, try to reconnect to it
        if (activeSession && activeSession.id) {
          const reconnectStartTime = Date.now();
          try {
            sandbox = await Sandbox.connect(activeSession.id);
            const reconnectDuration = Date.now() - reconnectStartTime;
            console.log(`[JOB ${jobId}] Reconnected to sandbox ${activeSession.id} in ${reconnectDuration}ms`);
            needsNewSandbox = false;
            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({ event: "SANDBOX_RECONNECTED", jobId, sandboxId: activeSession.id, duration: reconnectDuration })
            );
          } catch (error) {
            const reconnectDuration = Date.now() - reconnectStartTime;
            console.log(
              `[JOB ${jobId}] Failed to reconnect to sandbox ${activeSession.id} after ${reconnectDuration}ms, creating a new one.`
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
          // Retry logic: try once, if fails retry two more, then fail gracefully
          let retryCount = 0;
          const maxRetries = 2;

          while (retryCount <= maxRetries) {
            try {
              const sandboxCreateStartTime = Date.now();
              sandbox = await Sandbox.create(E2B_TEMPLATE_ID, { apiKey: e2bApiKey, timeoutMs: 1000 * 60 * 5 });
              const sandboxInfo = await sandbox.getInfo();
              const newSandbox = await prisma.sandboxSession.create({
                data: {
                  id: sandboxInfo.sandboxId,
                  projectId: projectId!,
                  templateId: sandboxInfo.templateId,
                  status: "ACTIVE",
                },
              });
              const sandboxCreateDuration = Date.now() - sandboxCreateStartTime;
              console.log(`[JOB ${jobId}] Created new sandbox ${newSandbox.id} in ${sandboxCreateDuration}ms`);

              const populateStartTime = Date.now();
              const populatedCount = await s3.populateSandbox(sandbox, project);
              const populateDuration = Date.now() - populateStartTime;
              console.log(`[JOB ${jobId}] Populated sandbox from S3 in ${populateDuration}ms (filesFound=${populatedCount})`);

              // If S3 had no files (first time), push the initial sandbox template into S3
              if (populatedCount === 0) {
                try {
                  console.log(`[JOB ${jobId}] S3 empty for project ${projectId}, uploading initial sandbox template to S3...`);
                  const uploaded = await s3.syncSandboxToS3(sandbox, project.s3basePath);
                  console.log(`[JOB ${jobId}] Initial template uploaded ${uploaded.length} files to S3`);
                  await redis.publish(
                    `project:${projectId}`,
                    JSON.stringify({
                      event: "FILES_SYNCED",
                      jobId,
                      initialUpload: true,
                      filesUploaded: uploaded.length,
                      uploadedKeys: uploaded.slice(0, 50)
                    })
                  );
                } catch (err) {
                  console.error(`[JOB ${jobId}] Failed initial template upload:`, err);
                }
              }


              await redis.publish(
                `project:${projectId}`,
                JSON.stringify({
                  event: "SANDBOX_CREATED",
                  sandboxId: newSandbox.id,
                  jobId,
                  createDuration: sandboxCreateDuration,
                  populateDuration: populateDuration,
                })
              );
              break;
            } catch (sandboxError: any) {
              retryCount++;
              if (retryCount > maxRetries) {
                console.error(`Failed to create sandbox after ${maxRetries + 1} attempts:`, sandboxError);
                console.error(`Sandbox creation failed: ${sandboxError?.message || "Unknown error"}`);
                continue;
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

        const recentChangeSets = await prisma.changeSet.findMany({
          where: {
            projectId,
          },
          include: {
            changeFiles: {
              select: {
                filePath: true,
                diff: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        });

        let changeHistoryContext = "";
        if (recentChangeSets.length > 0) {
          changeHistoryContext = "\n\n## Recent Code Changes:\n";
          for (const cs of recentChangeSets) {
            changeHistoryContext += `\n**Change Set:** ${cs.message}\n`;
            changeHistoryContext += `**Files Modified:** ${cs.changeFiles.length}\n`;
            for (const cf of cs.changeFiles.slice(0, 5)) { // Limit to 3 files per change set
              changeHistoryContext += `- ${cf.filePath}\n`;
            }
            if (cs.changeFiles.length > 5) {
              changeHistoryContext += `- ... and ${cs.changeFiles.length - 5} more files\n`;
            }
          }
        }

        const messages: ModelMessage[] = conversationHistory.map((msg) => ({
          role: msg.role === 'USER' ? 'user' : 'assistant',
          content: msg.content,
        }));


        const lastMsg = messages[messages.length - 1];
        if (
          changeHistoryContext &&
          messages.length > 0 &&
          lastMsg &&
          lastMsg.role === "assistant" &&
          typeof lastMsg.content === "string"
        ) {
          lastMsg.content += changeHistoryContext;
        }

        setSandbox(sandbox);
        setProjectId(projectId!);

        const llmStartTime = Date.now();
        console.log(`[JOB ${jobId}] Starting LLM execution`);

        //main llm logic here
        const response = streamText({
          model: openrouter("gpt-4o-mini"),

          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT + (changeHistoryContext ? `\n\n${changeHistoryContext}` : ""),
            },
            ...messages,
            {
              role: "user",
              content: prompt?.content || "",
            },
          ],
          tools: TOOLS,
          stopWhen: stepCountIs(10),
        });

        let fullResponse = "";
        const toolCallTimes: Map<string, number> = new Map();
        let toolCallCount = 0;
        let textChunkCount = 0;

        for await (const delta of response.fullStream) {
          if (delta.type === "text-delta") {
            textChunkCount++;
            // process.stdout.write(delta.text);
            // console.log(`[JOB ${jobId}] [TEXT #${textChunkCount}] ${delta.text}`);
            fullResponse += delta.text;
          } else if (delta.type === "tool-call") {
            toolCallCount++;
            const toolStartTime = Date.now();
            toolCallTimes.set(delta.toolCallId, toolStartTime);

            const toolInput = 'input' in delta ? delta.input : (delta as any).args;

            console.log(`\n[JOB ${jobId}] [TOOL #${toolCallCount}] ${delta.toolName} started`);
            console.log(`[JOB ${jobId}] [TOOL INPUT] ${JSON.stringify(toolInput, null, 2)}`);

            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({
                event: "TOOL_CALL_START",
                toolName: delta.toolName,
                toolCallId: delta.toolCallId,
              })
            );
          } else if (delta.type === "tool-result") {
            const toolStartTime = toolCallTimes.get(delta.toolCallId);
            const toolDuration = toolStartTime ? Date.now() - toolStartTime : 0;
            toolCallTimes.delete(delta.toolCallId);

            const resultStr = JSON.stringify(delta, null, 2);
            console.log(`[JOB ${jobId}] [TOOL RESULT] ${resultStr.slice(0, 500)}${resultStr.length > 500 ? '...' : ''}`);

            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({
                event: "TOOL_CALL_END",
                toolName: delta.toolName,
                toolCallId: delta.toolCallId,
                duration: toolDuration,
              })
            );
            console.log(`[JOB ${jobId}] [TOOL] ${delta.toolCallId}:${delta.toolName} completed in ${toolDuration}ms\n`);
          } else if (delta.type === "finish") {
            console.log(`[JOB ${jobId}] [FINISH] Reason: ${delta.finishReason}`);
            console.log(`[JOB ${jobId}] [STATS] Total tools called: ${toolCallCount}, Text chunks: ${textChunkCount}`);
          }
        }

        console.log(`\n[JOB ${jobId}] [SUMMARY]`);
        console.log(`- Tool calls: ${toolCallCount}`);
        console.log(`- Text response length: ${fullResponse.length} chars`);
        console.log(`- Files changed: ${fileChangesMap.size}`);

        const llmDuration = Date.now() - llmStartTime;
        console.log(`[JOB ${jobId}] LLM execution completed in ${llmDuration}ms`);

        await prisma.message.create({
          data: {
            projectId: projectId!,
            role: "ASSISTANT",
            type: prompt?.type!,
            content: fullResponse
          }
        });
        console.log(`[JOB ${jobId}] Assistant message saved to database: ${fullResponse}`);

        const s3SyncStartTime = Date.now();
        const changedFilePaths = Array.from(fileChangesMap.keys());

        if (changedFilePaths.length > 0) {

          console.log(`[JOB ${jobId}] Syncing ${changedFilePaths.length} changed files to S3...`);

          const uploadedKeys = await s3.syncSandboxToS3(
            sandbox,
            project.s3basePath,
            changedFilePaths.length > 0 ? changedFilePaths : undefined
          );

          const s3SyncDuration = Date.now() - s3SyncStartTime;
          console.log(`[JOB ${jobId}] S3 sync completed in ${s3SyncDuration}ms - uploaded ${uploadedKeys.length} files`);

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "FILES_SYNCED",
              jobId,
              duration: s3SyncDuration,
              filesUploaded: uploadedKeys.length,
              uploadedKeys: uploadedKeys.slice(0, 20) 
            })
          );
        } else {
          console.log(`[JOB ${jobId}, No files changed, skipping S3 sync!]`)
        }


        if (prompt?.type === "EDIT" && changeSet) {
          const changedFilesCount = fileChangesMap.size;
          const changeFileStartTime = Date.now();

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

          const changeFileDuration = Date.now() - changeFileStartTime;
          console.log(`[JOB ${jobId}] ChangeSet ${changeSet.id} finalized: ${changedFilesCount} files changed (${changeFileDuration}ms)`);

          fileChangesMap.clear();

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "CHANGESET_CREATED",
              jobId,
              changedFilesCount,
              changeSetId: changeSet.id
            })
          );
        }

        await prisma.job.update({
          where: { id: jobId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });

        const totalJobDuration = Date.now() - jobStartTime;
        console.log(`[JOB ${jobId}] Job completed successfully in ${totalJobDuration}ms`);

        await redis.publish(
          `project:${projectId}`,
          JSON.stringify({ event: "JOB_COMPLETED", jobId, duration: totalJobDuration })
        );
      }
    } catch (error: any) {
      const errorTime = jobId ? `[JOB ${jobId}]` : "[WORKER]";
      console.error(`${errorTime} Worker error:`, error);

      if (jobId && projectId) {
        try {
          const jobDuration = jobStartTime > 0 ? Date.now() - jobStartTime : 0;
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: "FAILED",
              errorMessage: error?.message || "Unknown error occurred",
              completedAt: new Date(),
            }
          });

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "JOB_FAILED",
              jobId,
              error: error?.message || "Unknown error occurred",
              duration: jobDuration,
            })
          );

          console.log(`${errorTime} Job marked as FAILED after ${jobDuration}ms`);
        } catch (dbError) {
          console.error(`${errorTime} Failed to update job status to FAILED:`, dbError);
        }
      }
    }
  }
}

main();
