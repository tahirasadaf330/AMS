import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: Error, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check must_change_password — allow only specific routes
    if (user.mustChangePassword) {
      const request = context.switchToHttp().getRequest();
      const path: string = request.path || '';
      const allowed = ['/auth/change-password', '/auth/logout'];
      const isAllowed = allowed.some((p) => path.endsWith(p));
      if (!isAllowed) {
        throw new ForbiddenException(
          'You must change your password before continuing. Use POST /auth/change-password',
        );
      }
    }

    return user;
  }
}
