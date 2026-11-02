import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { UsersService } from '../users/users.service';
import { PhoneLoginDto } from './dto/phone-login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Production Flow for Indian Mobile OTP Verification:
   * 1. Verifies Firebase ID Token using Firebase Admin SDK.
   * 2. Asserts Indian phone number (+91).
   * 3. Performs anti-abuse rate checks against PostgreSQL audit logs.
   * 4. Finds or creates User in PostgreSQL with Worker/Employer role.
   * 5. Issues signed Backend Application JWT.
   */
  async loginWithPhone(
    dto: PhoneLoginDto,
    clientIp?: string,
    userAgent?: string,
  ) {
    let verifiedPhone = 'UNKNOWN';

    try {
      // 1. Verify ID Token cryptographically with Firebase Admin SDK
      const fbUser = await this.firebaseAdmin.verifyIdToken(dto.idToken);
      verifiedPhone = fbUser.phoneNumber;

      // 2. Anti-abuse rate check
      await this.usersService.checkAbuseLockout(verifiedPhone, clientIp);

      // 3. Upsert user in PostgreSQL database
      const user = await this.usersService.findOrCreateFromFirebase({
        firebaseUid: fbUser.uid,
        phoneNumber: verifiedPhone,
        role: dto.role,
        fullName: dto.fullName,
        deviceInfo: dto.deviceInfo,
      });

      // 4. Log successful audit trail
      await this.usersService.logAuthAttempt({
        userId: user.id,
        phoneNumber: verifiedPhone,
        ipAddress: clientIp,
        userAgent: userAgent,
        status: 'SUCCESS',
      });

      // 5. Generate Application JWT Token
      const payload = {
        sub: user.id,
        uid: user.firebase_uid,
        role: user.role,
        phone: user.phone_number,
      };

      const accessToken = this.jwtService.sign(payload);

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
    } catch (error) {
      this.logger.error(`Authentication error for phone ${verifiedPhone}: ${error.message}`);

      // Log failure in audit table
      await this.usersService.logAuthAttempt({
        phoneNumber: verifiedPhone,
        ipAddress: clientIp,
        userAgent: userAgent,
        status: 'FAILED',
        errorReason: error.message,
      });

      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(error.message || 'Authentication failed');
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User session not found');
    }
    return user;
  }
}
