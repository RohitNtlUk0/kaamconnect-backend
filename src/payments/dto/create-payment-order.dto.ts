import { IsNotEmpty, IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreatePaymentOrderDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsOptional()
  gatewayPreference?: 'RAZORPAY' | 'CASHFREE';
}
