import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

// Keyed by string (not UserRole) so a legacy 'full_rights' claim in an already-issued JWT still
// resolves — otherwise active sessions from before the Viewer/Editor/Admin collapse would drop to
// level 0 and lose access until their next refresh. 'full_rights' maps to editor.
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  editor: 2,
  full_rights: 2,
  admin: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No user in request');
    }

    const userLevel = ROLE_HIERARCHY[user.role as UserRole] ?? 0;
    const hasRole = requiredRoles.some((role) => {
      const requiredLevel = ROLE_HIERARCHY[role] ?? 0;
      return userLevel >= requiredLevel;
    });

    if (!hasRole) {
      throw new ForbiddenException(`Insufficient permissions. Required: ${requiredRoles.join(' or ')}`);
    }

    return true;
  }
}
