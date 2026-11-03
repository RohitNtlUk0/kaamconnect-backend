export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  WORKER = 'WORKER',
  EMPLOYER = 'EMPLOYER',
  SERVICE_PROVIDER = 'SERVICE_PROVIDER',
  CONTRACTOR = 'CONTRACTOR',
  BUSINESS = 'BUSINESS',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  AGENT = 'AGENT',
}

export interface UserEntity {
  id: string;
  firebase_uid: string;
  phone_number: string;
  role: UserRole;
  full_name: string;
  email?: string;
  avatar_url?: string;
  is_verified: boolean;
  is_active: boolean;
  device_info?: string;
  last_login_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerProfileEntity {
  id: string;
  user_id: string;
  home_address?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  emergency_contact?: string;
  total_bookings_count: number;
  created_at: Date;
  updated_at: Date;
}
