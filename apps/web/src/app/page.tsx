import { redirect } from 'next/navigation';

// Middleware handles all / redirects; this is a fallback only
export default function Home() {
  redirect('/sign-in');
}
