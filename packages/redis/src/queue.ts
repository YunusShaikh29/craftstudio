import {redis} from "./redis"

export const QUEUE_NAME = "prompt-queue"

interface JobData {
    jobId: string
    projectId: string
    messageId: string,
    activeSessionId?: string
}

export const addJobToQueue = async (data: JobData) => {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data))
}