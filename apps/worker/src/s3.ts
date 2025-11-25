import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {type Sandbox} from "@e2b/code-interpreter";
import type { Project } from "database/client";
import { Readable } from "stream";

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || "crafstudio-projects";

export async function listFiles(prefix: string) {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
  });
  const response = await s3Client.send(command);
  return response.Contents?.map((obj) => obj.Key?.replace(prefix, "") || "") || [];
}

export async function downloadFile(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  const response = await s3Client.send(command);
  return new Promise((resolve, reject) => {
    const stream = response.Body as Readable;
    let data = "";
    stream.on("data", (chunk) => (data += chunk));
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

export async function uploadFile(key: string, body: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
  });
  await s3Client.send(command);
}

export async function populateSandbox(sandbox: Sandbox, project: Project) {
    const files = await listFiles(project.s3basePath)
    for (const file of files){
        const content = await downloadFile(`${project.s3basePath}/${file}`)
        await sandbox.files.write(file, content)
    }
}

export async function syncSandboxToS3(sandbox: Sandbox | null, s3basePath: string) {
  // we might have to fix the below code as it might render literally every file. 
  if(!sandbox) return;
  const files = await sandbox.files.list("**/*")
  for (const file of files){
    if(file.type === "file"){
      const content = await sandbox.files.read(file.path)
      await uploadFile(`${s3basePath}/${file.path}`, content)
    }
  }
}