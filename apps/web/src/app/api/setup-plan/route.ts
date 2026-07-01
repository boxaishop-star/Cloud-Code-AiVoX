import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

  const token = await getToken();
  const upstream = await fetch(
    `${API_URL}/api/setup-plan?tenant_id=${encodeURIComponent(tenantId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data: unknown = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
