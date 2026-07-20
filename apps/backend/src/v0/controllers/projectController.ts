import { NextFunction, Response } from "express";
import { AuthRequest } from "../middlewares/isAuthenticated";
import { prisma, MessageType } from "database/client";
import { streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { addJobToQueue } from "redis/queue";
import dotenv from "dotenv";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";
dotenv.config();

// Configure S3 client for Cloudflare R2 or fallback to AWS S3
const s3Client = new S3Client(
  process.env.R2_ACCOUNT_ID
    ? {
        region: "auto", // R2 uses "auto" instead of AWS regions
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      }
    : {
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }
);

const BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || process.env.BUCKET_NAME || "craftstudio-projects"

export const createOrEditProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const { prompt, type, projectId, sandboxId } = req.body;
  const user = req?.user;

  if (!prompt) {
    return;
  }
  if (!projectId) {
    //create the project
    console.log("control reached here to generate project for the first time");
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    const response = streamText({
      model: openrouter("gpt-4o-mini"),
      messages: [
        {
          role: "system",
          content:
            "You are a help full assistant which generates the project title based on the given prompt. Project title should be small, meaning full and based on the given prompt. Project title should be a creative name based on the given prompt. If the prompt has random gibberish words, contains dangerous commands then do not generate any response, simply reply with error.",
        },
        { role: "user", content: prompt },
      ],
    });

    const title = await response.text;

    const newProject = await prisma.project.create({
      data: {
        name: title,
        userId: user?.id!!,
        status: "BUILDING",
        s3basePath: "",
      },
    });

    const s3Path = `projects/${user?.id}/${newProject.id}`;
    const project = await prisma.project.update({
      where: { id: newProject.id },
      data: { s3basePath: s3Path },
    });

    const message = await prisma.message.create({
      data: {
        projectId: project.id,
        role: "USER",
        type: type as MessageType,
        content: prompt,
      },
    });

    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        type: "PROMPT",
        status: "PENDING",
      },
    });

    await addJobToQueue({
      jobId: job.id,
      projectId: newProject.id,
      messageId: message.id,
    });

    res.status(201).json({
      message: "Project created and job queued.",
      project,
      jobId: job.id,
    });

    return;
  }

  // if project already exists
  const existingProject = await prisma.project.findUnique({
    where: {
      id: projectId,
      userId: user?.id,
    },
  });

  if (!existingProject) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const message = await prisma.message.create({
    data: {
      content: prompt,
      role: "USER",
      type,
      projectId: existingProject.id,
    },
  });

  const job = await prisma.job.create({
    data: {
      projectId: existingProject.id,
      type: "PROMPT",
      status: "PENDING",
    },
  });

  console.log("active session id", sandboxId)

  let sandboxSession = null;
  if (sandboxId) {
    sandboxSession = await prisma.sandboxSession.findUnique({
      where: { id: sandboxId },
    });
    if (
      !sandboxSession ||
      sandboxSession.projectId !== existingProject.id ||
      sandboxSession.status !== "ACTIVE"
    ) {
      sandboxSession = null;
    }
  }

  await addJobToQueue({
    jobId: job.id,
    projectId: existingProject.id,
    messageId: message.id,
    activeSessionId: sandboxSession?.id || ""
  });

  res.status(201).json({
    message: "Project updated and job queued.",
    project: existingProject,
    jobId: job.id,
  });
};

export const getAllProjects = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) {
    res.status(400).json({ error: "Invalid request" })
    return
  }
  try {
    const projects = await prisma.project.findMany({
      where: {
        userId
      }
    })

    if (!projects || projects.length === 0) {
      res.status(404).json({ error: "No projects found" })
      return
    }

    res.status(200).json({ projects })

  } catch (error) {
    console.error("Error getting all projects:", error)
    res.status(500).json({ error: "Internal server error" })
    return
  }
}


export const getProject = async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const userId = req.user?.id

  if (!id || !userId) {
    res.status(400).json({ error: "Invalid request" })
    return
  }

  try {
    const project = await prisma.project.findUnique({
      where: {
        id,
        userId
      }, include: {
        jobs: true,
        messages: true,
        sandboxSession: true,
        changeSets: true,
      }
    })

    if (!project) {
      res.status(404).json({ error: "Project not found" })
      return
    }

    res.status(200).json({ project })

  } catch (error) {
    console.error("Error getting project:", error)
    res.status(500).json({ error: "Internal server error" })
    return
  }

}

