import { Controller, Post, Body, Req, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Main Login / Registration Endpoint:
   * Verifies Firebase ID Token, validates +91 Indian phone,
   * updates/creates PostgreSQL user record, and returns signed application JWT.
   */
  @Post('phone-login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // Anti-abuse: Max 5 requests per minute per IP
  async phoneLogin(@Body() dto: PhoneLoginDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.authService.loginWithPhone(dto, clientIp, userAgent);

    return {
      success: true,
      message: 'Mobile number authenticated successfully with KaamConnect',
      data: result,
    };
  }

  /**
   * Secure Admin Authentication Endpoint
   * Returns a signed JWT with role: 'ADMIN' for RBAC authorization
   */
  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() body: { adminKey: string }, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.authService.loginAdmin(body.adminKey, clientIp, userAgent);

    return {
      success: true,
      message: 'Master Admin authenticated successfully',
      data: result,
    };
  }

  /**
   * Protected endpoint to get current authenticated user profile
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: any) {
    return {
      success: true,
      data: req.user,
    };
  }
}
