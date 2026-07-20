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
  let cleanPath = path.replace(/^\.\//,  "").replace(/^\//,  "");
  
  if (!cleanPath.startsWith(SANDBOX_BASE_PATH)) {
    return `${SANDBOX_BASE_PATH}/${cleanPath}`;
  }
  
  return cleanPath;
}


function getRelativePath(fullPath: string): string {
  return fullPath.replace(SANDBOX_BASE_PATH + '/', '').replace(/^\//, '');
}

/**
 * Basic JSX/TSX syntax validation to catch common errors before writing files
 * Returns null if valid, error message if invalid
 */
function validateJSXSyntax(path: string, content: string): string | null {
  const isTsxFile = path.endsWith('.tsx') || path.endsWith('.jsx');
  const hasJSX = content.includes('<') && content.includes('>');
  
  if (!isTsxFile && !hasJSX) return null;
  
  const openTags = (content.match(/<[a-zA-Z][a-zA-Z0-9]*[^>]*>/g) || []).length;
  const closeTags = (content.match(/<\/[a-zA-Z][a-zA-Z0-9]*>/g) || []).length;
  const selfClosingTags = (content.match(/<[a-zA-Z][a-zA-Z0-9]*[^>]*\/>/g) || []).length;
  
  if (openTags - selfClosingTags !== closeTags) {
    return `JSX tag mismatch: ${openTags - selfClosingTags} opening tags but ${closeTags} closing tags. Ensure all tags are properly closed.`;
  }
  
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/`[^`]*`/g, '');
  
  const openBraces = (cleanContent.match(/\{/g) || []).length;
  const closeBraces = (cleanContent.match(/\}/g) || []).length;
  
  if (openBraces !== closeBraces) {
    return `Unbalanced braces: ${openBraces} opening '{' but ${closeBraces} closing '}'. Check JSX expressions and ensure all braces are matched.`;
  }
  
  if (content.includes('className={') && !content.includes('className={"') && !content.includes("className={'")) {
    const incompleteClassName = content.match(/className=\{[^}]*$/m);
    if (incompleteClassName) {
      return `Incomplete className expression detected. Ensure all className attributes are properly closed with '}'.`;
    }
  }
  
  const openParens = (cleanContent.match(/\(/g) || []).length;
  const closeParens = (cleanContent.match(/\)/g) || []).length;
  
  if (openParens !== closeParens) {
    return `Unbalanced parentheses: ${openParens} opening '(' but ${closeParens} closing ')'. Check .map() calls and function calls in JSX.`;
  }
  
  return null;
}

/**
 * Basic CSS syntax validation to catch common errors before writing files
 * Returns null if valid, error message if invalid
 */
function validateCSSSyntax(path: string, content: string): string | null {
  if (!path.endsWith('.css')) return null;
  
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '');
  
  const openBraces = (cleanContent.match(/\{/g) || []).length;
  const closeBraces = (cleanContent.match(/\}/g) || []).length;
  
  if (openBraces !== closeBraces) {
    return `CSS syntax error: ${openBraces} opening '{' but ${closeBraces} closing '}'. Ensure all CSS blocks are properly closed.`;
  }
  
  const openParens = (cleanContent.match(/\(/g) || []).length;
  const closeParens = (cleanContent.match(/\)/g) || []).length;
  
  if (openParens !== closeParens) {
    return `CSS syntax error: ${openParens} opening '(' but ${closeParens} closing ')'. Check CSS functions like calc(), rgba(), etc.`;
  }
  
  const openBrackets = (cleanContent.match(/\[/g) || []).length;
  const closeBrackets = (cleanContent.match(/\]/g) || []).length;
  
  if (openBrackets !== closeBrackets) {
    return `CSS syntax error: ${openBrackets} opening '[' but ${closeBrackets} closing ']'. Check attribute selectors.`;
  }
  
  return null;
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
        
        const jsxValidationError = validateJSXSyntax(relativePath, content);
        if (jsxValidationError) {
          console.error(`[WRITE FILE] JSX validation failed for ${relativePath}: ${jsxValidationError}`);
          return { 
            success: false, 
            error: `JSX validation failed: ${jsxValidationError}. Please fix the code before writing.`,
            path: relativePath 
          };
        }
        
        const cssValidationError = validateCSSSyntax(relativePath, content);
        if (cssValidationError) {
          console.error(`[WRITE FILE] CSS validation failed for ${relativePath}: ${cssValidationError}`);
          return { 
            success: false, 
            error: `CSS validation failed: ${cssValidationError}. Please fix the CSS before writing.`,
            path: relativePath 
          };
        }
        
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
    description: "Edit existing file: Replace specific lines with new content.",
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().min(1),
      endLine: z.number().min(1),
      newContent: z.string(),
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
  
        const originalLines = oldContent.split("\n");
  
        if (startLine > originalLines.length) {
          return {
            success: false,
            error: `startLine ${startLine} exceeds file length ${originalLines.length}`,
          };
        }
  
        // Normalize escaped newlines
        const normalizedContent = newContent
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t");
  
        // Always treat as multi-line
        const newLines = normalizedContent.split("\n");
  
        // Proper splice instead of string concat
        const updatedLines = [
          ...originalLines.slice(0, startLine - 1),
          ...newLines,
          ...originalLines.slice(endLine),
        ];
  
        const updatedContent = updatedLines.join("\n");
        
        const jsxValidationError = validateJSXSyntax(relativePath, updatedContent);
        if (jsxValidationError) {
          console.error(`[REPLACE LINES] JSX validation failed for ${relativePath}: ${jsxValidationError}`);
          return { 
            success: false, 
            error: `JSX validation failed after replacement: ${jsxValidationError}. The changes would break the file.`,
            path: relativePath 
          };
        }
        
        const cssValidationError = validateCSSSyntax(relativePath, updatedContent);
        if (cssValidationError) {
          console.error(`[REPLACE LINES] CSS validation failed for ${relativePath}: ${cssValidationError}`);
          return { 
            success: false, 
            error: `CSS validation failed after replacement: ${cssValidationError}. The changes would break the file.`,
            path: relativePath 
          };
        }
  
        fileChangesMap.set(fullPath, {
          oldContent,
          newContent: updatedContent,
          path: fullPath,
        });
  
        await sandboxRef.files.write(fullPath, updatedContent);
  
        console.log(
          `[REPLACE LINES] Updated ${relativePath} (lines ${startLine}-${endLine}, inserted ${newLines.length} lines)`
        );
  
        await publishFileUpdated(relativePath, false);
  
        return {
          success: true,
          path: relativePath,
          fullPath,
          linesReplaced: endLine - startLine + 1,
          linesInserted: newLines.length,
        };
      } catch (error: any) {
        console.error(`[REPLACE LINES] Error for ${path}:`, error?.message);
        return {
          success: false,
          error: error?.message || "Failed to replace lines",
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
  runDevServer: tool({
    name: "run-dev-server",
    description: "Start the Vite dev server on port 5173",
    inputSchema: z.object({}),
    execute: async () => {
      if(!sandboxRef) throw new Error("Sandbox not initialized.")

      try {
        await sandboxRef.runCode("pkill -f 'vite'", { language: "bash" });

        const cmd = `cd ${SANDBOX_BASE_PATH} && nohup npm run dev > /tmp/vite.log 2>&1 &`
        await sandboxRef.runCode(cmd, {language: "bash"})

        await new Promise(resolve => setTimeout(resolve, 3000))
        const url = sandboxRef.getHost(5173)

        console.log(`[RUN DEV SERVER] Started at ${url}`);
        
        return {
          success: true,
          url,
          port: 5173
        }

      } catch (error) {
        console.error("[RUN DEV SERVER] Error:", (error as any).message);
        return {success: false, error: error || "Failed to start dev server"}
      }
    }

  })
};