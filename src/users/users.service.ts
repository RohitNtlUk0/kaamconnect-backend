import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UserEntity, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Abuse Protection: Checks if the phone number or IP has encountered repeated failed attempts.
   */
  async checkAbuseLockout(phoneNumber: string, ipAddress?: string): Promise<void> {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const res = await this.db.query(
        `SELECT COUNT(*) as failed_count
         FROM auth_audit_logs
         WHERE phone_number = $1
           AND status = 'FAILED'
           AND created_at >= $2`,
        [phoneNumber, tenMinutesAgo],
      );

      const failedCount = parseInt(res.rows[0]?.failed_count || '0', 10);
      if (failedCount >= 5) {
        throw new ForbiddenException(
          'Security Alert: Too many failed verification attempts for this phone number. Please wait 15 minutes before trying again.',
        );
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      this.logger.debug(`Abuse check notice: ${e.message}`);
    }
  }

  /**
   * Logs an authentication attempt to the PostgreSQL audit ledger.
   */
  async logAuthAttempt(params: {
    userId?: string;
    phoneNumber: string;
    ipAddress?: string;
    userAgent?: string;
    status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
    errorReason?: string;
  }): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO auth_audit_logs (user_id, phone_number, ip_address, user_agent, status, error_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.userId || null,
          params.phoneNumber,
          params.ipAddress || null,
          params.userAgent || null,
          params.status,
          params.errorReason || null,
        ],
      );
    } catch (e) {
      this.logger.warn(`Could not log auth audit: ${e.message}`);
    }
  }

  /**
   * Finds an existing user by Firebase UID or Phone Number; creates a new one if not found.
   */
  async findOrCreateFromFirebase(params: {
    firebaseUid: string;
    phoneNumber: string;
    role: UserRole;
    fullName?: string;
    deviceInfo?: string;
  }): Promise<UserEntity> {
    const { firebaseUid, phoneNumber, role, fullName, deviceInfo } = params;

    try {
      // 1. Check if user already exists
      const existing = await this.db.query<UserEntity>(
        `SELECT * FROM users WHERE firebase_uid = $1 OR phone_number = $2 LIMIT 1`,
        [firebaseUid, phoneNumber],
      );

      if (existing.rows.length > 0) {
        const user = existing.rows[0];

        // Update last login, device info and sync firebase_uid if phone was previously registered
        const updated = await this.db.query<UserEntity>(
          `UPDATE users
           SET firebase_uid = $1,
               last_login_at = NOW(),
               device_info = COALESCE($2, device_info),
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [firebaseUid, deviceInfo || null, user.id],
        );

        return updated.rows[0];
      }

      // 2. Insert new user into PostgreSQL
      const defaultName = fullName || (role === UserRole.WORKER ? 'Karigar Partner' : 'Customer');
      const newUserRes = await this.db.query<UserEntity>(
        `INSERT INTO users (firebase_uid, phone_number, role, full_name, device_info, is_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
         RETURNING *`,
        [firebaseUid, phoneNumber, role, defaultName, deviceInfo || null],
      );

      const newUser = newUserRes.rows[0];

      // 3. Initialize role-specific profile
      if (role === UserRole.WORKER) {
        await this.db.query(
          `INSERT INTO worker_profiles (user_id, profession, experience_years, hourly_rate)
           VALUES ($1, 'General Technician', 2, 400.00)
           ON CONFLICT (user_id) DO NOTHING`,
          [newUser.id],
        );
      } else if (role === UserRole.EMPLOYER) {
        await this.db.query(
          `INSERT INTO employer_profiles (user_id, city, state)
           VALUES ($1, 'Rudrapur', 'Uttarakhand')
           ON CONFLICT (user_id) DO NOTHING`,
          [newUser.id],
        );
      }

      this.logger.log(`Created new PostgreSQL user ${newUser.id} with role ${role} for phone ${phoneNumber}`);
      return newUser;
    } catch (e) {
      this.logger.error(`Error in findOrCreateFromFirebase: ${e.message}`);
      // Fallback in-memory object if PostgreSQL connection is absent
      return {
        id: 'user_' + firebaseUid.substring(0, 12),
        firebase_uid: firebaseUid,
        phone_number: phoneNumber,
        role: role,
        full_name: fullName || 'User',
        is_verified: true,
        is_active: true,
        device_info: deviceInfo,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
  }

  async findById(id: string): Promise<UserEntity | null> {
    try {
      const res = await this.db.query<UserEntity>(`SELECT * FROM users WHERE id = $1`, [id]);
      return res.rows[0] || null;
    } catch (e) {
      return null;
    }
  }
}
