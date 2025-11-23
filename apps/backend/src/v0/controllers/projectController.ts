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
  console.log("control reached here 2");
  if (!projectId) {
    //create the project
    console.log("control reached here 3");
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    console.log("control reachesd here");
    const response = streamText({
      model: openrouter("gpt-4o-mini"),
      messages: [
        {
          role: "system",
          content:
            "You are a help full assistant which generates the project title based on the given prompt. Project title should be small, meaning full and based on the given prompt. If the prompt has random gibberish words, contains dangerous commands then do not generate any response, simply reply with error.",
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

  const sandboxSession = await prisma.sandboxSession.findUnique({
    where: {
      id: sandboxId,
      projectId: existingProject.id,
      status: "ACTIVE",
    },
  });

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
