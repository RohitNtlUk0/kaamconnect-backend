-- =========================================================================
-- KAAMCONNECT ENTERPRISE POSTGRESQL PRODUCTION DATABASE SCHEMA
-- Version: 2.0.0 (PostGIS Enabled, 29 Production Tables)
-- =========================================================================

-- Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Global Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
        CREATE TYPE user_role_enum AS ENUM (
            'CUSTOMER', 'WORKER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'BUSINESS', 'ADMIN', 'SUPER_ADMIN'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status_enum') THEN
        CREATE TYPE booking_status_enum AS ENUM (
            'PENDING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
        CREATE TYPE payment_status_enum AS ENUM (
            'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CASH_COLLECTED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status_enum') THEN
        CREATE TYPE kyc_status_enum AS ENUM (
            'NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'
        );
    END IF;
END$$;

-- 1. USERS TABLE (Core Identity)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL, -- E.164 (+919876543210)
    email VARCHAR(255),
    role user_role_enum NOT NULL DEFAULT 'CUSTOMER',
    full_name VARCHAR(100) NOT NULL DEFAULT 'User',
    avatar_url TEXT,
    is_phone_verified BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    device_info TEXT,
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- 2. USER_ROLES (Multi-role support & RBAC)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by VARCHAR(100) DEFAULT 'SYSTEM',
    CONSTRAINT uq_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- 3. CUSTOMER_PROFILES
CREATE TABLE IF NOT EXISTS customer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    home_address TEXT,
    city VARCHAR(100) DEFAULT 'Rudrapur',
    state VARCHAR(100) DEFAULT 'Uttarakhand',
    pincode VARCHAR(10) DEFAULT '263153',
    location GEOMETRY(Point, 4326),
    emergency_contact VARCHAR(20),
    total_bookings_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_user ON customer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_loc_gist ON customer_profiles USING GIST(location);

-- 4. SERVICE_CATEGORIES
CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_hi VARCHAR(100) NOT NULL,
    description TEXT,
    icon_name VARCHAR(50) NOT NULL DEFAULT 'handyman',
    icon_color_hex VARCHAR(10) NOT NULL DEFAULT '#0066FF',
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON service_categories(slug);

-- 5. SERVICES (Sub-Services with Pricing)
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    slug VARCHAR(60) UNIQUE NOT NULL,
    title VARCHAR(150) NOT NULL,
    title_hi VARCHAR(150),
    description TEXT,
    base_price NUMERIC(10, 2) NOT NULL DEFAULT 299.00,
    estimated_duration_minutes INT NOT NULL DEFAULT 60,
    warranty_days INT NOT NULL DEFAULT 7,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);

