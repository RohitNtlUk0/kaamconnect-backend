import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { RegisterWorkerDto } from './dto/register-worker.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Get()
  async getWorkers(@Query('category') category?: string, @Query('city') city?: string) {
    const data = await this.workersService.getWorkers(category, city);
    return {
      success: true,
      data,
    };
  }

  @Get('nearby')
  async getNearbyWorkers(
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
    @Query('radiusKm') radiusKm?: number,
    @Query('category') category?: string,
  ) {
    const effectiveLat = Number(lat || latitude || 28.9834);
    const effectiveLng = Number(lng || longitude || 79.4082);
    const radius = Number(radiusKm || 15);

    const data = await this.workersService.findNearbyWorkers(
      effectiveLat,
      effectiveLng,
      radius,
      category,
    );

    return {
      success: true,
      count: data.length,
      center: { latitude: effectiveLat, longitude: effectiveLng },
      radiusKm: radius,
      data,
    };
  }

  @Get('skills')
  async getSkills() {
    const skills = await this.workersService.getSkillsCatalog();
    return {
      success: true,
      data: skills,
    };
  }

  @Get('profile/me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@Req() req: any) {
    const userId = req.user.id;
    const worker = await this.workersService.getWorkerProfile(userId);
    return {
      success: true,
      data: worker,
    };
  }

  @Get('profile/:identifier')
  async getWorkerProfile(@Param('identifier') identifier: string) {
    const worker = await this.workersService.getWorkerProfile(identifier);
    return {
      success: true,
      data: worker,
    };
  }

  @Post('register')
  async registerWorker(@Body() dto: RegisterWorkerDto) {
    const worker = await this.workersService.registerOrUpdateWorkerProfile(dto);
    return {
      success: true,
      message: 'Worker profile successfully registered/updated in PostgreSQL.',
      data: worker,
    };
  }

  @Patch('profile')
  async updateWorkerProfile(@Body() dto: RegisterWorkerDto) {
    const worker = await this.workersService.registerOrUpdateWorkerProfile(dto);
    return {
      success: true,
      message: 'Worker profile updated successfully.',
      data: worker,
    };
  }

  @Post('kyc')
  async submitKyc(@Body() dto: SubmitKycDto) {
    const result = await this.workersService.submitWorkerKyc(dto);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Patch('availability')
  async updateAvailability(@Body() body: { phone?: string; workerId?: string; isAvailable: boolean }) {
    const targetPhone = body.phone || body.workerId || '';
    const status = await this.workersService.toggleOnlineStatus(targetPhone, body.isAvailable);
    return {
      success: true,
      data: status,
    };
  }

  @Post(':phone/location')
  async updateLocation(
    @Param('phone') phone: string,
    @Body() body: { latitude: number; longitude: number; heading?: number; speed?: number },
  ) {
    const location = await this.workersService.updateLocation(
      phone,
      body.latitude,
      body.longitude,
      body.heading,
      body.speed,
    );
    return {
      success: true,
      data: location,
    };
  }

  @Get(':phone/location')
  async getLocation(
    @Param('phone') phone: string,
    @Query('bookingId') bookingId?: string,
  ) {
    const location = await this.workersService.getWorkerLocation(phone, bookingId);
    return {
      success: true,
      data: location,
    };
  }

  @Patch(':phone/status')
  async toggleOnline(
    @Param('phone') phone: string,
    @Body() body: { isOnline: boolean },
  ) {
    const status = await this.workersService.toggleOnlineStatus(phone, body.isOnline);
    return {
      success: true,
      data: status,
    };
  }
}
