import { ResetPasswordForm } from '@/components/auth/reset-password-form'

export const dynamic = 'force-dynamic'

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token = '' } = await searchParams
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password.</h1>
        <p>This one-time link expires 15 minutes after it was created.</p>
        {token ? <ResetPasswordForm token={token} /> : <p className="form-error">The reset link is missing.</p>}
      </section>
    </main>
  )
}

