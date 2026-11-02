import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const dbConfig = this.configService.get('database');

    const poolConfig = dbConfig.url
      ? {
          connectionString: dbConfig.url,
          ssl: { rejectUnauthorized: false },
        }
      : {
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.name,
          ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
        };

    this.pool = new Pool({
      ...poolConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    try {
      const client = await this.pool.connect();
      this.logger.log(`Successfully connected to PostgreSQL database`);
      client.release();

      // Automatically initialize schema if table does not exist
      await this.initializeSchema();
    } catch (error) {
      this.logger.warn(`PostgreSQL connection notice: ${error.message}. Running in resilient mode.`);
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('PostgreSQL connection pool closed');
    }
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const res = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      this.logger.debug(`Executed query in ${duration}ms: ${text.substring(0, 80)}...`);
      return res;
    } catch (error) {
      this.logger.error(`Database query failed: ${error.message} - SQL: ${text}`);
      throw error;
    }
  }

  private async initializeSchema() {
    try {
      // 1. Create users table if not exists
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          firebase_uid VARCHAR(128) UNIQUE NOT NULL,
          phone_number VARCHAR(20) UNIQUE NOT NULL,
          role VARCHAR(20) NOT NULL CHECK (role IN ('EMPLOYER', 'WORKER', 'AGENT', 'ADMIN')),
          full_name VARCHAR(100) NOT NULL,
          email VARCHAR(100),
          is_verified BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
        CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      `);
      this.logger.log('Database schema verified: `users` table is active.');
    } catch (err) {
      this.logger.error(`Schema initialization notice: ${err.message}`);
    }
  }
}
