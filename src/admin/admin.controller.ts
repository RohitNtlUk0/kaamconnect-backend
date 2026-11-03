import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  UseGuards, 
  Req 
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * 1. Aggregated Platform Overview KPI Metrics
   */
  @Get('stats')
  async getStats() {
    const stats = await this.adminService.getDashboardStats();
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * 2. Worker Directory with filtering
   */
  @Get('workers')
  async getWorkers(@Query('status') status?: string, @Query('search') search?: string) {
    const workers = await this.adminService.getWorkers(status, search);
    return {
      success: true,
      count: workers.length,
      data: workers,
    };
  }

  /**
   * 3. Pending Worker KYC List with Documents
   */
  @Get('workers/pending-kyc')
  async getPendingKyc() {
    const workers = await this.adminService.getPendingKycWorkers();
    return {
      success: true,
      count: workers.length,
      data: workers,
    };
  }

  /**
   * 4. Approve or Reject Worker KYC
   */
  @Post('kyc/action')
  async updateKyc(
    @Body() body: { workerId: string; status: 'verified' | 'rejected'; reason?: string },
    @Req() req: any,
  ) {
    const actorId = req.user?.id || req.user?.sub || 'admin_root';
    const result = await this.adminService.updateKycStatus(
      body.workerId, 
      body.status, 
      body.reason,
      actorId,
    );
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 5. Platform Bookings Ledger
   */
  @Get('bookings')
  async getBookings(@Query('status') status?: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const bookings = await this.adminService.getBookings(status, limitNum);
    return {
      success: true,
      count: bookings.length,
      data: bookings,
    };
  }

  /**
   * 6. Disputed Bookings Desk
   */
  @Get('disputes')
  async getDisputes() {
    const disputes = await this.adminService.getDisputes();
    return {
      success: true,
      count: disputes.length,
      data: disputes,
    };
  }

  /**
   * 7. Resolve Customer/Worker Dispute
   */
  @Post('disputes/:id/resolve')
  async resolveDispute(
    @Param('id') id: string,
    @Body() body: { action: 'REFUND_CUSTOMER' | 'PAYOUT_WORKER' | 'DISMISS'; resolutionNotes: string },
    @Req() req: any,
  ) {
    const actorId = req.user?.id || req.user?.sub || 'admin_root';
    const result = await this.adminService.resolveDispute(
      id, 
      body.action, 
      body.resolutionNotes,
      actorId,
    );
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 8. Security & Activity Audit Trail
   */
  @Get('audit-logs')
  async getAuditLogs(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const logs = await this.adminService.getAuditLogs(limitNum);
    return {
      success: true,
      count: logs.length,
      data: logs,
    };
  }

  /**
   * 9. Platform Users Directory
   */
  @Get('users')
  async getUsers(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const users = await this.adminService.getUsers(limitNum);
    return {
      success: true,
      count: users.length,
      data: users,
    };
  }
}
