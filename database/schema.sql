-- =========================================================================
-- KAAMCONNECT PRODUCTION POSTGRESQL DATABASE SCHEMA
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Roles Enum (Worker vs Employer/Customer + Agent & Admin)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
        CREATE TYPE user_role_enum AS ENUM ('WORKER', 'EMPLOYER', 'AGENT', 'ADMIN');
    END IF;
END$$;

-- 2. Core Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    phone_number VARCHAR(16) UNIQUE NOT NULL, -- E.164 format (+919876543210)
    role user_role_enum NOT NULL DEFAULT 'EMPLOYER',
    full_name VARCHAR(100) NOT NULL DEFAULT 'User',
    email VARCHAR(255),
    avatar_url TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    device_info TEXT,
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for instantaneous lookups
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- 3. Worker Profiles Table (Extended details for service providers)
CREATE TABLE IF NOT EXISTS worker_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profession VARCHAR(100) NOT NULL DEFAULT 'Technician',
    experience_years INT NOT NULL DEFAULT 1,
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 350.00,
    aadhaar_hash VARCHAR(64),
    pan_number VARCHAR(20),
    bank_upi_id VARCHAR(50),
    kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, verified, rejected
    rejection_reason TEXT,
    rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    total_jobs_completed INT NOT NULL DEFAULT 0,
    is_online BOOLEAN NOT NULL DEFAULT TRUE,
    is_b2b_ready BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_profession ON worker_profiles(profession);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_kyc_status ON worker_profiles(kyc_status);

-- 4. Employer Profiles Table (Extended details for customers & corporate clients)
CREATE TABLE IF NOT EXISTS employer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(150),
    gstin VARCHAR(20),
    billing_address TEXT,
    city VARCHAR(100) DEFAULT 'Rudrapur',
    state VARCHAR(100) DEFAULT 'Uttarakhand',
    is_corporate BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Authentication Audit & Abuse Detection Logs
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    phone_number VARCHAR(16) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    auth_method VARCHAR(30) NOT NULL DEFAULT 'FIREBASE_PHONE_OTP',
    status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED', 'BLOCKED'
    error_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_phone_time ON auth_audit_logs(phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_ip_time ON auth_audit_logs(ip_address, created_at DESC);

-- 6. Automatic updated_at Trigger Function
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trigger_worker_profiles_updated_at ON worker_profiles;
CREATE TRIGGER trigger_worker_profiles_updated_at
BEFORE UPDATE ON worker_profiles
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trigger_employer_profiles_updated_at ON employer_profiles;
CREATE TRIGGER trigger_employer_profiles_updated_at
BEFORE UPDATE ON employer_profiles
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
