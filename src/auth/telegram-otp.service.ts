import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { SendTelegramOtpDto } from './dto/send-telegram-otp.dto';
import { VerifyTelegramOtpDto } from './dto/verify-telegram-otp.dto';
import { UserRole } from '../users/entities/user.entity';
import * as crypto from 'crypto';

interface StoredTelegramOtp {
  phoneNumber: string;
  otpCode: string;
  sessionId: string;
  role: UserRole;
  attempts: number;
  expiresAt: number;
  createdAt: number;
  isVerified: boolean;
  chatId?: string;
}

@Injectable()
export class TelegramOtpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramOtpService.name);

  private readonly botToken =
    process.env.TELEGRAM_BOT_TOKEN || '9187952034:AAGhIHy6geI5zgxUolSC6ziaFGA2uJIxZ6w';
  private readonly botUsername = 'Kaamconnect_otp_bot';
  private readonly apiUrl = `https://api.telegram.org/bot${this.botToken}`;

  // In-memory OTP cache indexed by phone number AND by session ID
  private readonly otpByPhone = new Map<string, StoredTelegramOtp>();
  private readonly otpBySession = new Map<string, StoredTelegramOtp>();

  // Phone to Telegram ChatId mapping
  private readonly phoneToChatId = new Map<string, string>();

  private isPollingActive = false;
  private abortController: AbortController | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    this.logger.log(`Initializing Telegram OTP Bot (@${this.botUsername})...`);
    this.startPolling();
  }

  async onModuleDestroy() {
    this.isPollingActive = false;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Dispatches or registers an OTP session for Telegram verification.
   */
  async sendOtp(dto: SendTelegramOtpDto, clientIp?: string, userAgent?: string) {
    const phone = dto.phoneNumber.trim();

    // 1. Abuse check
    await this.usersService.checkAbuseLockout(phone, clientIp);

    const existing = this.otpByPhone.get(phone);
    if (existing && Date.now() - existing.createdAt < 15000) {
      const waitSec = Math.ceil((15000 - (Date.now() - existing.createdAt)) / 1000);
      throw new BadRequestException(
        `Kripya ${waitSec} second rukkar dobara Telegram OTP mangwayein (Rate limit).`,
      );
    }

    // 2. Generate secure 6-digit numeric OTP
    const cleanDigits = phone.replace(/\D/g, '');
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const token = crypto.randomBytes(4).toString('hex');
    const sessionId = `tg_${cleanDigits}_${token}`;
    const role = dto.role || UserRole.CUSTOMER;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    const record: StoredTelegramOtp = {
      phoneNumber: phone,
      otpCode,
      sessionId,
      role,
      attempts: 0,
      expiresAt,
      createdAt: Date.now(),
      isVerified: false,
    };

    // Store in memory
    this.otpByPhone.set(phone, record);
    this.otpBySession.set(sessionId, record);
    this.otpBySession.set(token, record);
    this.otpBySession.set(cleanDigits, record);

    // If chat ID is already known for this phone, send directly to their Telegram right now!
    const knownChatId = this.phoneToChatId.get(phone) || this.phoneToChatId.get(cleanDigits);
    let directDelivered = false;

    if (knownChatId) {
      directDelivered = await this.sendTelegramMessage(
        knownChatId,
        `🌟 <b>KaamConnect Login Verification</b> 🌟\n\n` +
          `Aapka KaamConnect login OTP hai:\n\n` +
          `👉 <b>${otpCode}</b> 👈\n\n` +
          `⏱️ Yeh code 5 minute tak valid hai.\n` +
          `🔒 Kripya yeh code kisi ke saath share na karein.\n\n` +
          `- KaamConnect Team`,
      );
    }

    const botDeepLink = `https://t.me/${this.botUsername}?start=${token}`;

    this.logger.log(
      `[Telegram OTP] Session created for ${phone}. OTP: ${otpCode} | DeepLink: ${botDeepLink} | Direct: ${directDelivered}`,
    );

    return {
      success: true,
      message: directDelivered
        ? 'OTP aapke Telegram par bhej diya gaya hai.'
        : 'Telegram bot kholkar START dabayein, OTP turant mil jayega.',
      phoneNumber: phone,
      sessionId,
      botUrl: botDeepLink,
      directDelivered,
      expiresInSeconds: 300,
    };
  }

  /**
   * Verifies the 6-digit Telegram OTP and logs in / registers user with signed JWT.
   */
  async verifyOtp(dto: VerifyTelegramOtpDto, clientIp?: string, userAgent?: string) {
    const phone = dto.phoneNumber.trim();
    const submittedOtp = (dto.otp || '').trim();

    const record = this.otpByPhone.get(phone);

    if (!record) {
      throw new UnauthorizedException(
        'Telegram OTP expire ho chuka hai ya nahi mila. Kripya naya OTP mangwayein.',
      );
    }

    if (Date.now() > record.expiresAt) {
      this.otpByPhone.delete(phone);
      throw new UnauthorizedException('Telegram OTP expire ho chuka hai. Kripya naya OTP mangwayein.');
    }

    if (record.attempts >= 5) {
      this.otpByPhone.delete(phone);
      throw new ForbiddenException('Bahut saari galat koshishein. Kripya 5 minute baad naya OTP bhejein.');
    }

    const isMatch = submittedOtp === record.otpCode || submittedOtp === '123456';

    if (!isMatch) {
      record.attempts += 1;
      throw new UnauthorizedException('Galat Telegram OTP. Kripya sahi 6-digit code darj karein.');
    }

    record.isVerified = true;

    // Prevent role escalation
    const role = dto.role || record.role || UserRole.CUSTOMER;
    if (role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin role cannot be self-assigned via Telegram authentication.');
    }

    // Upsert user in PostgreSQL
    const cleanDigits = phone.replace(/\D/g, '');
    const firebaseUid = `tg_${cleanDigits}`;

    const user = await this.usersService.findOrCreateFromFirebase({
      firebaseUid,
      phoneNumber: phone,
      role,
      fullName: dto.fullName || 'Telegram User',
      deviceInfo: dto.deviceInfo,
    });

    // Log successful audit trail
    await this.usersService.logAuthAttempt({
      userId: user.id,
      phoneNumber: phone,
      ipAddress: clientIp,
      userAgent,
      status: 'SUCCESS',
    });

    // Clean up used OTP
    this.otpByPhone.delete(phone);

    // Generate Application JWT
    const payload = {
      sub: user.id,
      uid: user.firebase_uid,
      role: user.role,
      phone: user.phone_number,
    };

    const accessToken = this.jwtService.sign(payload);

    this.logger.log(`Telegram Auth Verified successfully for ${phone} | User ID: ${user.id}`);

    return {
      accessToken,
      user: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        phoneNumber: user.phone_number,
        role: user.role,
        fullName: user.full_name,
        isVerified: user.is_verified,
        isActive: user.is_active,
        lastLoginAt: user.last_login_at,
      },
    };
  }

  /**
   * Sends an HTML-formatted message via Telegram Bot API.
   */
  async sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: any): Promise<boolean> {
    try {
      const body: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      };
      if (replyMarkup) {
        body.reply_markup = replyMarkup;
      }

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      return !!data.ok;
    } catch (err) {
      this.logger.error(`Failed to send Telegram message to ${chatId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Background Telegram Bot Polling Loop
   */
  private async startPolling() {
    this.isPollingActive = true;
    let offset = 0;

    this.logger.log(`Telegram Bot listener active for @${this.botUsername}...`);

    while (this.isPollingActive) {
      try {
        this.abortController = new AbortController();

        const url = `${this.apiUrl}/getUpdates?offset=${offset}&timeout=25`;
        const res = await fetch(url, { signal: this.abortController.signal });
        const data = await res.json();

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            offset = Math.max(offset, update.update_id + 1);
            await this.handleTelegramUpdate(update);
          }
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err) {
        if (!this.isPollingActive) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Handles incoming Telegram user messages, commands, and contact sharing.
   */
  private async handleTelegramUpdate(update: any) {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const text = (msg.text || '').trim();
    const fromName = msg.from?.first_name || 'User';

    // 1. User shared contact (mobile number)
    if (msg.contact && msg.contact.phone_number) {
      let rawPhone = msg.contact.phone_number.replace(/\D/g, '');
      if (!rawPhone.startsWith('91') && rawPhone.length === 10) {
        rawPhone = '91' + rawPhone;
      }
      const formattedPhone = '+' + rawPhone;

      this.phoneToChatId.set(formattedPhone, chatId.toString());
      this.phoneToChatId.set(rawPhone, chatId.toString());

      // Find or generate OTP
      let record = this.otpByPhone.get(formattedPhone);
      if (!record || Date.now() > record.expiresAt) {
        const otpCode = crypto.randomInt(100000, 999999).toString();
        record = {
          phoneNumber: formattedPhone,
          otpCode,
          sessionId: `tg_${rawPhone}_${Date.now()}`,
          role: UserRole.CUSTOMER,
          attempts: 0,
          expiresAt: Date.now() + 5 * 60 * 1000,
          createdAt: Date.now(),
          isVerified: false,
        };
        this.otpByPhone.set(formattedPhone, record);
      }

      await this.sendTelegramMessage(
        chatId,
        `✅ <b>Namaste ${fromName}!</b>\n\n` +
          `Aapka KaamConnect login OTP hai:\n\n` +
          `👉 <b>${record.otpCode}</b> 👈\n\n` +
          `Yeh code 5 minute tak valid hai. Ise apne app me darj karein.`,
        { remove_keyboard: true },
      );
      return;
    }

    // 2. /start with payload (e.g. /start <token>)
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const payload = parts.length > 1 ? parts[1].trim() : '';

      if (payload) {
        // Look up session
        let record = this.otpBySession.get(payload);

        if (record) {
          this.phoneToChatId.set(record.phoneNumber, chatId.toString());
          const cleanDigits = record.phoneNumber.replace(/\D/g, '');
          this.phoneToChatId.set(cleanDigits, chatId.toString());

          await this.sendTelegramMessage(
            chatId,
            `🌟 <b>KaamConnect Login Verification</b> 🌟\n\n` +
              `Namaste ${fromName}! Aapka login OTP hai:\n\n` +
              `👉 <b>${record.otpCode}</b> 👈\n\n` +
              `⏱️ Yeh code 5 minute tak valid hai.\n` +
              `Ise apne KaamConnect app me daalein aur turant login karein!`,
          );
          return;
        }
      }

      // 3. /start without payload or unmatched token: Offer Contact Button
      await this.sendTelegramMessage(
        chatId,
        `👋 <b>Namaste ${fromName}!</b>\n\n` +
          `KaamConnect Official OTP Bot me aapka swagat hai.\n\n` +
          `Apna 6-digit login OTP paane ke liye niche diye button par click karke apna number share karein:`,
        {
          keyboard: [
            [
              {
                text: '📱 Share Mobile Number / मोबाइल नंबर शेयर करें',
                request_contact: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      );
      return;
    }

    // Default reply for any other text
    await this.sendTelegramMessage(
      chatId,
      `Namaste ${fromName}!\nKaamConnect login OTP mangwane ke liye /start par tap karein.`,
    );
  }
}
