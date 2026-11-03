import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class ProcessRefundDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
