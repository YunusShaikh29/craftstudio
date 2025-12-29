import { NextFunction, Response } from "express";
import { AuthRequest } from "../middlewares/isAuthenticated";
import { prisma, MessageType } from "database/client";
import { streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { addJobToQueue } from "redis/queue";
import dotenv from "dotenv";
dotenv.config();

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