import 'dotenv/config';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

process.umask(0o077);
const sessionPath = path.resolve(
  process.cwd(),
  process.env.WHATSAPP_SESSION_PATH || './whatsapp_session',
);
const qrImagePath = path.join(os.tmpdir(), `kaamconnect-whatsapp-pair-${process.pid}.png`);
let qrPrinted = false;
let finished = false;
let connectionOpened = false;
let socket: ReturnType<typeof makeWASocket> | undefined;

async function cleanup(exitCode: number) {
  if (finished) return;
  finished = true;
  if (fs.existsSync(qrImagePath)) fs.unlinkSync(qrImagePath);
  socket?.end(undefined);
  setTimeout(() => process.exit(exitCode), 300).unref();
}

async function pairWhatsApp() {
  fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(sessionPath, 0o700);
  } catch {
    // Windows does not apply POSIX directory modes; keep the folder out of source control.
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  socket = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('KaamConnect'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  socket.ev.on('creds.update', async () => saveCreds());
  socket.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      await QRCode.toFile(qrImagePath, qr, { width: 1024, margin: 4, errorCorrectionLevel: 'H' });
      qrPrinted = true;
      console.log(`PAIR_QR_READY=${qrImagePath}`);
      console.log('Scan with WhatsApp > Linked devices > Link a device. Treat this QR as an account credential.');
    }

    if (connection === 'open') {
      connectionOpened = true;
      console.log('WhatsApp linked. Session files are saved in the configured session directory.');
      setTimeout(() => void cleanup(0), 1_000).unref();
    }

    if (connection === 'close') {
      if (connectionOpened || finished) return;
      const statusCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('WhatsApp pairing session was logged out. Start pairing again.');
      } else if (!qrPrinted) {
        console.error('WhatsApp pairing disconnected before showing a QR. Retry after checking network access.');
      } else {
        console.error('WhatsApp pairing disconnected before completion. Retry with a fresh QR.');
      }
      await cleanup(1);
    }
  });

  process.once('SIGINT', () => void cleanup(130));
  process.once('SIGTERM', () => void cleanup(143));
}

pairWhatsApp().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown pairing error.';
  console.error(`WhatsApp pairing failed: ${message}`);
  void cleanup(1);
});