import { getRoleFromClerkUser } from './roles.js';
import type { ClerkUserLike, Role } from './roles.js';

// Не привязан к Express/Next.js — вызывающий слой оборачивает это в свой middleware.
export class AuthorizationError extends Error {
  readonly statusCode = 403;
  constructor(requiredRole: Role, actualRole: Role) {
    super(`Forbidden: requires role '${requiredRole}', user has '${actualRole}'`);
    this.name = 'AuthorizationError';
  }
}

/**
 * Проверяет, что user обладает требуемой ролью.
 * Бросает AuthorizationError если нет — вызывающий HTTP-слой ловит и возвращает 403.
 */
export function requireRole(requiredRole: Role, user: ClerkUserLike): void {
  const actualRole = getRoleFromClerkUser(user);
  if (actualRole !== requiredRole) {
    throw new AuthorizationError(requiredRole, actualRole);
  }
}
