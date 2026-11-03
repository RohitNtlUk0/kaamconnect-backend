import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Aggregated live metrics from PostgreSQL for the Admin Executive Dashboard
   */
  async getDashboardStats() {
    try {
      const usersRes = await this.db.query(`SELECT COUNT(*) as total_users FROM users;`);
      const workersRes = await this.db.query(`SELECT COUNT(*) as total_workers FROM worker_profiles;`);
      const activeWorkersRes = await this.db.query(`SELECT COUNT(*) as active_workers FROM worker_profiles WHERE is_available = TRUE;`);
      const pendingKycRes = await this.db.query(`SELECT COUNT(*) as pending_kyc FROM worker_profiles WHERE UPPER(kyc_status::text) = 'PENDING';`);
      
      const bookingsRes = await this.db.query(`
        SELECT 
          COUNT(*) as total_bookings,
          COALESCE(SUM(amount), 0) as gross_volume,
          COALESCE(SUM(platform_commission), 0) as total_commission,
          COALESCE(SUM(worker_payout), 0) as total_payouts
        FROM bookings;
      `);

      const activeJobsRes = await this.db.query(`
        SELECT COUNT(*) as active_jobs 
        FROM bookings 
        WHERE status IN ('PENDING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS');
      `);

      const completedJobsRes = await this.db.query(`
        SELECT COUNT(*) as completed_jobs 
        FROM bookings 
        WHERE status = 'COMPLETED';
      `);

      const cancelledJobsRes = await this.db.query(`
        SELECT COUNT(*) as cancelled_jobs 
        FROM bookings 
        WHERE status = 'CANCELLED';
      `);

      const disputesRes = await this.db.query(`
        SELECT COUNT(*) as total_disputes 
        FROM bookings 
        WHERE status = 'DISPUTED' OR cancellation_reason ILIKE '%dispute%';
      `);

      return {
        totalUsers: parseInt(usersRes.rows[0]?.total_users || '0', 10),
        totalWorkers: parseInt(workersRes.rows[0]?.total_workers || '0', 10),
        activeWorkers: parseInt(activeWorkersRes.rows[0]?.active_workers || '0', 10),
        pendingKyc: parseInt(pendingKycRes.rows[0]?.pending_kyc || '0', 10),
        totalBookings: parseInt(bookingsRes.rows[0]?.total_bookings || '0', 10),
        activeJobs: parseInt(activeJobsRes.rows[0]?.active_jobs || '0', 10),
        completedJobs: parseInt(completedJobsRes.rows[0]?.completed_jobs || '0', 10),
        cancelledJobs: parseInt(cancelledJobsRes.rows[0]?.cancelled_jobs || '0', 10),
        grossVolume: parseFloat(bookingsRes.rows[0]?.gross_volume || '0'),
        totalCommission: parseFloat(bookingsRes.rows[0]?.total_commission || '0'),
        totalPayouts: parseFloat(bookingsRes.rows[0]?.total_payouts || '0'),
        totalDisputes: parseInt(disputesRes.rows[0]?.total_disputes || '0', 10),
        platformCommissionRate: '10%',
      };
    } catch (e) {
      this.logger.error(`Error querying dashboard stats: ${e.message}`);
      return {
        totalUsers: 0,
        totalWorkers: 0,
        activeWorkers: 0,
        pendingKyc: 0,
        totalBookings: 0,
        activeJobs: 0,
        completedJobs: 0,
        cancelledJobs: 0,
        grossVolume: 0,
        totalCommission: 0,
        totalPayouts: 0,
        totalDisputes: 0,
        platformCommissionRate: '10%',
      };
    }
  }

  /**
   * Retrieves workers with optional status filter and search query
   */
  async getWorkers(status?: string, search?: string) {
    try {
      let query = `
        SELECT 
          wp.id,
          wp.user_id,
          wp.full_name,
          wp.phone_number,
          wp.profession,
          wp.experience_years,
          wp.hourly_rate,
          wp.daily_rate,
          wp.kyc_status,
          wp.police_verification_status,
          wp.rating,
          wp.reviews_count,
          wp.completed_jobs,
          wp.is_available,
          wp.city,
          wp.state,
          wp.created_at
        FROM worker_profiles wp
        WHERE 1=1
      `;
      const params: any[] = [];

      if (status && status !== 'all') {
        params.push(status.toUpperCase());
        query += ` AND UPPER(wp.kyc_status::text) = $${params.length}`;
      }

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (wp.full_name ILIKE $${params.length} OR wp.phone_number ILIKE $${params.length} OR wp.profession ILIKE $${params.length})`;
      }

      query += ` ORDER BY wp.created_at DESC LIMIT 100;`;
      const res = await this.db.query(query, params);
      return res.rows;
    } catch (e) {
      this.logger.error(`getWorkers error: ${e.message}`);
      return [];
    }
  }

  /**
   * Retrieves workers with pending KYC along with their uploaded KYC documents
   */
  async getPendingKycWorkers() {
    try {
      const query = `
        SELECT 
          wp.id,
          wp.user_id,
          wp.full_name,
          wp.phone_number,
          wp.profession,
          wp.experience_years,
          wp.daily_rate,
          wp.kyc_status,
          wp.city,
          wp.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', kd.id,
                'document_type', kd.document_type,
                'storage_url', kd.storage_url,
                'status', kd.status,
                'created_at', kd.created_at
              )
            ) FILTER (WHERE kd.id IS NOT NULL), '[]'
          ) as documents
        FROM worker_profiles wp
        LEFT JOIN kyc_documents kd ON kd.worker_id = wp.id
        WHERE UPPER(wp.kyc_status::text) = 'PENDING'
        GROUP BY wp.id
        ORDER BY wp.created_at ASC;
      `;
      const res = await this.db.query(query);
      return res.rows;
    } catch (e) {
      this.logger.error(`getPendingKycWorkers error: ${e.message}`);
      return [];
    }
  }

  /**
   * Approves or rejects worker KYC with audit trail logging
   */
  async updateKycStatus(
    workerId: string, 
    status: 'verified' | 'rejected', 
    reason?: string,
    actorId: string = 'admin_root',
  ) {
    try {
      const dbKycStatus = status === 'verified' ? 'VERIFIED' : 'REJECTED';

      // 1. Update worker profile
      const updateResult = await this.db.query(
        `UPDATE worker_profiles 
         SET kyc_status = $1::kyc_status_enum, updated_at = NOW() 
         WHERE id = $2 OR phone_number = $2
         RETURNING id, user_id, full_name, phone_number;`,
        [dbKycStatus, workerId],
      );

      const worker = updateResult.rows[0];

      // 2. If verified, update users table is_verified flag
      if (worker && status === 'verified') {
        await this.db.query(
          `UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1;`,
          [worker.user_id],
        );
      }

      // 3. Update status in kyc_documents table
      if (worker) {
        await this.db.query(
          `UPDATE kyc_documents 
           SET status = $1::kyc_status_enum, rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW()
           WHERE worker_id = $4;`,
          [dbKycStatus, reason || null, actorId, worker.id],
        );
      }

      // 4. Log in immutable audit_logs
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, actor_role, action, target_entity, target_id, details)
         VALUES ($1, 'ADMIN', $2, 'worker_profiles', $3, $4);`,
        [
          actorId,
          status === 'verified' ? 'KYC_APPROVED' : 'KYC_REJECTED',
          workerId,
          JSON.stringify({ reason: reason || null, workerName: worker?.full_name }),
        ],
      );

      return { 
        success: true, 
        workerId, 
        status: dbKycStatus, 
        workerName: worker?.full_name 
      };
    } catch (e) {
      this.logger.error(`updateKycStatus error: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * Retrieves bookings across the platform with optional status filter
   */
  async getBookings(status?: string, limit: number = 50) {
    try {
      let query = `
        SELECT 
          id,
          customer_phone,
          customer_name,
          worker_phone,
          worker_name,
          category_name,
          service_title,
          booking_date,
          booking_time,
          address,
          city,
          amount,
          platform_commission,
          worker_payout,
          status,
          payment_status,
          payment_method,
          transaction_id,
          cancellation_reason,
          created_at
        FROM bookings
        WHERE 1=1
      `;
      const params: any[] = [];

      if (status && status !== 'all') {
        params.push(status.toUpperCase());
        query += ` AND UPPER(status::text) = $${params.length}`;
      }

      params.push(limit);
      query += ` ORDER BY created_at DESC LIMIT $${params.length};`;

      const res = await this.db.query(query, params);
      return res.rows;
    } catch (e) {
      this.logger.error(`getBookings error: ${e.message}`);
      return [];
    }
  }

  /**
   * Retrieves disputed bookings or support complaints
   */
  async getDisputes() {
    try {
      const res = await this.db.query(`
        SELECT 
          id,
          customer_phone,
          customer_name,
          worker_phone,
          worker_name,
          service_title,
          amount,
          status,
          payment_status,
          cancellation_reason,
          created_at,
          updated_at
        FROM bookings
        WHERE status = 'DISPUTED' 
           OR (cancellation_reason IS NOT NULL AND cancellation_reason ILIKE '%dispute%')
        ORDER BY updated_at DESC;
      `);
      return res.rows;
    } catch (e) {
      this.logger.error(`getDisputes error: ${e.message}`);
      return [];
    }
  }

  /**
   * Resolves a dispute: issues refund to customer, pays worker, or dismisses
   */
  async resolveDispute(
    bookingId: string, 
    action: 'REFUND_CUSTOMER' | 'PAYOUT_WORKER' | 'DISMISS', 
    resolutionNotes: string,
    actorId: string = 'admin_root',
  ) {
    try {
      let newStatus = 'CANCELLED';
      if (action === 'PAYOUT_WORKER') newStatus = 'COMPLETED';
      if (action === 'DISMISS') newStatus = 'CANCELLED';

      await this.db.query(
        `UPDATE bookings 
         SET status = $1::booking_status_enum, cancellation_reason = $2, updated_at = NOW() 
         WHERE id = $3;`,
        [newStatus, `Admin Resolution (${action}): ${resolutionNotes}`, bookingId],
      );

      // Log in audit_logs
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, actor_role, action, target_entity, target_id, details)
         VALUES ($1, 'ADMIN', $2, 'bookings', $3, $4);`,
        [
          actorId,
          `DISPUTE_RESOLVED_${action}`,
          bookingId,
          JSON.stringify({ action, resolutionNotes }),
        ],
      );

      return { success: true, bookingId, action, resolutionNotes };
    } catch (e) {
      this.logger.error(`resolveDispute error: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * Retrieves recent audit logs
   */
  async getAuditLogs(limit: number = 50) {
    try {
      const res = await this.db.query(
        `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1;`,
        [limit],
      );
      return res.rows;
    } catch (e) {
      this.logger.error(`getAuditLogs error: ${e.message}`);
      return [];
    }
  }

  /**
   * Retrieves list of registered platform users
   */
  async getUsers(limit: number = 50) {
    try {
      const res = await this.db.query(
        `SELECT id, phone_number, role, full_name, is_verified, is_active, created_at, last_login_at 
         FROM users 
         ORDER BY created_at DESC LIMIT $1;`,
        [limit],
      );
      return res.rows;
    } catch (e) {
      this.logger.error(`getUsers error: ${e.message}`);
      return [];
    }
  }
}
