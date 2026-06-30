import { UserButton } from '@clerk/nextjs';
import SetupChat from '@/components/SetupChat';

export default function SetupPage() {
  return (
    <div className="flex flex-col h-screen bg-[#F8F7F4]">
      <header className="shrink-0 flex items-center justify-between px-5 sm:px-6 h-14 bg-white border-b border-[#E5E5E3]">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold tracking-tight text-[#18181B]">AiVoX</span>
          <span className="text-[#D4D4D0]">/</span>
          <span className="text-[14px] text-[#71717A]">Настройка бизнеса</span>
        </div>
        <UserButton afterSignOutUrl="/sign-in" />
      </header>
      <SetupChat />
    </div>
  );
}
