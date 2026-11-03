import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { B2BService, CreateB2BRequestDto } from './b2b.service';

@Controller('b2b')
export class B2BController {
  constructor(private readonly b2bService: B2BService) {}

  /**
   * 1. Create B2B Bulk Workforce Request
   */
  @Post('request')
  @HttpCode(HttpStatus.OK)
  async createRequest(@Body() dto: CreateB2BRequestDto) {
    const result = await this.b2bService.createWorkforceRequest(dto);
    return result;
  }

  /**
   * 2. List Open B2B Job Requests
   */
  @Get('requests')
  async getOpenRequests(@Query('city') city?: string) {
    const requests = await this.b2bService.getOpenRequests(city);
    return {
      success: true,
      count: requests.length,
      data: requests,
    };
  }

  /**
   * 3. Contractor Assigns Squad to Request
   */
  @Post('requests/:id/assign')
  @HttpCode(HttpStatus.OK)
  async assignContractor(
    @Param('id') id: string,
    @Body() body: { contractorPhone: string; squadCount: number },
  ) {
    const result = await this.b2bService.assignContractor(
      id,
      body.contractorPhone,
      body.squadCount,
    );
    return result;
  }

  /**
   * 4. List Registered Contractors / Agency Squads
   */
  @Get('contractors')
  async getContractors() {
    const squads = await this.b2bService.getContractorSquads();
    return {
      success: true,
      count: squads.length,
      data: squads,
    };
  }
}
