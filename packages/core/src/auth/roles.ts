// Раздел 9.1 ТЗ — роли закладываются с первого дня.
// Минимальный интерфейс позволяет тестировать без реального вызова Clerk API.
export interface ClerkUserLike {
  publicMetadata: Record<string, unknown>;
}

export type Role = 'platform_owner' | 'tenant_user';

/**
 * Читает роль из Clerk publicMetadata.role.
 * По умолчанию возвращает 'tenant_user' — принцип минимальных привилегий.
 */
export function getRoleFromClerkUser(user: ClerkUserLike): Role {
  const role = user.publicMetadata?.role;
  if (role === 'platform_owner') return 'platform_owner';
  return 'tenant_user';
}
