"use client"

import { Button } from "@workspace/ui/components/button"
import { useAppSelector, useAppDispatch } from "@/store/hooks"
import { logoutThunk } from "@/store/slices/authSlice"
import Link from "next/link"

interface HeaderProps {
  onLoginClick: () => void
}

export function Header({ onLoginClick }: HeaderProps) {
  const { isAuthenticated, user } = useAppSelector((state) => state.auth)
  const dispatch = useAppDispatch()

  const handleLogout = () => {
    dispatch(logoutThunk())
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-[var(--color-soft-white)]">
          CraftStudio
        </Link>

        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              <span className="text-sm text-[var(--color-muted)]">
                {user?.email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-[var(--color-soft-white)] hover:bg-[var(--color-deep-plum)]/50"
              >
                Logout
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoginClick}
              className="text-[var(--color-soft-white)] hover:bg-[var(--color-deep-plum)]/50"
            >
              Login
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

