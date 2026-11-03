import { Controller, Post, Get, Patch, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBookingDto) {
    const booking = await this.bookingsService.createBooking(dto);
    return {
      success: true,
      message: 'Booking created successfully in database',
      data: booking,
    };
  }

  @Get('leads/nearby')
  async getNearbyLeads(
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
    @Query('radiusKm') radiusKm?: number,
    @Query('category') category?: string,
  ) {
    const effectiveLat = Number(lat || latitude || 28.9834);
    const effectiveLng = Number(lng || longitude || 79.4082);
    const radius = Number(radiusKm || 20);

    const leads = await this.bookingsService.getNearbyJobLeads(
      effectiveLat,
      effectiveLng,
      radius,
      category,
    );

    return {
      success: true,
      count: leads.length,
      center: { latitude: effectiveLat, longitude: effectiveLng },
      radiusKm: radius,
      data: leads,
    };
  }

  @Get(':id')
  async getBookingById(@Param('id') id: string) {
    const booking = await this.bookingsService.getBookingById(id);
    return {
      success: true,
      data: booking,
    };
  }

  @Get('customer/:phone')
  async getCustomerBookings(@Param('phone') phone: string) {
    const data = await this.bookingsService.getBookingsByCustomer(phone);
    return {
      success: true,
      data,
    };
  }

  @Get('worker/:phone')
  async getWorkerBookings(@Param('phone') phone: string) {
    const data = await this.bookingsService.getBookingsByWorker(phone);
    return {
      success: true,
      data,
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; workerPhone?: string; workerName?: string; notes?: string },
  ) {
    const updated = await this.bookingsService.updateStatus(id, body.status, body.workerPhone, body.workerName, body.notes);
    return {
      success: true,
      message: 'Booking status updated successfully',
      data: updated,
    };
  }

  @Post(':id/verify-otp')
  async verifyOtp(
    @Param('id') id: string,
    @Body() body: { type: 'START' | 'COMPLETION'; otp: string },
  ) {
    const result = await this.bookingsService.verifyOtp(id, body.type, body.otp);
    return {
      ...result,
    };
  }

  @Post(':id/cancel')
  async cancelBooking(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    const result = await this.bookingsService.cancelBooking(id, dto);
    return {
      success: true,
      message: 'Booking cancelled successfully.',
      data: result,
    };
  }
}
