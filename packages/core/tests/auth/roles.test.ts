import { describe, it, expect } from 'vitest';
import { getRoleFromClerkUser } from '../../src/auth/roles.js';
import type { ClerkUserLike } from '../../src/auth/roles.js';

describe('getRoleFromClerkUser', () => {
  it('возвращает platform_owner если publicMetadata.role = "platform_owner"', () => {
    const user: ClerkUserLike = { publicMetadata: { role: 'platform_owner' } };
    expect(getRoleFromClerkUser(user)).toBe('platform_owner');
  });

  it('возвращает tenant_user если publicMetadata.role = "tenant_user"', () => {
    const user: ClerkUserLike = { publicMetadata: { role: 'tenant_user' } };
    expect(getRoleFromClerkUser(user)).toBe('tenant_user');
  });

  it('возвращает tenant_user по умолчанию если поле role не задано', () => {
    const user: ClerkUserLike = { publicMetadata: {} };
    expect(getRoleFromClerkUser(user)).toBe('tenant_user');
  });
});
