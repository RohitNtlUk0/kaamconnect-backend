import { BadRequestException, Controller, Post, Body, Req, Get, UseGuards, HttpCode, HttpStatus, Header } from '@nestjs/common';
import { Throttle, ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { DirectWhatsAppService } from './direct-whatsapp.service';
import { TelegramOtpService } from './telegram-otp.service';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { SendWhatsAppOtpDto } from './dto/send-whatsapp-otp.dto';
import { VerifyWhatsAppOtpDto } from './dto/verify-whatsapp-otp.dto';
import { VerifyAppWhatsAppOtpDto } from './dto/verify-app-whatsapp-otp.dto';
import { SendTelegramOtpDto } from './dto/send-telegram-otp.dto';
import { VerifyTelegramOtpDto } from './dto/verify-telegram-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly whatsAppOtpService: WhatsAppOtpService,
    private readonly directWhatsApp: DirectWhatsAppService,
    private readonly telegramOtpService: TelegramOtpService,
  ) {}

  /**
   * Main Login / Registration Endpoint:
   * Verifies Firebase ID Token, validates +91 Indian phone,
   * updates/creates PostgreSQL user record, and returns signed application JWT.
   */
  @Post('phone-login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @SkipThrottle()
  @Get('otp-channel')
  async getOtpChannel() {
    return {
      success: true,
      data: { channel: await this.whatsAppOtpService.getDeliveryChannel() },
    };
  }

  /**
   * Dispatches 6-digit verification code via WhatsApp to Indian mobile number.
   */
  @Post('whatsapp/send-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sendWhatsAppOtp(@Body() dto: SendWhatsAppOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.whatsAppOtpService.sendOtp(dto, clientIp, userAgent);

    return {
      success: true,
      message: 'OTP aapke WhatsApp number par bhej diya gaya hai.',
      data: result,
    };
  }

  @Post('whatsapp-otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sendAppWhatsAppOtp(@Body() dto: SendWhatsAppOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';
    const result = await this.whatsAppOtpService.sendOtp(dto, clientIp, userAgent);
    return { success: true, message: 'OTP aapke WhatsApp number par bhej diya gaya hai.', data: result };
  }

  /**
   * Verifies 6-digit WhatsApp OTP and logs in / registers the user with signed JWT.
   */
  @Post('whatsapp/verify-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyWhatsAppOtp(@Body() dto: VerifyWhatsAppOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.whatsAppOtpService.verifyOtp(dto, clientIp, userAgent);

    return {
      success: true,
      message: 'WhatsApp verification safalta se poori ho gayi.',
      data: result,
    };
  }

  @Post('whatsapp-otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyAppWhatsAppOtp(@Body() dto: VerifyAppWhatsAppOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';
    const result = await this.whatsAppOtpService.verifyOtp(dto, clientIp, userAgent);
    return { success: true, message: 'WhatsApp verification safalta se poori ho gayi.', data: result };
  }

  /**
   * Dispatches 6-digit verification code via Telegram Bot to Indian mobile number.
   */
  @Post('telegram/send-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sendTelegramOtp(@Body() dto: SendTelegramOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.telegramOtpService.sendOtp(dto, clientIp, userAgent);

    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  /**
   * Verifies 6-digit Telegram OTP and logs in / registers the user with signed JWT.
   */
  @Post('telegram/verify-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyTelegramOtp(@Body() dto: VerifyTelegramOtpDto, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    const result = await this.telegramOtpService.verifyOtp(dto, clientIp, userAgent);

    return {
      success: true,
      message: 'Telegram verification safalta se poori ho gayi.',
      data: result,
    };
  }

  /**
   * Telegram Engine Status
   */
  @SkipThrottle()
  @Get('telegram/status')
  getTelegramStatus() {
    return {
      success: true,
      botUsername: 'Kaamconnect_otp_bot',
      botUrl: 'https://t.me/Kaamconnect_otp_bot',
      isActive: true,
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

  /**
   * Direct WhatsApp Engine: Connection Status
   */
  @SkipThrottle()
  @Get('whatsapp/status')
  getWhatsAppStatus() {
    const status = this.directWhatsApp.getStatus();
    return {
      success: true,
      data: { isConnected: status.isConnected, connectionState: status.connectionState },
    };
  }

  /**
   * Direct WhatsApp Engine: Request 8-character Pairing Code
   */
  @SkipThrottle()
  @Get('whatsapp/pair-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getPairingCode(@Req() req: Request) {
    const phone = (req.query.phone as string) || '';
    if (!phone) throw new BadRequestException('Pass the linked sender phone number in the phone query parameter.');
    try {
      const code = await this.directWhatsApp.requestPairingCode(phone);
      return {
        success: true,
        phoneNumber: phone,
        pairingCode: code,
        instructions:
          'Open WhatsApp > Settings > Linked Devices > Link a device > Link with phone number instead, then enter this code.',
      };
    } catch (e) {
      return {
        success: false,
        message: e.message,
      };
    }
  }

  /**
   * Direct WhatsApp Engine: 1-Click Browser Link Page
   */
  @SkipThrottle()
  @Get('whatsapp/link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getWhatsAppLinkPage() {
    const status = this.directWhatsApp.getStatus();
    const qrData = await this.directWhatsApp.getQrDataUrl();

    let content = '';
    if (status.isConnected) {
      content = '<div class="badge badge-connected">WhatsApp Linked (' + status.connectedPhone + ')</div>' +
                '<h3 style="color: #2e7d32; margin: 10px 0;">WhatsApp Successfully Connected!</h3>' +
                '<p style="color: #475569;">KaamConnect ab aapke WhatsApp Business se real OTPs bhejega.</p>';
    } else {
      content = '<div class="badge badge-waiting">Scan with WhatsApp Business</div>' +
                '<div style="background: #f8fafc; border: 2px dashed #25d366; border-radius: 16px; padding: 14px; margin: 14px 0;">' +
                (qrData ? '<img class="qr" src="' + qrData + '" alt="QR Code" />' : '<p style="color: #64748b;">Generating QR Code...</p>') +
                '<p style="font-size: 13px; color: #16a34a; font-weight: 600; margin: 8px 0 0 0;">WhatsApp Business aur Normal WhatsApp dono kaam karte hain</p>' +
                '</div>' +
                '<div class="steps">' +
                '<b>WhatsApp Business me kaise scan karein:</b><br>' +
                '1. Apne phone me <b>WhatsApp Business</b> app kholein.<br>' +
                '2. Upar dain taraf <b>3 dots (⋮)</b> dabayein.<br>' +
                '3. <b>Linked devices (लिंक्ड डिवाइसेस)</b> par click karein.<br>' +
                '4. <b>Link a device (डिवाइस लिंक करें)</b> dabayein.<br>' +
                '5. Phone camera ko is QR Code ke samne layein — <b>1 second me connect ho jayega!</b><br>' +
                '</div>' +
                '<div style="margin-top: 14px;">' +
                '<button class="btn" onclick="window.location.reload()">Refresh Page</button>' +
                '</div>' +
                '<script>' +
                'setInterval(async () => {' +
                '  try {' +
                '    const r = await fetch("/api/v1/auth/whatsapp/status");' +
                '    const d = await r.json();' +
                '    if (d.data && d.data.isConnected) {' +
                '      window.location.reload();' +
                '    }' +
                '  } catch(e) {}' +
                '}, 3000);' +
                'setTimeout(() => window.location.reload(), 25000);' +
                '</script>';
    }

    return '<!DOCTYPE html>' +
      '<html lang="hi"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>KaamConnect WhatsApp Linker</title>' +
      '<style>' +
      '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }' +
      'body { background: #f0f4f8; padding: 20px; display: flex; justify-content: center; }' +
      '.card { background: #fff; max-width: 480px; width: 100%; border-radius: 20px; padding: 24px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }' +
      '.badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 700; margin-bottom: 12px; font-size: 14px; }' +
      '.badge-connected { background: #e8f5e9; color: #2e7d32; }' +
      '.badge-waiting { background: #fff3e0; color: #ef6c00; }' +
      '.btn { background: #25d366; color: white; border: none; padding: 12px 20px; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; width: 100%; text-decoration: none; display: inline-block; }' +
      '.steps { text-align: left; background: #f8fafc; border-radius: 12px; padding: 14px; font-size: 13px; color: #334155; line-height: 1.8; margin-top: 14px; }' +
      'img.qr { width: 240px; height: 240px; border-radius: 12px; display: block; margin: 0 auto; }' +
      '</style></head><body>' +
      '<div class="card">' +
      '<div style="font-size: 36px; margin-bottom: 6px;">📲</div>' +
      '<h2>KaamConnect WhatsApp Engine</h2>' +
      '<p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">Real Free WhatsApp OTP Gateway</p>' +
      content +
      '</div></body></html>';
  }
}
