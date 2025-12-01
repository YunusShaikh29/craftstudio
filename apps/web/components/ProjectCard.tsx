"use client"

import Link from "next/link"
import type { Project } from "@/lib/api/types"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const statusColors = {
    ACTIVE: "bg-green-500/20 text-green-400",
    BUILDING: "bg-yellow-500/20 text-yellow-400",
    ARCHIVED: "bg-gray-500/20 text-gray-400",
    FAILED: "bg-red-500/20 text-red-400",
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <Link href={`/project/${project.id}`}>
      <div className="group bg-[var(--color-charcoal)]/80 hover:bg-[var(--color-charcoal)] border border-[var(--color-deep-plum)]/30 hover:border-[var(--color-deep-plum)] rounded-xl p-5 transition-all duration-200 cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-[var(--color-soft-white)] group-hover:text-[var(--color-pink)] transition-colors line-clamp-1">
            {project.name}
          </h3>
          <span className={`text-xs px-2 py-1 rounded-full ${statusColors[project.status]}`}>
            {project.status.toLowerCase()}
          </span>
        </div>
        
        {project.description && (
          <p className="text-sm text-[var(--color-muted)] mb-3 line-clamp-2">
            {project.description}
          </p>
        )}
        
        <p className="text-xs text-[var(--color-muted)]/70">
          Created {formatDate(project.createdAt)}
        </p>
      </div>
    </Link>
  )
}

