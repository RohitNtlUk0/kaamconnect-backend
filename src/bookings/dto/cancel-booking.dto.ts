import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  cancelledBy?: string;
}
