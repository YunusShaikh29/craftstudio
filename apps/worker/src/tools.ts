import { tool } from "ai";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import { redis } from "redis/redis";

let sandboxRef: Sandbox | null = null;
let currentProjectId: string | null = null;

const SANDBOX_BASE_PATH = "/home/user";

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

/**
 * Normalize path to work with sandbox
 * Converts relative paths to absolute sandbox paths
 */
function normalizePath(path: string): string {
  // Remove leading ./ or /
  let cleanPath = path.replace(/^\.\//, "").replace(/^\//, "");
  
  // If path doesn't start with /home/user, add it
  if (!cleanPath.startsWith(SANDBOX_BASE_PATH)) {
    return `${SANDBOX_BASE_PATH}/${cleanPath}`;
  }
  
  return cleanPath;
}


function getRelativePath(fullPath: string): string {
  return fullPath.replace(SANDBOX_BASE_PATH + '/', '').replace(/^\//, '');
}

export const TOOLS = {
  listFiles: tool({
    description:
      "List files in the sandbox project. Returns TypeScript and JavaScript files from the project structure.",
    name: "list-files",
    inputSchema: z.object({
      directory: z.string().optional().default("src").describe("Directory to list relative to project root (default: 'src')"),
    }),
    execute: async ({ directory }) => {
      if (!sandboxRef) {
        throw new Error("Sandbox not found");
      }
      try {
        // Normalize the directory path
        const fullPath = directory === '.' || directory === './' 
          ? SANDBOX_BASE_PATH 
          : normalizePath(directory);
        
        console.log(`[LIST FILES] Listing directory: ${fullPath}`);
        
        const allFiles = await sandboxRef.files.list(fullPath);
        console.log(`[LIST FILES] Found ${allFiles.length} total items`);
        
        const relevantItems = allFiles.filter(f => {
          if (f.path.includes('node_modules') || f.path.includes('/.')) {
            return false;
          }
          
          if (f.type === 'dir') {
            return true;
          }
          
          // relevant file types
          return (
            f.path.endsWith('.ts') || 
            f.path.endsWith('.tsx') || 
            f.path.endsWith('.js') || 
            f.path.endsWith('.jsx') ||
            f.path.endsWith('.json') ||
            f.path.endsWith('.css') ||
            f.path.endsWith('.html')
          );
        });
        
        // Convert to relative paths for cleaner output
        const formattedFiles = relevantItems.map(f => ({
          path: getRelativePath(f.path),
          type: f.type,
          size: f.size
        }));
        
        console.log(`[LIST FILES] Found ${formattedFiles.length} relevant items`);
        
        return { 
          files: formattedFiles.slice(0, 100), 
          total: formattedFiles.length,
          directory: getRelativePath(fullPath)
        };
      } catch (error: any) {
        console.error("[LIST FILES] Error:", error?.message || error);
        return { 
          error: error?.message || "Failed to list files", 
          files: [],
          suggestion: "Try listing 'src' or '.' directory"
        };
      }
    },
  }),

  viewFile: tool({
    name: "view-file",
    description:
      "Read file content with optional line range for efficiency. Provide path relative to project root (e.g., 'src/App.tsx').",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Path relative to project root (e.g., 'src/App.tsx')"),
      startLine: z.number().optional().describe("Starting line (default 1)"),
      endLine: z
        .number()
        .optional()
        .describe("Ending line (default full file)"),
    }),
    execute: async ({ path, startLine, endLine }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      
      try {
        const fullPath = normalizePath(path);
        console.log(`[VIEW FILE] Reading: ${fullPath}`);
        
        const content = await sandboxRef.files.read(fullPath);
        
        if (startLine && endLine) {
          const lines = content.split("\n").slice(startLine - 1, endLine);
          return { 
            content: lines.join("\n"),
            path: getRelativePath(fullPath),
            lines: `${startLine}-${endLine}`
          };
        }
        
        return { 
          content,
          path: getRelativePath(fullPath),
          totalLines: content.split("\n").length
        };
      } catch (error: any) {
        console.error(`[VIEW FILE] Error reading ${path}:`, error?.message);
        return { 
          error: `Failed to read file: ${error?.message || 'Unknown error'}`,
          path 
        };
      }
    },
  }),

  searchFile: tool({
    name: "search-files",
    description:
      "Search codebase using regex. Searches in src directory by default.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Regex or keyword to search (e.g., 'useState')."),
      directory: z
        .string()
        .optional()
        .default("src")
        .describe("Directory to search in (default: 'src')"),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("Whether to match exactly."),
    }),
    execute: async ({ query, directory, caseSensitive }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");

      try {
        const fullPath = normalizePath(directory);
        console.log(`[SEARCH FILES] Searching in: ${fullPath}`);
        
        const files = await sandboxRef.files.list(fullPath);
        const matches: Array<{ path: string; matchCount: number }> = [];

        const sourceFiles = files.filter(f => 
          f.type === 'file' && 
          !f.path.includes('node_modules') &&
          (f.path.endsWith('.ts') || 
           f.path.endsWith('.tsx') || 
           f.path.endsWith('.js') || 
           f.path.endsWith('.jsx'))
        );

        // Limit search to prevent timeout
        const filesToSearch = sourceFiles.slice(0, 50);

        for (const file of filesToSearch) {
          try {
            const content = await sandboxRef.files.read(file.path);
            const regex = new RegExp(query, caseSensitive ? "g" : "gi");
            const matchArray = content.match(regex);
            
            if (matchArray && matchArray.length > 0) {
              matches.push({
                path: getRelativePath(file.path),
                matchCount: matchArray.length
              });
            }
          } catch {
            continue;
          }
        }

        console.log(`[SEARCH FILES] Found ${matches.length} files with matches`);

        return {
          matches,
          query,
          searchedFiles: filesToSearch.length,
          totalFiles: sourceFiles.length
        };
      } catch (error: any) {
        console.error("[SEARCH FILES] Error:", error?.message);
        return { 
          error: error?.message || "Failed to search files", 
          matches: [] 
        };
      }
    },
  }),

  writeFile: tool({
    name: "write-file",
    description:
      "Create or overwrite a file. Provide path relative to project root (e.g., 'src/components/TodoList.tsx').",
    inputSchema: z.object({
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .describe("File path relative to project root (e.g., 'src/components/TodoList.tsx')."),
      content: z
        .string()
        .describe("Full file content as string (TypeScript-valid)."),
    }),
    execute: async ({ path, content }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");

      try {
        const fullPath = normalizePath(path);
        const relativePath = getRelativePath(fullPath);
        
        let oldContent = "";
        let isNew = true;

        try {
          oldContent = await sandboxRef.files.read(fullPath);
          isNew = false;
        } catch {
          oldContent = "";
        }

        // Store both the full path and relative path for S3 sync
        fileChangesMap.set(fullPath, { oldContent, newContent: content, path: fullPath });
        
        await sandboxRef.files.write(fullPath, content);
        console.log(`[WRITE FILE] ${isNew ? 'Created' : 'Updated'}: ${relativePath}`);

        await publishFileUpdated(relativePath, isNew);

        return { 
          success: true, 
          path: relativePath,
          fullPath,
          isNew,
          size: content.length
        };
      } catch (error: any) {
        console.error(`[WRITE FILE] Error for ${path}:`, error?.message);
        return { 
          success: false, 
          error: error?.message || "Failed to write file",
          path 
        };
      }
    },
  }),

  replaceLines: tool({
    name: "replace-lines",
    description: "Edit existing file: Replace specific lines with new content. Provide path relative to project root.",
    inputSchema: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("File path relative to project root."),
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

        const fullPath = normalizePath(path);
        const relativePath = getRelativePath(fullPath);
        
        let oldContent = "";
        try {
          oldContent = await sandboxRef.files.read(fullPath);
        } catch {
          return { success: false, error: `File not found: ${relativePath}` };
        }

        const lines = oldContent.split("\n");

        if (startLine > lines.length) {
          return { 
            success: false, 
            error: `startLine ${startLine} exceeds file length ${lines.length}` 
          };
        }

        const updated =
          lines.slice(0, startLine - 1).join("\n") +
          "\n" +
          newContent +
          "\n" +
          lines.slice(endLine).join("\n");

        fileChangesMap.set(fullPath, { oldContent, newContent: updated, path: fullPath });
        await sandboxRef.files.write(fullPath, updated);

        console.log(`[REPLACE LINES] Updated ${relativePath} (lines ${startLine}-${endLine})`);

        await publishFileUpdated(relativePath, false);

        return { 
          success: true, 
          path: relativePath,
          fullPath,
          linesReplaced: endLine - startLine + 1 
        };
      } catch (error: any) {
        console.error(`[REPLACE LINES] Error for ${path}:`, error?.message);
        return { 
          success: false, 
          error: error?.message || "Failed to replace lines" 
        };
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
        const packagePath = `${SANDBOX_BASE_PATH}/package.json`;
        let oldContent = "";
        
        try {
          oldContent = await sandboxRef.files.read(packagePath);
        } catch {
          oldContent = "";
        }

        const cmd = `cd ${SANDBOX_BASE_PATH} && npm install ${pkg}${dev ? " --save-dev" : ""}`;
        console.log(`[ADD DEPENDENCY] Running: ${cmd}`);
        
        const res = await sandboxRef.runCode(cmd, { language: "bash" });

        const newContent = await sandboxRef.files.read(packagePath);
        fileChangesMap.set(packagePath, { oldContent, newContent, path: packagePath });

        await publishFileUpdated("package.json", false);

        console.log(`[ADD DEPENDENCY] ✓ Installed ${pkg}`);

        return {
          success: true,
          package: pkg,
          dev: dev || false,
          output: res.logs?.stdout || `Successfully installed ${pkg}`
        };
      } catch (error: any) {
        console.error(`[ADD DEPENDENCY] Error for ${pkg}:`, error?.message);
        return { 
          success: false, 
          error: error?.message || `Failed to install ${pkg}` 
        };
      }
    },
  }),

  runCommand: tool({
    name: "run-command",
    description:
      "Execute shell commands inside the sandbox environment (like 'npm run build' or 'ls -la'). Commands run from /home/user directory.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute."),
    }),
    execute: async ({ command }) => {
      if (!sandboxRef) throw new Error("Sandbox not found");
      
      try {
        // Ensure commands run from the project directory
        const fullCommand = `cd ${SANDBOX_BASE_PATH} && ${command}`;
        console.log(`[RUN COMMAND] Executing: ${fullCommand}`);
        
        const exec = await sandboxRef.runCode(fullCommand, { language: "bash" });
        
        return {
          stdout: exec.logs?.stdout || "No output.",
          stderr: exec.logs?.stderr || "",
          error: exec.error || null,
          command: command
        };
      } catch (error: any) {
        console.error("[RUN COMMAND] Error:", error?.message);
        return { 
          error: error?.message || "Failed to execute command",
          command 
        };
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
        const packagePath = `${SANDBOX_BASE_PATH}/package.json`;
        let oldContent = "";
        
        try {
          oldContent = await sandboxRef.files.read(packagePath);
        } catch {
          oldContent = "";
        }

        const cmd = `cd ${SANDBOX_BASE_PATH} && npm uninstall ${pkg}`;
        console.log(`[REMOVE DEPENDENCY] Running: ${cmd}`);
        
        const exec = await sandboxRef.runCode(cmd, { language: "bash" });

        const newContent = await sandboxRef.files.read(packagePath);
        fileChangesMap.set(packagePath, { oldContent, newContent, path: packagePath });

        await publishFileUpdated("package.json", false);

        console.log(`[REMOVE DEPENDENCY] ✓ Removed ${pkg}`);

        return {
          success: true,
          package: pkg,
          stdout: exec.logs?.stdout || `Removed ${pkg}`,
          stderr: exec.logs?.stderr || "",
        };
      } catch (error: any) {
        console.error(`[REMOVE DEPENDENCY] Error for ${pkg}:`, error?.message);
        return { 
          success: false, 
          error: error?.message || `Failed to uninstall ${pkg}` 
        };
      }
    },
  }),
};