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
const SANDBOX_BASE_PATH = "/home/user";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

/**
 * Start the Vite dev server inside the sandbox and return the public preview URL.
 * Safe to call on both new and reconnected sandboxes — kills any existing vite process first.
 */
async function startDevServer(sandbox: Sandbox, projectId: string, jobId: string): Promise<string> {
  console.log(`[JOB ${jobId}] Starting Vite dev server...`);

  // Kill any existing vite process so we get a clean start
  await sandbox.runCode("pkill -f vite || true", { language: "bash" });
  await new Promise((r) => setTimeout(r, 500));

  // Start vite bound to all interfaces so E2B can expose it
  const cmd = `cd ${SANDBOX_BASE_PATH} && nohup npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/vite.log 2>&1 &`;
  await sandbox.runCode(cmd, { language: "bash" });

  // Give vite a moment to boot before we read the log / get the host
  await new Promise((r) => setTimeout(r, 3000));

  // getHost returns the public HTTPS URL E2B exposes for that port
  const previewUrl = `https://${sandbox.getHost(5173)}`;
  console.log(`[JOB ${jobId}] Dev server running at ${previewUrl}`);

  return previewUrl;
}

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
          where: { id: messageId },
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
        let previewUrl: string | null = null;

        const e2bApiKey = process.env.E2B_API_KEY;
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

        // ── Try to reconnect to an existing sandbox ──────────────────────────
        if (activeSession && activeSession.id) {
          const reconnectStartTime = Date.now();
          try {
            sandbox = await Sandbox.connect(activeSession.id);
            const reconnectDuration = Date.now() - reconnectStartTime;
            console.log(`[JOB ${jobId}] Reconnected to sandbox ${activeSession.id} in ${reconnectDuration}ms`);
            needsNewSandbox = false;

            // Re-use the stored preview URL if vite is already running,
            // otherwise spin it up again and update the DB.
            const logCheck = await sandbox.runCode("cat /tmp/vite.log 2>/dev/null | tail -5", { language: "bash" });
            const viteRunning = logCheck.logs?.stdout?.includes("Local:") || logCheck.logs?.stdout?.includes("ready in");

            if (viteRunning && activeSession.previewUrl) {
              previewUrl = activeSession.previewUrl;
              console.log(`[JOB ${jobId}] Vite already running, reusing URL: ${previewUrl}`);
            } else {
              previewUrl = await startDevServer(sandbox, projectId!, jobId!);
              await prisma.sandboxSession.update({
                where: { id: activeSession.id },
                data: { previewUrl },
              });
            }

            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({
                event: "SANDBOX_RECONNECTED",
                jobId,
                sandboxId: activeSession.id,
                duration: reconnectDuration,
                previewUrl,
              })
            );

            // Always emit PREVIEW_READY so the frontend iframe refreshes
            await redis.publish(
              `project:${projectId}`,
              JSON.stringify({ event: "PREVIEW_READY", previewUrl, jobId })
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

        // ── Create a brand-new sandbox ────────────────────────────────────────
        if (needsNewSandbox) {
          let retryCount = 0;
          const maxRetries = 2;

          while (retryCount <= maxRetries) {
            try {
              const sandboxCreateStartTime = Date.now();
              sandbox = await Sandbox.create(E2B_TEMPLATE_ID, {
                apiKey: e2bApiKey,
                timeoutMs: 1000 * 60 * 5,
              });
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

              // Populate files from R2
              const populateStartTime = Date.now();
              const populatedCount = await s3.populateSandbox(sandbox, project);
              const populateDuration = Date.now() - populateStartTime;
              console.log(`[JOB ${jobId}] Populated sandbox from R2 in ${populateDuration}ms (filesFound=${populatedCount})`);

              // If R2 had no files (first time), push the initial sandbox template
              if (populatedCount === 0) {
                try {
                  console.log(`[JOB ${jobId}] R2 empty for project ${projectId}, uploading initial sandbox template...`);
                  const uploaded = await s3.syncSandboxToS3(sandbox, project.s3basePath);
                  console.log(`[JOB ${jobId}] Initial template uploaded ${uploaded.length} files`);
                  await redis.publish(
                    `project:${projectId}`,
                    JSON.stringify({
                      event: "FILES_SYNCED",
                      jobId,
                      initialUpload: true,
                      filesUploaded: uploaded.length,
                      uploadedKeys: uploaded.slice(0, 50),
                    })
                  );
                } catch (err) {
                  console.error(`[JOB ${jobId}] Failed initial template upload:`, err);
                }
              }

              // ── Start dev server & persist URL ──────────────────────────────
              previewUrl = await startDevServer(sandbox, projectId!, jobId!);
              await prisma.sandboxSession.update({
                where: { id: newSandbox.id },
                data: { previewUrl },
              });

              await redis.publish(
                `project:${projectId}`,
                JSON.stringify({
                  event: "SANDBOX_CREATED",
                  sandboxId: newSandbox.id,
                  jobId,
                  createDuration: sandboxCreateDuration,
                  populateDuration,
                  previewUrl,
                })
              );

              // Signal the frontend that the iframe can load
              await redis.publish(
                `project:${projectId}`,
                JSON.stringify({ event: "PREVIEW_READY", previewUrl, jobId })
              );

              break;
            } catch (sandboxError: any) {
              retryCount++;
              if (retryCount > maxRetries) {
                console.error(`Failed to create sandbox after ${maxRetries + 1} attempts:`, sandboxError);
                continue;
              }
              console.log(`Sandbox creation attempt ${retryCount} failed, retrying...`);
            }
          }
        }

        const conversationHistory = await prisma.message.findMany({
          where: { projectId },
          orderBy: { createdAt: "asc" },
          take: 20,
        });

        const recentChangeSets = await prisma.changeSet.findMany({
          where: { projectId },
          include: {
            changeFiles: {
              select: { filePath: true, diff: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        });

        let changeHistoryContext = "";
        if (recentChangeSets.length > 0) {
          changeHistoryContext = "\n\n## Recent Code Changes:\n";
          for (const cs of recentChangeSets) {
            changeHistoryContext += `\n**Change Set:** ${cs.message}\n`;
            changeHistoryContext += `**Files Modified:** ${cs.changeFiles.length}\n`;
            for (const cf of cs.changeFiles.slice(0, 5)) {
              changeHistoryContext += `- ${cf.filePath}\n`;
            }
            if (cs.changeFiles.length > 5) {
              changeHistoryContext += `- ... and ${cs.changeFiles.length - 5} more files\n`;
            }
          }
        }

        const messages: ModelMessage[] = conversationHistory.map((msg) => ({
          role: msg.role === "USER" ? "user" : "assistant",
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
            fullResponse += delta.text;
          } else if (delta.type === "tool-call") {
            toolCallCount++;
            const toolStartTime = Date.now();
            toolCallTimes.set(delta.toolCallId, toolStartTime);
            const toolInput = "input" in delta ? delta.input : (delta as any).args;
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
            console.log(`[JOB ${jobId}] [TOOL RESULT] ${resultStr.slice(0, 500)}${resultStr.length > 500 ? "..." : ""}`);

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

            // After any write-file / replace-lines, re-emit PREVIEW_READY
            // so the frontend knows to reload the iframe
            if (
              (delta.toolName === "write-file" || delta.toolName === "replace-lines") &&
              previewUrl
            ) {
              await redis.publish(
                `project:${projectId}`,
                JSON.stringify({ event: "PREVIEW_READY", previewUrl, jobId })
              );
            }
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
            content: fullResponse,
          },
        });

        // ── Sync changed files to R2 ─────────────────────────────────────────
        const changedFilePaths = Array.from(fileChangesMap.keys());
        if (changedFilePaths.length > 0) {
          console.log(`[JOB ${jobId}] Syncing ${changedFilePaths.length} changed files to R2...`);
          const s3SyncStartTime = Date.now();
          const uploadedKeys = await s3.syncSandboxToS3(
            sandbox,
            project.s3basePath,
            changedFilePaths
          );
          const s3SyncDuration = Date.now() - s3SyncStartTime;
          console.log(`[JOB ${jobId}] R2 sync completed in ${s3SyncDuration}ms - uploaded ${uploadedKeys.length} files`);

          await redis.publish(
            `project:${projectId}`,
            JSON.stringify({
              event: "FILES_SYNCED",
              jobId,
              duration: s3SyncDuration,
              filesUploaded: uploadedKeys.length,
              uploadedKeys: uploadedKeys.slice(0, 20),
            })
          );
        } else {
          console.log(`[JOB ${jobId}] No files changed, skipping R2 sync.`);
        }

        // ── Finalise changeset ────────────────────────────────────────────────
        if (prompt?.type === "EDIT" && changeSet) {
          const changedFilesCount = fileChangesMap.size;
          const changeFileStartTime = Date.now();

          for (const [path, { oldContent, newContent }] of fileChangesMap.entries()) {
            const diff = createTwoFilesPatch(path, path, oldContent, newContent, "", "");
            await prisma.changeFile.create({
              data: { changeSetId: changeSet.id, filePath: path, diff },
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
              changeSetId: changeSet.id,
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
          JSON.stringify({ event: "JOB_COMPLETED", jobId, duration: totalJobDuration, previewUrl })
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
            },
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