import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as qrcode from 'qrcode';

@Injectable()
export class DirectWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DirectWhatsAppService.name);
  private sock: any = null;
  private isConnected: boolean = false;
  private currentPairingCode: string | null = null;
  private lastQrRaw: string | null = null;
  private connectedPhone: string | null = null;
  private isInitializing: boolean = false;
  private authDir: string = path.join(process.cwd(), 'whatsapp_session');

  async onModuleInit() {
    this.logger.log('Initializing Direct WhatsApp Engine...');
    await this.initSocket();
  }

  async onModuleDestroy() {
    if (this.sock) {
      try {
        this.sock.end();
      } catch (e) {}
    }
  }

  /**
   * Initializes the Baileys WhatsApp Web socket connection.
   */
  async initSocket(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }

      const {
        default: makeWASocket,
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
        DisconnectReason,
      } = require('@whiskeysockets/baileys');
      const pino = require('pino');

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1015901307],
      }));

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
      });

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.lastQrRaw = qr;
          this.logger.log('📷 Fresh WhatsApp QR Code received. Generating image files...');
          
          try {
            qrcode.toFile('C:\\Users\\jyoti\\Desktop\\whatsapp_qr.png', qr, { width: 360, margin: 2 }, (err: any) => {
              if (err) this.logger.error(`Failed to save desktop QR: ${err.message}`);
            });
            const artifactDir = 'C:\\Users\\jyoti\\.gemini\\antigravity\\brain\\9c4685d7-10dd-4d20-9b4a-ec67acb26391';
            qrcode.toFile(path.join(artifactDir, 'whatsapp_qr.png'), qr, { width: 360, margin: 2 }, () => {});
          } catch (e) {}
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason?.loggedOut;

          this.logger.warn(
            `Direct WhatsApp Connection closed (status: ${statusCode}).`,
          );

          // If logged out or unlinked, always wipe invalid session files cleanly
          if (isLoggedOut) {
            this.logger.warn('Session logged out or invalid. Resetting session directory...');
            try {
              fs.rmSync(this.authDir, { recursive: true, force: true });
            } catch (e) {}
            this.connectedPhone = null;
            this.currentPairingCode = null;
            this.lastQrRaw = null;
          }

          // Auto-reconnect cleanly
          setTimeout(() => {
            this.isInitializing = false;
            this.initSocket();
          }, 3000);
        } else if (connection === 'open') {
          this.isConnected = true;
          this.lastQrRaw = null;
          this.currentPairingCode = null;
          const userJid = this.sock?.user?.id || '';
          this.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
          this.logger.log(
            `🚀 Direct WhatsApp Engine CONNECTED successfully! Linked Phone: ${this.connectedPhone}`,
          );
        } else if (connection === 'connecting') {
          this.logger.log('Direct WhatsApp Engine connecting...');
        }
      });
    } catch (err) {
      this.logger.error(`Error initializing Direct WhatsApp: ${err.message}`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generates an 8-character Pairing Code for the given phone number.
   * e.g. "917251046727" -> "R4HSH4WS"
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    const cleanNumber = phoneNumber.replace(/\D/g, '');

    if (this.isConnected) {
      return 'ALREADY_CONNECTED';
    }

    if (!this.sock) {
      this.isInitializing = false;
      await this.initSocket();
      await new Promise((r) => setTimeout(r, 4000));
    }

    try {
      this.logger.log(`Requesting pairing code for ${cleanNumber}...`);
      const code = await this.sock.requestPairingCode(cleanNumber);
      this.currentPairingCode = code;
      this.logger.log(
        `[Direct WhatsApp] Pairing Code generated for ${cleanNumber}: ${code}`,
      );
      return code;
    } catch (err) {
      this.logger.warn(`Pairing request failed (${err.message})`);
      throw err;
    }
  }

  /**
   * Returns QR code as HTML/DataURL.
   */
  async getQrDataUrl(): Promise<string | null> {
    if (!this.lastQrRaw) return null;
    return await qrcode.toDataURL(this.lastQrRaw, { width: 360, margin: 2 });
  }

  /**
   * Returns current status of Direct WhatsApp engine.
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      connectedPhone: this.connectedPhone,
      pairingCode: this.currentPairingCode,
      hasQr: !!this.lastQrRaw,
    };
  }

  /**
   * Dispatches a real WhatsApp OTP message directly to recipient phone number.
   */
  async sendOtpMessage(phoneNumber: string, otpCode: string): Promise<boolean> {
    if (!this.isConnected || !this.sock) {
      this.logger.warn(
        `Direct WhatsApp is not connected. Cannot dispatch to ${phoneNumber}`,
      );
      return false;
    }

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const recipientJid = `${cleanNumber}@s.whatsapp.net`;

    const messageText = `Aapka KaamConnect login OTP hai: *${otpCode}*.\nYeh code 5 minute tak valid hai. Kripya ise kisi ke saath share na karein.\n\n- KaamConnect Team`;

    try {
      await this.sock.sendMessage(recipientJid, { text: messageText });
      this.logger.log(
        `✅ [Direct WhatsApp] Real WhatsApp message successfully delivered to ${recipientJid}!`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send Direct WhatsApp message to ${recipientJid}: ${err.message}`,
      );
      return false;
    }
  }
}
