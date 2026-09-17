import { Controller, Post, Get, Body, Query, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { AuthService } from '../application/auth.service.js';
import {
  LoginDto,
  RegisterDto,
  AuthResponseDto,
  CheckEmailAvailabilityDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from '../application/dto/auth.dto.js';
import { InvalidRefreshTokenException } from '../domain/exceptions/auth.exceptions.js';
import { REFRESH_TOKEN_EXPIRY_DAYS, REFRESH_TOKEN_COOKIE_NAME } from '../domain/auth.types.js';

const COOKIE_OPTIONS: CookieSerializeOptions = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60, // seconds
};

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('email-availability')

  @ApiOperation({ summary: 'Check whether an e-mail is available for registration' })
  @ApiResponse({ status: 200, description: 'Availability status returned' })
  async checkEmailAvailability(
    @Query() query: CheckEmailAvailabilityDto,
  ): Promise<{ available: boolean }> {
    return { available: await this.authService.isEmailAvailable(query.email) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials or inactive account' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto);

    reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);

    return {
      accessToken: result.accessToken,
      userId: result.userId,
      email: result.email,
      role: result.role,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request affiliate password reset instructions' })
  @ApiResponse({ status: 200, description: 'If the affiliate exists, reset instructions are sent' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto);
    return {
      message: 'Se esse e-mail estiver cadastrado, enviaremos as instruções.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset affiliate password using a recovery token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto);
    return { message: 'Senha alterada com sucesso.' };
  }

  @Post('register')

  @ApiOperation({ summary: 'Register a new affiliate account' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto);

    reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);

    return {
      accessToken: result.accessToken,
      userId: result.userId,
      email: result.email,
      role: result.role,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)

  @ApiOperation({ summary: 'Refresh access token using httpOnly cookie' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponseDto> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (!rawToken) throw new InvalidRefreshTokenException();

    const result = await this.authService.refresh(rawToken);

    reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);

    return {
      accessToken: result.accessToken,
      userId: result.userId,
      email: result.email,
      role: result.role,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (rawToken) {
      await this.authService.logout(rawToken);
    }

    reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/api/v1/auth' });
  }
}
