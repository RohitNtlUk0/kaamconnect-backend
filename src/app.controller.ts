import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  @Get()
  @SkipThrottle()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getRoot() {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>KaamConnect Production API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #334155; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .badge { display: inline-flex; align-items: center; gap: 6px; background: #064e3b; color: #34d399; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 13px; margin-bottom: 16px; }
          .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block; }
          h1 { margin: 0 0 6px; font-size: 24px; font-weight: 800; color: #f8fafc; }
          p { color: #94a3b8; margin: 0 0 20px; font-size: 14px; }
          .status { background: #0f172a; border-radius: 10px; padding: 14px; text-align: left; font-family: monospace; font-size: 13px; color: #38bdf8; line-height: 1.8; border: 1px solid #1e293b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge"><span class="dot"></span> LIVE & HEALTHY</div>
          <h1>KaamConnect API</h1>
          <p>Production Hyper-local Marketplace Backend</p>
          <div class="status">
            ✓ Status: 200 OK<br>
            ✓ Version: 1.0.0 (Production)<br>
            ✓ WhatsApp Engine: Connected (+917251046727)<br>
            ✓ API Prefix: /api/v1<br>
            ✓ Time: ${new Date().toISOString()}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  @Get('health')
  @SkipThrottle()
  getHealth() {
    return {
      status: 'UP',
      service: 'KaamConnect API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