-- 6. WORKER_PROFILES
CREATE TABLE IF NOT EXISTS worker_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    primary_category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    profession VARCHAR(100) NOT NULL DEFAULT 'Technician',
    experience_years INT NOT NULL DEFAULT 2,
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 350.00,
    daily_rate NUMERIC(10, 2) NOT NULL DEFAULT 1200.00,
    bio TEXT,
    aadhaar_hash VARCHAR(64),
    pan_number VARCHAR(20),
    bank_upi_id VARCHAR(100),
    kyc_status kyc_status_enum NOT NULL DEFAULT 'PENDING',
    police_verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    reviews_count INT NOT NULL DEFAULT 0,
    completed_jobs INT NOT NULL DEFAULT 0,
    wallet_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_b2b_ready BOOLEAN NOT NULL DEFAULT FALSE,
    city VARCHAR(100) DEFAULT 'Rudrapur',
    state VARCHAR(100) DEFAULT 'Uttarakhand',
    location GEOMETRY(Point, 4326),
    last_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_user ON worker_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_category ON worker_profiles(primary_category_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_kyc ON worker_profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_available ON worker_profiles(is_available);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_loc_gist ON worker_profiles USING GIST(location);

-- 7. SKILLS (Master trade skill catalog)
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES service_categories(id) ON DELETE CASCADE,
    name VARCHAR(100) UNIQUE NOT NULL,
    name_hi VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. WORKER_SKILLS (Worker-Skill mappings)
CREATE TABLE IF NOT EXISTS worker_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    proficiency_level VARCHAR(20) DEFAULT 'EXPERT',
    years_experience INT DEFAULT 2,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_worker_skill UNIQUE (worker_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_skills_worker ON worker_skills(worker_id);

-- 9. BUSINESS_PROFILES (B2B Enterprise Clients)
CREATE TABLE IF NOT EXISTS business_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(150) NOT NULL,
    gstin VARCHAR(20),
    pan_number VARCHAR(20),
    billing_address TEXT NOT NULL,
    city VARCHAR(100) DEFAULT 'Rudrapur',
    state VARCHAR(100) DEFAULT 'Uttarakhand',
    website VARCHAR(255),
    contact_person VARCHAR(100),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_user ON business_profiles(user_id);

-- 10. CONTRACTOR_PROFILES (Labor Contractors & Agency Squads)
CREATE TABLE IF NOT EXISTS contractor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agency_name VARCHAR(150) NOT NULL,
    license_number VARCHAR(50),
    squad_size INT NOT NULL DEFAULT 10,
    service_regions TEXT,
    city VARCHAR(100) DEFAULT 'Rudrapur',
    state VARCHAR(100) DEFAULT 'Uttarakhand',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_profiles_user ON contractor_profiles(user_id);

-- 11. JOBS (B2B Bulk Workforce & Direct Job Board)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    workers_needed INT NOT NULL DEFAULT 1,
    salary_per_day NUMERIC(10, 2) NOT NULL DEFAULT 600.00,
    location_address TEXT NOT NULL,
    location GEOMETRY(Point, 4326),
    city VARCHAR(100) DEFAULT 'Rudrapur',
    shift_details VARCHAR(50) DEFAULT '09:00 AM - 06:00 PM',
    duration_days INT NOT NULL DEFAULT 1,
    start_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, ASSIGNED, COMPLETED, CANCELLED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_loc_gist ON jobs USING GIST(location);

-- 12. JOB_APPLICATIONS
CREATE TABLE IF NOT EXISTS job_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expected_daily_wage NUMERIC(10, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'APPLIED', -- APPLIED, ACCEPTED, REJECTED
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_job_application UNIQUE (job_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_job_app_job ON job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_job_app_worker ON job_applications(worker_id);

-- 13. BOOKINGS (Customer Doorstep Services Lifecycle)
CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(64) PRIMARY KEY, -- BK-XXXX format
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_phone VARCHAR(20) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    worker_id UUID REFERENCES worker_profiles(id) ON DELETE SET NULL,
    worker_phone VARCHAR(20),
    worker_name VARCHAR(100),
    category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    category_name VARCHAR(100) NOT NULL,
    service_title VARCHAR(150) NOT NULL,
    booking_date VARCHAR(50) NOT NULL,
    booking_time VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) DEFAULT 'Rudrapur, Uttarakhand',
    location GEOMETRY(Point, 4326),
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    platform_commission NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    worker_payout NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status booking_status_enum NOT NULL DEFAULT 'PENDING',
    start_otp VARCHAR(10) NOT NULL,
    completion_otp VARCHAR(10) NOT NULL,
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    payment_method VARCHAR(30) DEFAULT 'UPI',
    transaction_id VARCHAR(100),
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_worker ON bookings(worker_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_loc_gist ON bookings USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);

-- 14. BOOKING_STATUS_HISTORY (Immutable state transition audit)
CREATE TABLE IF NOT EXISTS booking_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    changed_by_user_id VARCHAR(100) DEFAULT 'SYSTEM',
    notes TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_history_id ON booking_status_history(booking_id);

-- 15. WORKER_AVAILABILITY (Weekly Schedule Calendar)
CREATE TABLE IF NOT EXISTS worker_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
    start_time TIME NOT NULL DEFAULT '08:00:00',
    end_time TIME NOT NULL DEFAULT '20:00:00',
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_worker_day UNIQUE (worker_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_worker_avail_worker ON worker_availability(worker_id);

-- 16. WORKER_LOCATIONS (Real-Time PostGIS Stream Cache)
CREATE TABLE IF NOT EXISTS worker_locations (
    worker_phone VARCHAR(20) PRIMARY KEY,
    worker_id UUID REFERENCES worker_profiles(id) ON DELETE CASCADE,
    location GEOMETRY(Point, 4326) NOT NULL,
    latitude NUMERIC(10, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,
    heading NUMERIC(5, 2) DEFAULT 0.0,
    speed NUMERIC(5, 2) DEFAULT 0.0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_locations_gist ON worker_locations USING GIST(location);

-- 17. KYC_DOCUMENTS (Private document storage)
CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'POLICE_VERIF'
    document_hash VARCHAR(64) NOT NULL,
    storage_url TEXT NOT NULL,
    status kyc_status_enum NOT NULL DEFAULT 'PENDING',
    rejection_reason TEXT,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_docs_worker ON kyc_documents(worker_id);

-- 18. PAYMENTS (Gateway Orders & Transactions)
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY, -- PAY-XXXX
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    customer_phone VARCHAR(20) NOT NULL,
    worker_phone VARCHAR(20),
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    payment_method VARCHAR(50) NOT NULL DEFAULT 'UPI_INTENT',
    gateway_name VARCHAR(50) NOT NULL DEFAULT 'CASHFREE', -- CASHFREE, RAZORPAY
    gateway_order_id VARCHAR(100),
    gateway_payment_id VARCHAR(100),
    gateway_signature VARCHAR(255),
    bank_utr VARCHAR(100),
    status payment_status_enum NOT NULL DEFAULT 'SUCCESS',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 19. REFUNDS (Payment reversal ledger)
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id VARCHAR(64) NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    gateway_refund_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    reason TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);

-- 20. COMMISSIONS (Platform Revenue Ledger)
CREATE TABLE IF NOT EXISTS commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(64) UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    gross_amount NUMERIC(10, 2) NOT NULL,
    commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
    platform_fee NUMERIC(10, 2) NOT NULL,
    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
    gst_amount NUMERIC(10, 2) NOT NULL,
    net_worker_payout NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commissions_booking ON commissions(booking_id);

-- 21. PAYOUTS (Worker Bank & UPI Disbursements)
CREATE TABLE IF NOT EXISTS payouts (
    id VARCHAR(64) PRIMARY KEY, -- PO-XXXX
    worker_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    destination_upi VARCHAR(100) NOT NULL,
    gateway_payout_id VARCHAR(100),
    bank_utr VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_worker ON payouts(worker_id);

-- 22. CONVERSATIONS (One-on-One Chat Sessions)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(64) REFERENCES bookings(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_conversation_participants UNIQUE (customer_id, worker_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_worker ON conversations(worker_id);

-- 23. MESSAGES (Real-Time Chat Feed)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    attachment_url TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);

-- 24. NOTIFICATIONS (FCM & In-App Alert Queue)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    body TEXT NOT NULL,
    payload JSONB,
    notification_type VARCHAR(50) NOT NULL DEFAULT 'BOOKING_UPDATE',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- 25. REVIEWS (Verified Customer Feedback)
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(64) UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    rating NUMERIC(2, 1) NOT NULL CHECK (rating BETWEEN 1.0 AND 5.0),
    tags TEXT[],
    comment TEXT,
    photos TEXT[],
    worker_reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_worker ON reviews(worker_id);

-- 26. COMPLAINTS (Customer Grievance & Dispute Redressal)
CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(64) REFERENCES bookings(id) ON DELETE CASCADE,
    filed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    against_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, URGENT
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',     -- OPEN, UNDER_REVIEW, RESOLVED, CLOSED
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

-- 27. SUPPORT_TICKETS (Helpdesk Management)
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(30) UNIQUE NOT NULL, -- TKT-XXXX
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    subject VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    assigned_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- 28. AUDIT_LOGS (Immutable System Activity Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id VARCHAR(100) NOT NULL,
    actor_role VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
    action VARCHAR(100) NOT NULL,
    target_entity VARCHAR(100),
    target_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 29. ADMIN_USERS (Control Room Operators)
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'ADMIN', -- ADMIN, MASTER_ADMIN, SUPER_ADMIN
    permissions JSONB NOT NULL DEFAULT '["ALL"]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- =========================================================================
-- AUTOMATED TIMESTAMP TRIGGERS
-- =========================================================================

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_customer_profiles_updated ON customer_profiles;
CREATE TRIGGER trg_customer_profiles_updated BEFORE UPDATE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_worker_profiles_updated ON worker_profiles;
CREATE TRIGGER trg_worker_profiles_updated BEFORE UPDATE ON worker_profiles FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_business_profiles_updated ON business_profiles;
CREATE TRIGGER trg_business_profiles_updated BEFORE UPDATE ON business_profiles FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_contractor_profiles_updated ON contractor_profiles;
CREATE TRIGGER trg_contractor_profiles_updated BEFORE UPDATE ON contractor_profiles FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_jobs_updated ON jobs;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS trg_bookings_updated ON bookings;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =========================================================================
-- INITIAL SEED DATA (Service Categories & Master Skills)
-- =========================================================================

INSERT INTO service_categories (slug, name, name_hi, icon_name, icon_color_hex, sort_order)
VALUES
    ('electrician', 'Electrician', 'इलेक्ट्रीशियन', 'bolt', '#F59E0B', 1),
    ('plumber', 'Plumber', 'प्लंबर', 'water_drop', '#0284C7', 2),
    ('carpenter', 'Carpenter', 'कारपेंटर', 'construction', '#D97706', 3),
    ('painter', 'Painter', 'पेंटर', 'format_paint', '#8B5CF6', 4),
    ('ac_repair', 'AC Repair & Service', 'एसी रिपेयर', 'ac_unit', '#06B6D4', 5),
    ('appliance', 'Appliance Repair', 'होम अप्लायंसेज', 'kitchen', '#EC4899', 6),
    ('cleaning', 'Cleaning & Sanitation', 'सफाई कर्मचारी', 'cleaning_services', '#10B981', 7),
    ('mason', 'Mason Mistri', 'राजमिस्त्री', 'home_work', '#6B7280', 8),
    ('mechanic', 'Auto & Bike Mechanic', 'मैकेनिक', 'two_wheeler', '#EF4444', 9),
    ('welder', 'Welder & Fabricator', 'वेल्डर', 'hardware', '#F97316', 10),
    ('labor', 'Helper / Daily Wage Labor', 'हेल्पर मजदूर', 'groups', '#84CC16', 11),
    ('pest_control', 'Pest Control', 'कीटनाशक स्प्रे', 'bug_report', '#14B8A6', 12)
ON CONFLICT (slug) DO NOTHING;
