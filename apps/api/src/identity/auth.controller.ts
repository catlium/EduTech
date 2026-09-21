import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
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
import {
  LoginDto,
  RequestPasswordResetDto,
  ConfirmPasswordResetDto,
} from './dto/auth.dto.js';
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

  // ---------------------------------------------------------------------------
  // Phase K / D7 §19 — Session management (F3)
  // The current session id comes from the authenticated refresh-cookie `sid`
  // claim — never inferred from user-agent/IP heuristics.
  // ---------------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(AccessTokenGuard)
  async listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const currentSid = await this.currentSidFromRequest(request);
    return this.authService.listSessions(user.userId, currentSid);
  }

  // Revoke ONE session the caller owns (owner-scoped: id + userId both match).
  @Delete('sessions/:sid')
  @UseGuards(AccessTokenGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sid') sid: string,
  ) {
    await this.authService.revokeSessionByOwner(sid, user.userId);
    return { message: 'Session revoked' };
  }

  // Revoke every non-current session the caller owns. The current session is
  // preserved so the caller stays signed in on this device.
  @Delete('sessions')
  @UseGuards(AccessTokenGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async revokeAllOtherSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const currentSid = await this.currentSidFromRequest(request);
    await this.authService.revokeAllOtherSessions(user.userId, currentSid);
    return { message: 'All other sessions revoked' };
  }

  // ---------------------------------------------------------------------------
  // Phase K / D7 §19 — Password reset (F5)
  // Uniform responses — the reset request never reveals whether the address
  // exists (no user enumeration). Reset confirm swaps the password and revokes
  // every session for that user.
  // ---------------------------------------------------------------------------

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto.rawToken, dto.newPassword);
  }

  // Derive the current session id from the signed refresh-cookie `sid` claim
  // (if present and still verifiable). Returns undefined when there is no
  // refresh cookie — the caller is then listing without a "current" marker.
  private async currentSidFromRequest(request: Request): Promise<string | undefined> {
    const refreshToken = request.cookies?.['refresh_token'] as string | undefined;
    if (!refreshToken) {
      return undefined;
    }
    try {
      const { sid } = await this.authService.verifyRefreshToken(refreshToken);
      return sid;
    } catch {
      return undefined;
    }
  }
}
