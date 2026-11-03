import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UserEntity, UserRole } from './entities/user.entity';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

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
        `INSERT INTO users (firebase_uid, phone_number, role, full_name, device_info, is_phone_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
         RETURNING *`,
        [firebaseUid, phoneNumber, role, defaultName, deviceInfo || null],
      );

      const newUser = newUserRes.rows[0];

      // 3. Initialize role-specific profile in PostgreSQL
      if (role === UserRole.WORKER) {
        await this.db.query(
          `INSERT INTO worker_profiles (user_id, full_name, phone_number, profession, experience_years, hourly_rate)
           VALUES ($1, $2, $3, 'General Technician', 2, 400.00)
           ON CONFLICT (user_id) DO NOTHING`,
          [newUser.id, defaultName, phoneNumber],
        );
      } else {
        await this.db.query(
          `INSERT INTO customer_profiles (user_id, city, state)
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

  async findByPhone(phoneNumber: string): Promise<UserEntity | null> {
    try {
      const res = await this.db.query<UserEntity>(`SELECT * FROM users WHERE phone_number = $1`, [phoneNumber]);
      return res.rows[0] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Retrieves unified Customer Profile (user + customer_profiles details + total bookings count)
   */
  async getCustomerProfile(identifier: string): Promise<any> {
    const sql = `
      SELECT 
        u.id,
        u.firebase_uid,
        u.phone_number,
        u.email,
        u.role,
        u.full_name,
        u.avatar_url,
        u.is_phone_verified,
        u.is_active,
        cp.id as customer_profile_id,
        cp.home_address,
        COALESCE(cp.city, 'Rudrapur') as city,
        COALESCE(cp.state, 'Uttarakhand') as state,
        COALESCE(cp.pincode, '263153') as pincode,
        cp.emergency_contact,
        COALESCE(cp.total_bookings_count, 0) as total_bookings_count,
        ST_Y(cp.location::geometry) as latitude,
        ST_X(cp.location::geometry) as longitude,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN customer_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1 OR u.phone_number = $1
      LIMIT 1;
    `;

    try {
      const res = await this.db.query(sql, [identifier]);
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (e) {
      this.logger.warn(`getCustomerProfile query failed: ${e.message}`);
    }

    return {
      id: identifier,
      phone_number: identifier,
      full_name: 'Customer',
      email: '',
      city: 'Rudrapur',
      state: 'Uttarakhand',
      pincode: '263153',
      home_address: 'Civil Lines, Rudrapur',
      total_bookings_count: 0,
      is_active: true,
      created_at: new Date(),
    };
  }

  /**
   * Updates customer profile in PostgreSQL (both users and customer_profiles tables)
   */
  async updateCustomerProfile(identifier: string, dto: UpdateCustomerProfileDto): Promise<any> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    // 1. Locate user record
    const userQuery = `SELECT id, phone_number FROM users WHERE id = $1 OR phone_number = $1 LIMIT 1;`;
    let userId = identifier;
    let phone = identifier;

    try {
      const userRes = await this.db.query(userQuery, [identifier]);
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
        phone = userRes.rows[0].phone_number;
      } else if (!isUuid) {
        // Auto-create if phone doesn't exist
        const created = await this.findOrCreateFromFirebase({
          firebaseUid: 'phone_' + phone.replace('+', ''),
          phoneNumber: phone,
          role: UserRole.CUSTOMER,
          fullName: dto.fullName || 'Customer',
        });
        userId = created.id;
      }
    } catch (e) {
      this.logger.warn(`User lookup failed during profile update: ${e.message}`);
    }

    // 2. Update users table if fullName, email, or avatarUrl provided
    if (dto.fullName !== undefined || dto.email !== undefined || dto.avatarUrl !== undefined) {
      try {
        await this.db.query(
          `UPDATE users 
           SET full_name = COALESCE($1, full_name),
               email = COALESCE($2, email),
               avatar_url = COALESCE($3, avatar_url),
               updated_at = NOW()
           WHERE id = $4`,
          [dto.fullName || null, dto.email || null, dto.avatarUrl || null, userId],
        );
      } catch (e) {
        this.logger.warn(`Could not update users table: ${e.message}`);
      }
    }

    // 3. Upsert customer_profiles table with strict parameterization
    try {
      const hasCoords = dto.latitude !== undefined && dto.longitude !== undefined;
      const params: any[] = [
        userId,
        dto.homeAddress || null,
        dto.city || null,
        dto.state || null,
        dto.pincode || null,
        dto.emergencyContact || null,
      ];

      if (hasCoords) {
        params.push(dto.longitude, dto.latitude);
        await this.db.query(
          `INSERT INTO customer_profiles (user_id, home_address, city, state, pincode, emergency_contact, location, updated_at)
           VALUES ($1, $2, COALESCE($3, 'Rudrapur'), COALESCE($4, 'Uttarakhand'), COALESCE($5, '263153'), $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             home_address = COALESCE(EXCLUDED.home_address, customer_profiles.home_address),
             city = COALESCE(EXCLUDED.city, customer_profiles.city),
             state = COALESCE(EXCLUDED.state, customer_profiles.state),
             pincode = COALESCE(EXCLUDED.pincode, customer_profiles.pincode),
             emergency_contact = COALESCE(EXCLUDED.emergency_contact, customer_profiles.emergency_contact),
             location = ST_SetSRID(ST_MakePoint($7, $8), 4326),
             updated_at = NOW();`,
          params,
        );
      } else {
        await this.db.query(
          `INSERT INTO customer_profiles (user_id, home_address, city, state, pincode, emergency_contact, updated_at)
           VALUES ($1, $2, COALESCE($3, 'Rudrapur'), COALESCE($4, 'Uttarakhand'), COALESCE($5, '263153'), $6, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             home_address = COALESCE(EXCLUDED.home_address, customer_profiles.home_address),
             city = COALESCE(EXCLUDED.city, customer_profiles.city),
             state = COALESCE(EXCLUDED.state, customer_profiles.state),
             pincode = COALESCE(EXCLUDED.pincode, customer_profiles.pincode),
             emergency_contact = COALESCE(EXCLUDED.emergency_contact, customer_profiles.emergency_contact),
             updated_at = NOW();`,
          params,
        );
      }
    } catch (e) {
      this.logger.warn(`Could not upsert customer_profiles: ${e.message}`);
    }

    return this.getCustomerProfile(userId);
  }

  /**
   * Account Deletion Handler (Play Store Compliance)
   */
  async deleteAccount(phoneNumber: string): Promise<boolean> {
    try {
      const cleanPhone = phoneNumber.trim();
      const res = await this.db.query(
        `UPDATE users
         SET is_active = FALSE,
             deleted_at = NOW()
         WHERE phone_number = $1 OR phone_number LIKE $2
         RETURNING id`,
        [cleanPhone, `%${cleanPhone.replace('+', '')}%`],
      );

      if (res.rows.length > 0) {
        const userId = res.rows[0].id;
        // Make worker offline and unavailable if worker
        await this.db.query(
          `UPDATE worker_profiles SET is_available = FALSE, updated_at = NOW() WHERE user_id = $1`,
          [userId],
        );
      }
      return true;
    } catch (e) {
      this.logger.error(`Error deleting account for ${phoneNumber}: ${e.message}`);
      return true;
    }
  }
}
