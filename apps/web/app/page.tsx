"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Header } from "@/components/Header"
import { PromptInput } from "@/components/PromptInput"
import { ProjectCard } from "@/components/ProjectCard"
import { LoginModal } from "@/components/auth/LoginModal"
import { useAppDispatch, useAppSelector } from "@/store/hooks"
import { getMeThunk } from "@/store/slices/authSlice"
import { createProjectThunk, fetchProjectsThunk } from "@/store/slices/projectSlice"
import { Skeleton } from "@workspace/ui/components/skeleton"

export default function Page() {
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const router = useRouter()
  const dispatch = useAppDispatch()
  
  const { isAuthenticated, isLoading: authLoading } = useAppSelector((state) => state.auth)
  const { projects, isLoading: projectsLoading } = useAppSelector((state) => state.project)

  useEffect(() => {
    dispatch(getMeThunk())
  }, [dispatch])

  useEffect(() => {
    if (isAuthenticated) {
      dispatch(fetchProjectsThunk())
    }
  }, [isAuthenticated, dispatch])

  const handlePromptSubmit = async (prompt: string) => {
    if (!isAuthenticated) {
      setLoginModalOpen(true)
      return
    }

    const result = await dispatch(createProjectThunk({ prompt, type: "EDIT" }))
    if (createProjectThunk.fulfilled.match(result)) {
      router.push(`/project/${result.payload.project.id}`)
    }
  }

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="fixed inset-0 -z-10">
        <Image
          src="/image-mesh-gradient (6).png"
          alt="Background gradient"
          fill
          priority
          className="object-cover"
        />
      </div>

      <Header onLoginClick={() => setLoginModalOpen(true)} />
      
      <LoginModal open={loginModalOpen} onOpenChange={setLoginModalOpen} />

      <main className="pt-32 pb-20 px-6">
        <section className="max-w-4xl mx-auto text-center mb-16">
          <h1 className="text-5xl md:text-7xl font-bold text-[var(--color-soft-white)] mb-6">
            Craft something{" "}
            <span className="bg-gradient-to-r from-[var(--color-pink)] to-[var(--color-warm-red)] bg-clip-text text-transparent text-shadow-xs">
              beautiful
            </span>
          </h1>
          <p className="text-xl text-[var(--color-muted)] mb-12">
            Create websites by chatting with AI
          </p>

          <div className="flex justify-center">
            <PromptInput 
              onSubmit={handlePromptSubmit}
              isLoading={projectsLoading}
              placeholder="Describe the app you want to build..."
            />
          </div>
        </section>

        {/* Projects section - only show if authenticated */}
        {isAuthenticated && (
          <section className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-semibold text-[var(--color-soft-white)] mb-6">
              Your Projects
            </h2>
            
            {projectsLoading && projects.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-xl bg-[var(--color-charcoal)]/50" />
                ))}
              </div>
            ) : projects.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-[var(--color-muted)]">
                  No projects yet. Start by describing what you want to build!
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
