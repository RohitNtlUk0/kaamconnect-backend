import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface CreateB2BRequestDto {
  companyName: string;
  contactPerson: string;
  contactPhone: string;
  gstin?: string;
  workerCategory: string;
  workerCount: number;
  durationDays: number;
  dailyRatePerWorker: number;
  siteLocation: string;
  shift?: string;
}

@Injectable()
export class B2BService {
  private readonly logger = new Logger(B2BService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * 1. Create Bulk Manpower Requirement (B2B Request)
   */
  async createWorkforceRequest(dto: CreateB2BRequestDto) {
    const cleanPhone = dto.contactPhone.trim();
    const formattedPhone = cleanPhone.startsWith('+91') ? cleanPhone : `+91${cleanPhone}`;

    // 1. Ensure user exists with BUSINESS role
    let employerId: string;
    const userRes = await this.db.query(
      `SELECT id FROM users WHERE phone_number = $1 LIMIT 1;`,
      [formattedPhone],
    );

    if (userRes.rows.length > 0) {
      employerId = userRes.rows[0].id;
    } else {
      const newUser = await this.db.query(
        `INSERT INTO users (phone_number, full_name, role)
         VALUES ($1, $2, 'BUSINESS')
         RETURNING id;`,
        [formattedPhone, dto.contactPerson],
      );
      employerId = newUser.rows[0].id;
    }

    // 2. Ensure business_profiles record exists
    await this.db.query(
      `INSERT INTO business_profiles (user_id, company_name, gstin, billing_address, contact_person)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         gstin = EXCLUDED.gstin,
         billing_address = EXCLUDED.billing_address;`,
      [employerId, dto.companyName, dto.gstin || null, dto.siteLocation, dto.contactPerson],
    );

    // 3. Insert into `jobs` table
    const totalBudget = dto.workerCount * dto.dailyRatePerWorker * dto.durationDays;
    const title = `${dto.workerCategory} Squad Requirement (${dto.workerCount} Workers)`;
    const description = `Company: ${dto.companyName} requires ${dto.workerCount} ${dto.workerCategory} for ${dto.durationDays} days at ${dto.siteLocation}. Shift: ${dto.shift || 'Day Shift'}. Total Budget: ₹${totalBudget}.`;

    const jobRes = await this.db.query(
      `INSERT INTO jobs (
        employer_id, title, description, workers_needed, salary_per_day,
        location_address, shift_details, duration_days, start_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, 'OPEN')
      RETURNING *;`,
      [
        employerId,
        title,
        description,
        dto.workerCount,
        dto.dailyRatePerWorker,
        dto.siteLocation,
        dto.shift || 'Day Shift (8 AM - 5 PM)',
        dto.durationDays,
      ],
    );

    this.logger.log(`B2B Job Request Created: ${jobRes.rows[0].id} for ${dto.companyName} (Budget: ₹${totalBudget})`);

    return {
      success: true,
      job: jobRes.rows[0],
      totalBudget,
      summary: {
        workerCount: dto.workerCount,
        dailyRate: dto.dailyRatePerWorker,
        durationDays: dto.durationDays,
        companyName: dto.companyName,
      },
    };
  }

  /**
   * 2. List Open B2B Manpower Requirements for Thekedars/Contractors
   */
  async getOpenRequests(city?: string) {
    let query = `
      SELECT 
        j.id,
        j.title,
        j.description,
        j.workers_needed,
        j.salary_per_day,
        j.location_address,
        j.city,
        j.shift_details,
        j.duration_days,
        j.start_date,
        j.status,
        j.created_at,
        bp.company_name,
        bp.contact_person,
        u.phone_number as contact_phone
      FROM jobs j
      JOIN users u ON j.employer_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE j.status = 'OPEN'
    `;
    const params: any[] = [];

    if (city) {
      params.push(`%${city}%`);
      query += ` AND j.city ILIKE $1`;
    }

    query += ` ORDER BY j.created_at DESC LIMIT 50;`;

    const res = await this.db.query(query, params);
    return res.rows;
  }

  /**
   * 3. Contractor Squad Assignment to B2B Job
   */
  async assignContractor(jobId: string, contractorPhone: string, squadCount: number) {
    const cleanPhone = contractorPhone.trim();
    const formattedPhone = cleanPhone.startsWith('+91') ? cleanPhone : `+91${cleanPhone}`;

    // Verify job exists
    const jobRes = await this.db.query(`SELECT * FROM jobs WHERE id = $1;`, [jobId]);
    if (jobRes.rows.length === 0) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Update job to ASSIGNED
    await this.db.query(
      `UPDATE jobs SET status = 'ASSIGNED', updated_at = NOW() WHERE id = $1;`,
      [jobId],
    );

    // Audit log
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_entity, target_id, details)
       VALUES ($1, 'CONTRACTOR', 'B2B_SQUAD_ASSIGNED', 'jobs', $2, $3);`,
      [
        formattedPhone,
        jobId,
        JSON.stringify({ squadCount, contractorPhone: formattedPhone }),
      ],
    );

    this.logger.log(`B2B Job ${jobId} assigned to Contractor squad (${formattedPhone})`);

    return {
      success: true,
      jobId,
      contractorPhone: formattedPhone,
      assignedWorkers: squadCount,
      status: 'ASSIGNED',
    };
  }

  /**
   * 4. List Registered Contractors and Squad Capacities
   */
  async getContractorSquads() {
    const res = await this.db.query(`
      SELECT 
        cp.id,
        cp.agency_name,
        cp.squad_size,
        cp.service_regions,
        cp.city,
        cp.state,
        cp.is_verified,
        u.phone_number,
        u.full_name as agent_name
      FROM contractor_profiles cp
      JOIN users u ON cp.user_id = u.id
      ORDER BY cp.squad_size DESC;
    `);
    return res.rows;
  }
}
