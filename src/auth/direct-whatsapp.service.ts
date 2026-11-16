import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';

@Injectable()
export class DirectWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DirectWhatsAppService.name);
  private socket: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private reconnectAttempts = 0;
  private state: 'disabled' | 'connecting' | 'pairing' | 'connected' | 'disconnected' | 'logged_out' = 'disabled';
  private currentQr: string | null = null;
  private currentPairingCode: string | null = null;

  constructor(private readonly config: ConfigService) {}

  private get provider(): string {
    return String(this.config.get('whatsappOtp.provider') || 'baileys').toLowerCase();
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('whatsappOtp.enabled') === true &&
      ['baileys', 'direct'].includes(this.provider);
  }

  private get sessionPath(): string {
    return path.resolve(
      process.cwd(),
      this.config.get<string>('whatsappOtp.sessionPath') || './whatsapp_session',
    );
  }

  get isConnected(): boolean {
    return this.enabled && this.state === 'connected' && this.socket !== null;
  }

  getStatus() {
    const linkedId = this.socket?.user?.id?.split(':')[0]?.split('@')[0] || '';
    return {
      isConnected: this.isConnected,
      connectionState: this.state,
      connectedPhone: linkedId ? `****${linkedId.slice(-4)}` : null,
      pairingCode: this.currentPairingCode,
      hasQr: this.currentQr !== null,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    process.umask(0o077);
    fs.mkdirSync(this.sessionPath, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.sessionPath, 0o700);
    } catch {
      // Windows filesystems do not expose POSIX directory modes.
    }
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.end(undefined);
    this.socket = null;
  }

  async sendOtpMessage(phoneNumber: string, code: string, ttlSeconds = 300): Promise<boolean> {
    const socket = this.socket;
    if (!this.isConnected || !socket) {
      throw new ServiceUnavailableException('WhatsApp sender is not connected.');
    }
    const jid = `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
    const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
    const result = await socket.sendMessage(jid, {
      text: `\u{1F512} Aapka KaamConnect Login OTP hai: ${code}. Yeh ${minutes} minute ke liye valid hai. Kisi ke saath share na karein.`,
    });
    if (!result?.key?.id) {
      throw new ServiceUnavailableException('WhatsApp did not accept the OTP message.');
    }
    return true;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    const digits = phoneNumber.replace(/\D/g, '');
    if (!/^91[6-9]\d{9}$/.test(digits)) {
      throw new ServiceUnavailableException('A valid Indian sender number is required to request a pairing code.');
    }
    if (this.isConnected) return 'ALREADY_CONNECTED';
    if (!this.socket) {
      await this.connect();
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    if (!this.socket) throw new ServiceUnavailableException('WhatsApp pairing socket is not ready.');
    const code = await this.socket.requestPairingCode(digits);
    this.currentPairingCode = code;
    return code;
  }

  async getQrDataUrl(): Promise<string | null> {
    if (!this.currentQr) return null;
    return QRCode.toDataURL(this.currentQr, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: 'H',
    });
  }

  private async connect(): Promise<void> {
    if (this.stopping || !this.enabled || this.state === 'connecting') return;
    this.state = 'connecting';
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('KaamConnect'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });
      this.socket = socket;
      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', (update) => {
        if (update.qr) {
          this.currentQr = update.qr;
          this.currentPairingCode = null;
          this.state = 'pairing';
          this.logger.warn('WhatsApp sender needs pairing. Use the protected pairing page or npm run whatsapp:pair.');
        }
        if (update.connection === 'open') {
          this.state = 'connected';
          this.currentQr = null;
          this.currentPairingCode = null;
          this.reconnectAttempts = 0;
          this.logger.log('WhatsApp sender connected.');
        }
        if (update.connection === 'close') {
          this.socket = null;
          this.currentQr = null;
          const statusCode = (
            update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            this.state = 'logged_out';
            this.logger.error('WhatsApp session was logged out. Pair the sender again on a secure host.');
            return;
          }
          this.state = 'disconnected';
          this.scheduleReconnect();
        }
      });
    } catch (error) {
      this.state = 'disconnected';
      this.logger.error(`Could not start WhatsApp sender: ${error instanceof Error ? error.message : 'unknown error'}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || !this.enabled || this.reconnectTimer) return;
    const delay = Math.min(5_000 * (2 ** this.reconnectAttempts), 60_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
