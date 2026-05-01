

interface FileNode {
    name: string
    path: string
    type: "file" | "directory"
    children?: FileNode[]
}

interface Editor {
    fileTree: FileNode[]
    openFiles: Array<{ path: string; content: string, isDirty: boolean }>
    activeFile: string | null
    previewUrl: string | null
    isLoadingTree: boolean
    isLoadingFile: boolean
}

