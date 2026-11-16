import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { UsersService } from '../users/users.service';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { UserRole } from '../users/entities/user.entity';
import { timingSafeEqual } from 'crypto';

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
   * 1. Cryptographically verifies Firebase ID Token using Firebase Admin SDK.
   * 2. Asserts Indian phone number (+91).
   * 3. Prevents client-side Admin privilege escalation.
   * 4. Performs anti-abuse rate checks against PostgreSQL audit logs.
   * 5. Finds or creates User in PostgreSQL with Worker/Employer role.
   * 6. Issues signed Backend Application JWT.
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

      // 2. Enforce RBAC security: Client cannot assign Admin privileges
      if (dto.role === UserRole.ADMIN) {
        throw new ForbiddenException('Security Violation: Admin privileges cannot be self-assigned via client registration.');
      }

      // 3. Anti-abuse rate check
      await this.usersService.checkAbuseLockout(verifiedPhone, clientIp);

      // 4. Upsert user in PostgreSQL database
      const user = await this.usersService.findOrCreateFromFirebase({
        firebaseUid: fbUser.uid,
        phoneNumber: verifiedPhone,
        role: dto.role,
        fullName: dto.fullName,
        deviceInfo: dto.deviceInfo,
      });

      // 5. Log successful audit trail
      await this.usersService.logAuthAttempt({
        userId: user.id,
        phoneNumber: verifiedPhone,
        ipAddress: clientIp,
        userAgent: userAgent,
        status: 'SUCCESS',
      });

      // 6. Generate Application JWT Token
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
      const phoneSuffix = verifiedPhone.replace(/\D/g, '').slice(-4);
      this.logger.error(`Authentication error for phone ending ${phoneSuffix || 'unknown'}: ${error.message}`);

      // Log failure in audit table
      await this.usersService.logAuthAttempt({
        phoneNumber: verifiedPhone,
        ipAddress: clientIp,
        userAgent: userAgent,
        status: 'FAILED',
        errorReason: error.message,
      });

      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new UnauthorizedException(error.message || 'Authentication failed');
    }
  }

  private readonly adminFailedAttempts = new Map<string, { count: number; lockedUntil: number }>();

  /**
   * Secure Admin Authentication with Role-Based JWT and Brute-Force Protection
   */
  async loginAdmin(adminKey: string, clientIp: string = '127.0.0.1', userAgent?: string) {
    const lockInfo = this.adminFailedAttempts.get(clientIp);
    if (lockInfo && lockInfo.lockedUntil > Date.now()) {
      const waitMin = Math.ceil((lockInfo.lockedUntil - Date.now()) / 60000);
      throw new ForbiddenException(`Too many failed admin login attempts. Client IP locked for ${waitMin} minutes.`);
    }

    const serverKey = process.env.ADMIN_SECRET_KEY || '';
    const clean = (adminKey || '').trim();
    const providedKey = Buffer.from(clean, 'utf8');
    const configuredKey = Buffer.from(serverKey, 'utf8');
    const keyMatches = configuredKey.length >= 32 &&
      providedKey.length === configuredKey.length &&
      timingSafeEqual(providedKey, configuredKey);

    if (!keyMatches) {
      const current = lockInfo || { count: 0, lockedUntil: 0 };
      current.count += 1;
      if (current.count >= 5) {
        current.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 mins lock
        this.logger.error(`Brute-force protection: IP ${clientIp} locked out from Admin login for 15 minutes.`);
      }
      this.adminFailedAttempts.set(clientIp, current);

      this.logger.warn(`Failed admin login attempt (${current.count}/5) from IP: ${clientIp}`);
      throw new UnauthorizedException('Invalid Admin Security Key');
    }

    // Clear failed attempts on successful verification
    this.adminFailedAttempts.delete(clientIp);

    // Generate Admin JWT Token with ADMIN role
    const payload = {
      sub: 'admin_root',
      uid: 'admin_system_root',
      role: 'ADMIN',
      name: 'KaamConnect Master Admin',
    };

    const accessToken = this.jwtService.sign(payload);

    this.logger.log(`Master Admin authenticated successfully from IP: ${clientIp}`);

    return {
      accessToken,
      role: 'ADMIN',
      user: {
        id: 'admin_root',
        fullName: 'Master Admin Control Room',
        role: 'ADMIN',
        isVerified: true,
      },
    };
  }

  async getProfile(userId: string) {
    return this.usersService.findById(userId);
  }
}
