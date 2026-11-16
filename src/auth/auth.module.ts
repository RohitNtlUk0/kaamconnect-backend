import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { DirectWhatsAppService } from './direct-whatsapp.service';
import { TelegramOtpService } from './telegram-otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.expiresIn') || '30d',
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    WhatsAppOtpService,
    DirectWhatsAppService,
    TelegramOtpService,
    JwtStrategy,
    RolesGuard,
  ],
  exports: [
    AuthService,
    WhatsAppOtpService,
    DirectWhatsAppService,
    TelegramOtpService,
    JwtModule,
  ],
})
export class AuthModule {}
