import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F8F7F4] gap-6 px-4">
      <div className="flex flex-col items-center gap-1">
        <span className="text-2xl font-semibold tracking-tight text-[#18181B]">AiVoX</span>
        <span className="text-sm text-[#71717A]">Войдите, чтобы продолжить</span>
      </div>
      <SignIn />
    </main>
  );
}
