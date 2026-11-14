import { IsString, IsNotEmpty, Matches, IsEnum, IsOptional, Length } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class VerifyTelegramOtpDto {
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: 'Mobile number must be a valid 10-digit Indian number prefixed with +91',
  })
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole = UserRole.CUSTOMER;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  deviceInfo?: string;
}
