import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class VerifyGatewayPaymentDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsString()
  @IsNotEmpty()
  gatewayOrderId: string;

  @IsString()
  @IsNotEmpty()
  gatewayPaymentId: string;

  @IsString()
  @IsNotEmpty()
  gatewaySignature: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  bankUtr?: string;
}
