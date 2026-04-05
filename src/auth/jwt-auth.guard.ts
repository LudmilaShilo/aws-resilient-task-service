import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const REQUIRED_GROUP = 'task-users';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // API Gateway injects Cognito JWT claims into requestContext after authorization
    const claims = (
      request as unknown as {
        requestContext?: { authorizer?: { claims?: Record<string, string> } };
      }
    ).requestContext?.authorizer?.claims;

    if (!claims) {
      throw new ForbiddenException();
    }

    const groups = JSON.parse(claims['cognito:groups'] ?? '[]') as string[];

    if (!groups.includes(REQUIRED_GROUP)) {
      throw new ForbiddenException();
    }

    // Attach userId to request for use in controllers via @CurrentUser()
    (request as Request & { user: { sub: string } }).user = {
      sub: claims['sub'],
    };

    return true;
  }
}
