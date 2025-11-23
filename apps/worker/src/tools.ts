
import { tool } from "ai";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";

let sandboxRef: Sandbox | null = null;
export function setSandbox(sandbox: Sandbox | null) {
  sandboxRef = sandbox;
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
        .describe("File path (e.g., 'src/components/TodoList.tsx')."),
      content: z
        .string()
        .describe("Full file content as string (TypeScript-valid).)"),
    }),
    execute: async ({ path, content }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      await sandboxRef.files.write(path, content);
      return { success: true, path };
    },
  }),

  replaceLines: tool({
    name: "replace-lines",
    description: "Edit existing file: Replace specific lines with new content.",
    inputSchema: z.object({
      path: z.string().describe("File path."),
      startLine: z.number().describe("Starting line number (1-based)."),
      endLine: z.number().describe("Ending line number."),
      newContent: z.string().describe("Replacement content."),
    }),
    execute: async ({ path, startLine, endLine, newContent }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");
      const oldContent = await sandboxRef.files.read(path);
      const lines = oldContent.split("\n");
      const updated =
        lines.slice(0, startLine - 1).join("\n") +
        "\n" +
        newContent +
        "\n" +
        lines.slice(endLine).join("\n");
      await sandboxRef.files.write(path, updated);
      return { success: true };
    },
  }),

  addDependency: tool({
    name: "add-dependency",
    description: "Add npm dependency and install in sandbox.",
    inputSchema: z.object({
      package: z
        .string()
        .describe("Package name/version (e.g., 'react-beautiful-dnd@latest')."),
      dev: z.boolean().optional().describe("Dev dependency? (default false)."),
    }),
    execute: async ({ package: pkg, dev }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");
      const cmd = `npm install ${pkg}${dev ? " --save-dev" : ""}`;
      const res = await sandboxRef.runCode(cmd);
      return { output: res.logs.stdout };
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
      package: z.string().describe("The package name to uninstall."),
    }),
    execute: async ({ package: pkg }) => {
      if (!sandboxRef) throw new Error("Sandbox not initialized.");

      try {
        const exec = await sandboxRef.runCode(`npm uninstall ${pkg}`, {
          language: "bash",
        });
        return {
          stdout: exec.logs?.stdout || `Removed ${pkg}`,
          stderr: exec.logs?.stderr || "",
          error: exec.error || null,
        };
      } catch (error: any) {
        console.error("remove-dependency tool error:", error);
        return { error: error.message || `Failed to uninstall ${pkg}` };
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
