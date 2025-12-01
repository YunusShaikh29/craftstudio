"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { useAppDispatch, useAppSelector } from "@/store/hooks"
import { loginThunk, clearError } from "@/store/slices/authSlice"

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const [email, setEmail] = useState("")
  const [emailSent, setEmailSent] = useState(false)
  const dispatch = useAppDispatch()
  const { isLoading, error } = useAppSelector((state) => state.auth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    const result = await dispatch(loginThunk(email))
    if (loginThunk.fulfilled.match(result)) {
      setEmailSent(true)
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setEmail("")
      setEmailSent(false)
      dispatch(clearError())
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-[var(--color-charcoal)] border-[var(--color-deep-plum)] text-[var(--color-soft-white)]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[var(--color-soft-white)]">
            {emailSent ? "Check your email" : "Sign in to CraftStudio"}
          </DialogTitle>
          <DialogDescription className="text-[var(--color-muted)]">
            {emailSent
              ? "We sent you a magic link. Click it to sign in."
              : "Enter your email and we'll send you a magic link to sign in."}
          </DialogDescription>
        </DialogHeader>

        {!emailSent ? (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[var(--color-soft-white)]">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="bg-[var(--color-deep-plum)] text-[var(--color-soft-white)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-0 focus:border-none"
              />
            </div>

            {error && (
              <p className="text-sm text-[var(--color-warm-red)]">{error}</p>
            )}

            <Button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="w-full bg-[var(--color-soft-white)] text-[var(--color-charcoal)] hover:bg-[var(--color-soft-white)]/90"
            >
              {isLoading ? "Sending..." : "Send magic link"}
            </Button>
          </form>
        ) : (
          <div className="mt-4 text-center">
            <p className="text-[var(--color-muted)] text-sm">
              Didn't receive the email?{" "}
              <button
                onClick={() => setEmailSent(false)}
                className="text-[var(--color-pink)] hover:underline"
              >
                Try again
              </button>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

