export enum UserRole {
  WORKER = 'WORKER',
  EMPLOYER = 'EMPLOYER',
  AGENT = 'AGENT',
  ADMIN = 'ADMIN',
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
