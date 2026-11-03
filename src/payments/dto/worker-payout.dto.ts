import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class WorkerPayoutDto {
  @IsString()
  @IsNotEmpty()
  workerId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  destinationUpi: string;

  @IsString()
  @IsNotEmpty()
  bookingId: string;
}
