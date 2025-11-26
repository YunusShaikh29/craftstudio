import { tool } from "ai";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import { redis } from "redis/redis";

let sandboxRef: Sandbox | null = null;
let currentProjectId: string | null = null;

export function setSandbox(sandbox: Sandbox | null) {
  sandboxRef = sandbox;
}

export function setProjectId(projectId: string | null) {
  currentProjectId = projectId;
}

export const fileChangesMap: Map<string, { oldContent: string, newContent: string, path: string }> = new Map();

async function publishFileUpdated(path: string, isNew: boolean) {
  if (currentProjectId) {
    await redis.publish(
      `project:${currentProjectId}`,
      JSON.stringify({ event: "FILE_UPDATED", path, isNew })
    );
  }
}

export const TOOLS = {
  listFiles: tool({
    description:
      "List files in the sandbox project with glob patterns (e.g., 'src/**/*.{ts,tsx}').",
    name: "list-files",
    inputSchema: z.object({
      glob: z.string().describe("Glob pattern to match files."),
    }),
    execute: async ({ glob }) => {
      if (!sandboxRef) {
        throw new Error("Sandbox not found");
      }
      const files = await sandboxRef.files.list(glob);
      return { files };
    },
  }),

  viewFile: tool({
    name: "view-file",
    description:
      "Read file content from with optional line range for efficiency.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Absolute path from project root (e.g., 'src/App.tsx')"),
      startLine: z.number().optional().describe("Starting line (default 1)"),
      endLine: z
        .number()
        .optional()
        .describe("Ending line (default full file)"),
    }),
    execute: async ({ path, startLine, endLine }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      const content = await sandboxRef.files.read(path);
      if (startLine && endLine) {
        const lines = content.split("\n").slice(startLine - 1, endLine);
        return { content: lines.join("\n") };
      }
      return { content };
    },
  }),

  searchFile: tool({
    name: "search-files",
    description:
      "Search codebase using regex; filter with globs; case-insensitive by default.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Regex or keyword to search (e.g., 'useState)."),
      include: z
        .string()
        .optional()
        .describe("Glob include pattern (e.g., 'src/**')."),
      exclude: z
        .string()
        .optional()
        .describe("Glob exclude pattern (e.g., '**/*.test.*')."),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("Wether to match exactly."),
    }),
    execute: async ({ query, include, exclude, caseSensitive }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      const files = await sandboxRef.files.list(include || "**/*");
      const matches: any[] = [];
      for (const file of files) {
        if (exclude && file.name.includes(exclude)) continue;
        const content = await sandboxRef.files.read(file.path);
        const regex = new RegExp(query, caseSensitive ? "g" : "gi");
        if (regex.test(content)) matches.push(file.path);
      }
      return { matches };
    },
  }),

  writeFile: tool({
    name: "write-file",
    description:
      "Create or overwrite a file; use for new components or configs.",
    inputSchema: z.object({
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .describe("File path (e.g., 'src/components/TodoList.tsx')."),
      content: z
        .string()
        .describe("Full file content as string (TypeScript-valid)."),
    }),
    execute: async ({ path, content }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      
      try {
        let oldContent = "";
        let isNew = true;
        
        try {
          oldContent = await sandboxRef.files.read(path);
          isNew = false;
        } catch {
          oldContent = "";
        }
       
        fileChangesMap.set(path, { oldContent, newContent: content, path });
        await sandboxRef.files.write(path, content);
        
        await publishFileUpdated(path, isNew);
        
        return { success: true, path, isNew };
      } catch (error: any) {
        console.error(`write-file error for ${path}:`, error);
        return { success: false, error: error.message || "Failed to write file" };
      }
    },
  }),

  replaceLines: tool({
    name: "replace-lines",
    description: "Edit existing file: Replace specific lines with new content.",
    inputSchema: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("File path."),
      startLine: z.number().min(1, "Start line must be >= 1").describe("Starting line number (1-based)."),
      endLine: z.number().min(1, "End line must be >= 1").describe("Ending line number."),
      newContent: z.string().describe("Replacement content."),
    }),
    execute: async ({ path, startLine, endLine, newContent }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");
      
      try {
        if (startLine > endLine) {
          return { success: false, error: "startLine must be <= endLine" };
        }
        
        let oldContent = "";
        try {
          oldContent = await sandboxRef.files.read(path);
        } catch {
          return { success: false, error: `File not found: ${path}` };
        }
        
        const lines = oldContent.split("\n");
        
        if (startLine > lines.length) {
          return { success: false, error: `startLine ${startLine} exceeds file length ${lines.length}` };
        }
        
        const updated =
          lines.slice(0, startLine - 1).join("\n") +
          "\n" +
          newContent +
          "\n" +
          lines.slice(endLine).join("\n");
          
        fileChangesMap.set(path, { oldContent, newContent: updated, path });
        await sandboxRef.files.write(path, updated);
        
        await publishFileUpdated(path, false);
        
        return { success: true, path, linesReplaced: endLine - startLine + 1 };
      } catch (error: any) {
        console.error(`replace-lines error for ${path}:`, error);
        return { success: false, error: error.message || "Failed to replace lines" };
      }
    },
  }),

  addDependency: tool({
    name: "add-dependency",
    description: "Add npm dependency and install in sandbox.",
    inputSchema: z.object({
      package: z
        .string()
        .min(1, "Package name cannot be empty")
        .describe("Package name/version (e.g., 'react-beautiful-dnd@latest')."),
      dev: z.boolean().optional().describe("Dev dependency? (default false)."),
    }),
    execute: async ({ package: pkg, dev }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");
      
      try {
        const packagePath = "package.json";
        let oldContent = "";
        try {
          oldContent = await sandboxRef.files.read(packagePath);
        } catch {
          oldContent = "";
        }

        const cmd = `npm install ${pkg}${dev ? " --save-dev" : ""}`;
        const res = await sandboxRef.runCode(cmd);

        const newContent = await sandboxRef.files.read(packagePath);
        fileChangesMap.set(packagePath, { oldContent, newContent, path: packagePath });

        await publishFileUpdated(packagePath, false);

        return { 
          success: true, 
          package: pkg, 
          dev: dev || false,
          output: res.logs.stdout 
        };
      } catch (error: any) {
        console.error(`add-dependency error for ${pkg}:`, error);
        return { success: false, error: error.message || `Failed to install ${pkg}` };
      }
    },
  }),

  runCommand: tool({
    name: "run-command",
    description: 
      "Execute shell commands inside the sandbox environment (like 'npm run build' or 'ls -la').",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute."),
    }),
    execute: async ({ command }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      try {
        const exec = await sandboxRef.runCode(command, { language: "base" });
        return {
          stdout: exec.logs?.stdout || "No output.",
          stderr: exec.logs?.stderr || "",
          error: exec.error || null,
        };
      } catch (error: any) {
        console.error("run-command tool error: ", error);
        return { error: error.message || "failed to execute command" };
      }
    },
  }),

  removeDependency: tool({
    name: "remove-dependency",
    description:
      "Remove an npm dependency from the project (e.g., remove 'axios').",
    inputSchema: z.object({
      package: z.string().min(1, "Package name cannot be empty").describe("The package name to uninstall."),
    }),
    execute: async ({ package: pkg }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");

      try {
        const packagePath = "package.json";
        let oldContent = "";
        try {
          oldContent = await sandboxRef.files.read(packagePath);
        } catch {
          oldContent = "";
        }

        const exec = await sandboxRef.runCode(`npm uninstall ${pkg}`, {
          language: "bash",
        });

        const newContent = await sandboxRef.files.read(packagePath);
        fileChangesMap.set(packagePath, { oldContent, newContent, path: packagePath });

        await publishFileUpdated(packagePath, false);

        return {
          success: true,
          package: pkg,
          stdout: exec.logs?.stdout || `Removed ${pkg}`,
          stderr: exec.logs?.stderr || "",
        };
      } catch (error: any) {
        console.error(`remove-dependency error for ${pkg}:`, error);
        return { success: false, error: error.message || `Failed to uninstall ${pkg}` };
      }
    },
  }),

  //   readLogs: tool({
  //     name: "readLogs",
  //     description: "Read recent console logs from sandbox for debugging.",
  //     inputSchema: z.object({
  //       lines: z.number().optional().describe("Number of lines (default 50)."),
  //     }),
  //     execute: async ({ lines = 50 }) => {
  //       if (!sandboxRef) throw new Error("Sandbox not initialized.");
  //       const logs = await sandboxRef.logs.read(lines);
  //       return { logs };
  //     },
  //   }),
};
