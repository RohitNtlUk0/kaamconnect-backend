import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { SendWhatsAppOtpDto } from './dto/send-whatsapp-otp.dto';
import { UserRole } from '../users/entities/user.entity';
import { DirectWhatsAppService } from './direct-whatsapp.service';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';

type OtpChallengeRow = { id: string; code_hash: string; role: UserRole };

@Injectable()
export class WhatsAppOtpService {
  private readonly logger = new Logger(WhatsAppOtpService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly directWhatsApp: DirectWhatsAppService,
  ) {}

  private get settings() {
    return this.config.get<{
      enabled: boolean;
      provider: string;
      sessionPath: string;
      hashSecret: string;
      codeTtlSeconds: number;
      accessToken: string;
      phoneNumberId: string;
      templateName: string;
      templateLanguage: string;
      graphApiVersion: string;
    }>('whatsappOtp');
  }

  get isConfigured(): boolean {
    const settings = this.settings;
    if (!settings?.enabled || settings.hashSecret.length < 32) return false;
    if (['baileys', 'direct'].includes(settings.provider)) return this.directWhatsApp.isConnected;
    if (settings.provider === 'meta') {
      return !!settings.accessToken && !!settings.phoneNumberId && !!settings.templateName;
    }
    const legacyProvider = settings.provider.toUpperCase();
    const apiKey = process.env.WHATSAPP_API_KEY || '';
    if (legacyProvider === '2FACTOR') return !!apiKey;
    if (legacyProvider === 'FAST2SMS') return !!apiKey;
    if (legacyProvider === 'MSG91') {
      const hasAuth = !!(process.env.MSG91_AUTHKEY || apiKey);
      return hasAuth && (process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER
        ? !!process.env.MSG91_WHATSAPP_TEMPLATE_NAME
        : !!process.env.MSG91_TEMPLATE_ID);
    }
    return false;
  }

  async getDeliveryChannel(): Promise<'whatsapp' | 'firebase'> {
    if (!this.isConfigured) return 'firebase';
    try {
      const result = await this.db.query<{ ready: boolean }>(
        `SELECT to_regclass('public.whatsapp_otp_challenges') IS NOT NULL AS ready`,
      );
      return result.rows[0]?.ready === true ? 'whatsapp' : 'firebase';
    } catch {
      return 'firebase';
    }
  }

  async sendOtp(dto: SendWhatsAppOtpDto, clientIp?: string, _userAgent?: string) {
    this.assertConfigured();
    const phone = dto.phoneNumber.trim();
    if (!/^\+91[6-9]\d{9}$/.test(phone)) {
      throw new BadRequestException('A valid Indian mobile number is required.');
    }
    await this.usersService.checkAbuseLockout(phone, clientIp);

    const recent = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM whatsapp_otp_challenges
        WHERE phone_number = $1 AND created_at >= NOW() - INTERVAL '15 minutes'`,
      [phone],
    );
    if (!recent.rows[0]) {
      throw new ServiceUnavailableException('OTP database is unavailable.');
    }
    if (Number(recent.rows[0].count) >= 5) {
      throw new HttpException(
        'Bahut zyada OTP requests. Kripya 15 minute baad dobara koshish karein.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challengeId = randomUUID();
    const ttl = Math.max(60, Math.min(600, this.settings.codeTtlSeconds || 300));
    const role = dto.role || UserRole.CUSTOMER;
    if ([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT].includes(role)) {
      throw new ForbiddenException('Privileged roles cannot be assigned through phone OTP.');
    }

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO whatsapp_otp_challenges
         (id, phone_number, role, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 second'))
       RETURNING id`,
      [challengeId, phone, role, this.hashCode(challengeId, phone, code), ttl],
    );
    if (inserted.rowCount !== 1) {
      throw new ServiceUnavailableException('OTP database is unavailable.');
    }

    try {
      await this.dispatchToWhatsAppGateway(phone, code, ttl);
      const sent = await this.db.query(
        `UPDATE whatsapp_otp_challenges SET sent_at = NOW()
          WHERE id = $1 AND sent_at IS NULL AND verified_at IS NULL`,
        [challengeId],
      );
      if (sent.rowCount !== 1) {
        throw new ServiceUnavailableException('OTP state could not be saved.');
      }
    } catch (error) {
      await this.db.query('DELETE FROM whatsapp_otp_challenges WHERE id = $1', [challengeId]);
      throw error;
    }

