import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class PhoneLoginDto {
  @IsNotEmpty({ message: 'Firebase ID Token is required' })
  @IsString({ message: 'Firebase ID Token must be a valid JWT string' })
  idToken: string;

  @IsNotEmpty({ message: 'Role is required (WORKER or EMPLOYER)' })
  @IsEnum(UserRole, { message: 'Role must be WORKER, EMPLOYER, AGENT, or ADMIN' })
  role: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;
}
