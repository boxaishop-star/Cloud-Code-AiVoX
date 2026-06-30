import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F8F7F4] gap-4 px-4">
      <div className="text-center">
        <span className="text-[64px] font-semibold text-[#E5E5E3] leading-none select-none">404</span>
        <p className="mt-3 text-base text-[#374151]">Страница не найдена</p>
        <Link
          href="/"
          className="mt-6 inline-block text-[14px] text-[#6366F1] hover:text-[#4F46E5] transition-colors"
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
