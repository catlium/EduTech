import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = this.configService.get<string>('INTERNAL_API_SECRET');
    const authHeader = request.headers['x-internal-secret'];

    if (!secret || authHeader !== secret) {
      throw new UnauthorizedException('Invalid or missing internal secret');
    }

    return true;
  }
}
