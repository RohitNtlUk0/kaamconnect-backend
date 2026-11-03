import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class KycDocumentDto {
  @IsNotEmpty()
  @IsString()
  documentType: string; // 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'POLICE_VERIF'

  @IsNotEmpty()
  @IsString()
  storageUrl: string;

  @IsOptional()
  @IsString()
  documentHash?: string;
}

export class SubmitKycDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  bankUpiId?: string;

  @IsOptional()
  @IsArray()
  documents?: KycDocumentDto[];
}