    return { challengeId, sessionId: challengeId, expiresInSeconds: ttl };
  }

  async verifyOtp(
    dto: {
      phoneNumber: string;
      otp?: string;
      code?: string;
      sessionId?: string;
      challengeId?: string;
      role?: UserRole;
      fullName?: string;
      deviceInfo?: string;
    },
    clientIp?: string,
    userAgent?: string,
  ) {
    this.assertVerificationEnabled();
    const phone = dto.phoneNumber.trim();
    const code = (dto.code || dto.otp || '').trim();
    const challengeId = dto.challengeId || dto.sessionId || '';
    if (!/^\+91[6-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code) || !challengeId) {
      throw new BadRequestException('Valid phone number, challenge ID, and six-digit code are required.');
    }

    const challenge = await this.db.query<OtpChallengeRow>(
      `UPDATE whatsapp_otp_challenges
          SET attempt_count = attempt_count + 1
        WHERE id = $1 AND phone_number = $2 AND sent_at IS NOT NULL
          AND verified_at IS NULL AND expires_at > NOW() AND attempt_count < 5
        RETURNING id, code_hash, role`,
      [challengeId, phone],
    );
    const record = challenge.rows[0];
    if (!record || !this.matchesHash(record.code_hash, challengeId, phone, code)) {
      throw new UnauthorizedException('WhatsApp OTP is invalid, expired, or has too many attempts.');
    }

    const consumed = await this.db.query(
      `UPDATE whatsapp_otp_challenges SET verified_at = NOW()
        WHERE id = $1 AND phone_number = $2 AND verified_at IS NULL
        RETURNING id`,
      [challengeId, phone],
    );
    if (consumed.rowCount !== 1) {
      throw new UnauthorizedException('WhatsApp OTP has already been used.');
    }

    const role = dto.role || record.role || UserRole.CUSTOMER;
    if ([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT].includes(role)) {
      throw new ForbiddenException('Privileged roles cannot be assigned through phone OTP.');
    }
    const user = await this.usersService.findOrCreateFromWhatsApp({
      phoneNumber: phone,
      role,
      fullName: dto.fullName || 'WhatsApp User',
      deviceInfo: dto.deviceInfo,
    });
    if (!user?.id || user.id.startsWith('user_')) {
      throw new ServiceUnavailableException('User database is unavailable.');
    }
    await this.usersService.logAuthAttempt({
      userId: user.id,
      phoneNumber: phone,
      ipAddress: clientIp,
      userAgent,
      status: 'SUCCESS',
    });

    const accessToken = this.jwtService.sign({
      sub: user.id,
      uid: user.firebase_uid,
      role: user.role,
      phone: user.phone_number,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        phoneNumber: user.phone_number,
        role: user.role,
        fullName: user.full_name,
        isVerified: user.is_verified ?? true,
        isActive: user.is_active,
        lastLoginAt: user.last_login_at,
      },
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('WhatsApp OTP is not currently available.');
    }
  }

  private assertVerificationEnabled(): void {
    if (!this.settings?.enabled || this.settings.hashSecret.length < 32) {
      throw new ServiceUnavailableException('WhatsApp OTP verification is not currently available.');
    }
  }

  private hashCode(challengeId: string, phone: string, code: string): string {
    return createHmac('sha256', this.settings.hashSecret)
      .update(`${challengeId}:${phone}:${code}`)
      .digest('hex');
  }

  private matchesHash(expectedHex: string, challengeId: string, phone: string, code: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(this.hashCode(challengeId, phone, code), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /**
   * Dispatches WhatsApp message using the configured provider and requires acceptance.
   */
  private async dispatchToWhatsAppGateway(
    phoneNumber: string,
    otpCode: string,
    ttlSeconds: number,
  ): Promise<void> {
    const provider = this.settings.provider.toUpperCase();
    if (provider === 'BAILEYS' || provider === 'DIRECT') {
      if (!this.directWhatsApp.isConnected) {
        throw new ServiceUnavailableException('WhatsApp sender is not connected.');
      }
      const accepted = await this.directWhatsApp.sendOtpMessage(phoneNumber, otpCode, ttlSeconds);
      if (!accepted) throw new ServiceUnavailableException('WhatsApp did not accept the OTP message.');
      return;
    }

    const apiKey = process.env.WHATSAPP_API_KEY || '';
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const messageText = `\u{1F512} Aapka KaamConnect Login OTP hai: ${otpCode}. Yeh ${Math.ceil(ttlSeconds / 60)} minute ke liye valid hai. Kisi ke saath share na karein.`;
    let response: Response;

    try {
      if (provider === '2FACTOR' && apiKey) {
        response = await fetch(`https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/WA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: process.env.WHATSAPP_SENDER || 'KAAMCONNECT',
            To: cleanNumber,
            Msg: messageText,
            Otp: otpCode,
          }),
        });
      } else if (provider === 'FAST2SMS' && apiKey) {
        response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: { authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            route: 'otp',
            variables_values: otpCode,
            numbers: cleanNumber.slice(-10),
          }),
        });
      } else if (provider === 'MSG91' && (process.env.MSG91_AUTHKEY || apiKey)) {
        const authKey = process.env.MSG91_AUTHKEY || apiKey;
        const clean10Digits = cleanNumber.slice(-10);
        if (process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER) {
          response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authkey: authKey },
            body: JSON.stringify({
              integrated_number: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
              content_type: 'template',
              payload: {
                messaging_product: 'whatsapp',
                type: 'template',
                template: {
                  name: process.env.MSG91_WHATSAPP_TEMPLATE_NAME || 'otp',
                  language: { code: 'en', policy: 'deterministic' },
                  to_and_components: [{
                    to: [`91${clean10Digits}`],
                    components: { body_variable_values: { '1': otpCode } },
                  }],
                },
              },
            }),
          });
        } else {
          const url = new URL('https://control.msg91.com/api/v5/otp');
          url.searchParams.set('template_id', process.env.MSG91_TEMPLATE_ID || '');
          url.searchParams.set('mobile', `91${clean10Digits}`);
          url.searchParams.set('otp', otpCode);
          url.searchParams.set('otp_length', '6');
          url.searchParams.set('otp_expiry', String(Math.ceil(ttlSeconds / 60)));
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authkey: authKey },
          });
        }
      } else if (provider === 'META') {
        const settings = this.settings;
        if (!settings.accessToken || !settings.phoneNumberId || !settings.templateName) {
          throw new ServiceUnavailableException('Meta WhatsApp template configuration is incomplete.');
        }
        const url = `https://graph.facebook.com/${settings.graphApiVersion}/${settings.phoneNumberId}/messages`;
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanNumber,
            type: 'template',
            template: {
              name: settings.templateName,
              language: { code: settings.templateLanguage || 'en' },
              components: [{
                type: 'body',
                parameters: [{ type: 'text', text: otpCode }],
              }],
            },
          }),
        });
      } else {
        throw new ServiceUnavailableException('No WhatsApp delivery provider is configured.');
      }

      const payload = await response.json().catch(() => null) as
        | { messages?: Array<{ id?: string }>; Status?: string; type?: string; return?: boolean }
        | null;
      if (!response.ok) {
        throw new ServiceUnavailableException('WhatsApp provider rejected the OTP message.');
      }
      if (provider === 'META' && !payload?.messages?.[0]?.id) {
        throw new ServiceUnavailableException('Meta did not confirm WhatsApp message acceptance.');
      }
      if (provider === '2FACTOR' && payload?.Status?.toLowerCase() !== 'success') {
        throw new ServiceUnavailableException('2Factor did not confirm WhatsApp message acceptance.');
      }
      if (provider === 'FAST2SMS' && payload?.return !== true) {
        throw new ServiceUnavailableException('Fast2SMS did not confirm message acceptance.');
      }
      if (provider === 'MSG91' && payload?.type?.toLowerCase() !== 'success') {
        throw new ServiceUnavailableException('MSG91 did not confirm message acceptance.');
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn('WhatsApp delivery provider failed to accept the OTP message.');
      throw new ServiceUnavailableException('WhatsApp delivery failed. Please retry.');
    }
  }
}
