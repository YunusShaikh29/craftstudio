import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Sandbox } from "@e2b/code-interpreter";
import type { Project } from "database/client";
import { Readable } from "stream";


const r2Client = new S3Client({
  region: "auto", // R2 doesn't use regions — always set to "auto"
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "craftstudio-projects";
const SANDBOX_BASE_PATH = "/home/user";

/**
 * List low-level objects in R2 under prefix
 */
export async function listFiles(prefix: string) {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
  });
  const response = await r2Client.send(command);
  return (response.Contents || []).map((obj) => obj.Key!).filter(Boolean);
}

export async function downloadFile(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  const response = await r2Client.send(command);
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
  await r2Client.send(command);
}

/**
 * Populate sandbox from R2. Returns number of files populated.
 */
export async function populateSandbox(sandbox: Sandbox, project: Project): Promise<number> {
  const r2Keys = await listFiles(project.s3basePath || "");
  console.log(`Found ${r2Keys.length} files in R2 for population.`);

  if (r2Keys.length === 0) return 0;

  await Promise.all(
    r2Keys.map(async (key) => {
      if (key.includes('.wh.')) return;

      try {
        // derive relative path by removing prefix
        const rel = key.replace(project.s3basePath, "").replace(/^\//, "");
        const content = await downloadFile(key);

        // Write to the correct path in sandbox
        const sandboxPath = `${SANDBOX_BASE_PATH}/${rel}`;
        await sandbox.files.write(sandboxPath, content);

        console.log(`[POPULATE] Wrote ${sandboxPath}`);
      } catch (err) {
        console.error(`Failed to populate file ${key}:`, err);
      }
    })
  );

  return r2Keys.length;
}


async function recursiveListFiles(sandbox: Sandbox, dirPath: string): Promise<string[]> {
  const allFiles: string[] = [];

  try {
    const items = await sandbox.files.list(dirPath);

    for (const item of items) {
      // Skip unwanted directories
      if (item.path.includes('node_modules') ||
        item.path.includes('.npm') ||
        item.path.includes('.wh.') ||
        item.path.startsWith('/home/user/.bash') ||
        item.path.startsWith('/home/user/.profile')) {
        continue;
      }

      if (item.type === 'dir') {
        // Recursively list subdirectories
        const subFiles = await recursiveListFiles(sandbox, item.path);
        allFiles.push(...subFiles);
      } else if (item.type === 'file') {
        allFiles.push(item.path);
      }
    }
  } catch (err) {
    console.error(`[RECURSIVE LIST] Error listing ${dirPath}:`, err);
  }

  return allFiles;
}

/**
 * Sync sandbox back to R2.
 * - If changedFiles array is provided, sync only those.
 * - Otherwise fallback to recursive directory listing.
 * Returns array of uploaded R2 keys.
 */
export async function syncSandboxToS3(
  sandbox: Sandbox | null,
  s3basePath: string,
  changedFiles?: string[]
): Promise<string[]> {
  if (!sandbox) {
    console.log("[R2 SYNC] No sandbox provided");
    return [];
  }

  if (!s3basePath) s3basePath = "";

  if (s3basePath && !s3basePath.endsWith("/")) s3basePath = s3basePath + "/";

  let filesToUpload: string[] = [];

  if (changedFiles && changedFiles.length > 0) {
    filesToUpload = changedFiles.filter((p) => p.startsWith(SANDBOX_BASE_PATH));
    console.log(`[R2 SYNC] Using changed files list: ${filesToUpload.length} files`);
  } else {
    console.log("[R2 SYNC] No changed files provided, listing all project files...");

    try {
      filesToUpload = await recursiveListFiles(sandbox, SANDBOX_BASE_PATH);

      // Filter to only include project-relevant files
      filesToUpload = filesToUpload.filter(path => {
        const fileName = path.split('/').pop() || '';

        return (
          path.includes('/src/') ||
          path.includes('/public/') ||
          fileName === 'package.json' ||
          fileName === 'package-lock.json' ||
          fileName === 'tsconfig.json' ||
          fileName === 'tsconfig.app.json' ||
          fileName === 'tsconfig.node.json' ||
          fileName === 'vite.config.ts' ||
          fileName === 'index.html' ||
          fileName === 'tailwind.config.js' ||
          fileName === 'postcss.config.js' ||
          fileName === 'eslint.config.js' ||
          fileName === 'README.md' ||
          fileName === '.gitignore'
        );
      });

      console.log(`[R2 SYNC] Found ${filesToUpload.length} project files after filtering`);
    } catch (err) {
      console.error("[R2 SYNC] Failed to list files:", err);
      return [];
    }
  }

  if (filesToUpload.length === 0) {
    console.log("[R2 SYNC] No files to upload.");
    return [];
  }

  const uploadedKeys: string[] = [];
  const uploadPromises = filesToUpload.map(async (fullPath) => {
    try {
      const content = await sandbox.files.read(fullPath);

      const relativePath = fullPath.replace(SANDBOX_BASE_PATH + '/', '');
      const key = `${s3basePath}${relativePath}`;

      await uploadFile(key, content);
      uploadedKeys.push(key);

      console.log(`[R2 SYNC] Uploaded: ${relativePath}`);
    } catch (err: any) {
      console.error(`[R2 SYNC] Failed upload ${fullPath}:`, err?.message || err);
    }
  });

  await Promise.all(uploadPromises);

  console.log(`[R2 SYNC] Uploaded ${uploadedKeys.length}/${filesToUpload.length} files.`);
  return uploadedKeys;
}