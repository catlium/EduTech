import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/auth.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import {
  getCookieOptions,
  setAccessCookie,
  setRefreshCookie,
  setCsrfCookie,
  clearAuthCookies,
} from '../common/utils/cookie.util.js';
import { generateCsrfToken } from '../common/utils/crypto.util.js';

const AUTH_THROTTLE = {
  default: {
    limit: parseInt(process.env['AUTH_RATE_LIMIT_LIMIT'] ?? '5', 10),
    ttl: parseInt(process.env['AUTH_RATE_LIMIT_TTL_MS'] ?? '60000', 10),
  },
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    const options = getCookieOptions();

    setAccessCookie(response, result.tokens.accessToken, options);
    setRefreshCookie(response, result.tokens.refreshToken, options);

    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken, options);

    return { user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @UseGuards(CsrfGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.['refresh_token'] as string | undefined;

    if (!refreshToken) {
      return response.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: 401,
        message: 'Refresh token not found',
        error: 'Unauthorized',
      });
    }

    const result = await this.authService.refresh(refreshToken);
    const options = getCookieOptions();

    setAccessCookie(response, result.tokens.accessToken, options);
    setRefreshCookie(response, result.tokens.refreshToken, options);

    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken, options);

    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, CsrfGuard)
  async logout(
    @CurrentUser() _user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.['refresh_token'] as string | undefined;

    if (refreshToken) {
      try {
        const payload = await this.authService.verifyRefreshToken(refreshToken);
        await this.authService.logout(payload.sid);
      } catch {
        // Session may already be invalid
      }
    }

    const options = getCookieOptions();
    clearAuthCookies(response, options);

    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const fullUser = await this.authService.getUser(user.userId);
    return { user: fullUser };
  }
}