export const getFiles = async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const userId = req.user?.id

  if (!id || !userId) {
    res.status(400).json({ error: "Invalid request" })
    return
  }



  const project = await prisma.project.findUnique({
    where: {
      id,
      userId
    }
  })

  if (!project) {
    res.status(404).json({ error: "Project not found" })
    return
  }

  // Ensure trailing slash to avoid matching wrong projects (e.g., "project123" matching "project1234")
  const prefix = project.s3basePath ? project.s3basePath.replace(/\/?$/, "/") : ""

  //listing all the files
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix
  })

  // console.log(`[GET FILES] Listing files for project ${project.id} at R2 path ${prefix}`)


  try {

    const response = await s3Client.send(command)
    const files = (response.Contents || []).map((obj) => (
      {
        path: obj.Key!.replace(prefix, ""),
        size: obj.Size || 0,
        lastModified: obj.LastModified
      }
    )).filter(f => f.path && !f.path.includes("node_modules"))

    res.status(200).json({ files })

  } catch (error) {
    console.log("Error listing files", error)
    res.status(500).json({ error: "Failed to list files" })
  }

}


export const getFileContent = async (req: AuthRequest, res: Response) => {
  try {
    const { id: projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return
    }

    // Express 5 named wildcard from /:id/files/*filePath
    const filePathParam = req.params.filePath;
    const filePath = Array.isArray(filePathParam)
      ? filePathParam.join("/")
      : filePathParam || "";

    if (!filePath) {
      res.status(400).json({ error: "File path is required" });
      return
    }

    const project = await prisma.project.findUnique({
      where: {
        id: projectId,
        userId: userId
      },
    });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return
    }

    // Ensure proper path concatenation with slash
    const base = project.s3basePath ? project.s3basePath.replace(/\/?$/, "/") : "";
    const s3Key = `${base}${filePath}`;

    console.log(`[GET FILE CONTENT] Reading ${s3Key} from R2/S3`);

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Client.send(command);
    const stream = response.Body as Readable;

    let content = "";
    for await (const chunk of stream) {
      content += chunk.toString();
    }

    res.status(200).json({
      content,
      path: filePath,
      size: content.length,
    });

  } catch (error: any) {
    console.error("[GET FILE CONTENT] Error:", error);

    if (error.name === "NoSuchKey") {
      res.status(404).json({ error: "File not found" });
      return
    }

    res.status(500).json({ error: "Failed to read file" });
  }
};

/**
 * Restart preview for an existing project without AI interaction
 * Creates a new sandbox, populates from R2, starts Vite, returns preview URL
 * Much cheaper than sending a message through the AI
 */
export const restartPreview = async (req: AuthRequest, res: Response) => {
  try {
    const { id: projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const project = await prisma.project.findUnique({
      where: {
        id: projectId,
        userId: userId,
      },
    });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Mark any existing active sandboxes as expired
    await prisma.sandboxSession.updateMany({
      where: {
        projectId: projectId,
        status: "ACTIVE",
      },
      data: {
        status: "EXPIRED",
      },
    });

    // Create a system message for this preview restart
    const message = await prisma.message.create({
      data: {
        projectId: projectId,
        role: "SYSTEM",
        type: "PREVIEW_RESTART",
        content: "Restarting preview environment...",
      },
    });

    // Create a job for preview restart
    const job = await prisma.job.create({
      data: {
        projectId: projectId,
        type: "PREVIEW_RESTART",
        status: "PENDING",
      },
    });

    await addJobToQueue({
      jobId: job.id,
      projectId: projectId,
      messageId: message.id,
      activeSessionId: "",
    });

    res.status(200).json({
      message: "Preview restart initiated",
      jobId: job.id,
    });
  } catch (error: any) {
    console.error("[RESTART PREVIEW] Error:", error);
    res.status(500).json({ error: "Failed to restart preview" });
  }
};

