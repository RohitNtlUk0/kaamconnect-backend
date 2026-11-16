import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class VerifyAppWhatsAppOtpDto {
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/)
  phoneNumber: string;

  @IsUUID()
  challengeId: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;
}
