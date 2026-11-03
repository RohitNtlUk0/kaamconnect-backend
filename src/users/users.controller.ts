import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('customer/profile')
  @UseGuards(JwtAuthGuard)
  async getMyCustomerProfile(@Req() req: any) {
    const userId = req.user.id;
    const profile = await this.usersService.getCustomerProfile(userId);
    return {
      success: true,
      data: profile,
    };
  }

  @Patch('customer/profile')
  @UseGuards(JwtAuthGuard)
  async updateMyCustomerProfile(@Req() req: any, @Body() dto: UpdateCustomerProfileDto) {
    const userId = req.user.id;
    const profile = await this.usersService.updateCustomerProfile(userId, dto);
    return {
      success: true,
      message: 'Customer profile updated successfully',
      data: profile,
    };
  }

  @Get('customer/:phone')
  async getCustomerByPhone(@Param('phone') phone: string) {
    const profile = await this.usersService.getCustomerProfile(phone);
    return {
      success: true,
      data: profile,
    };
  }

  @Patch('customer/:phone')
  async updateCustomerByPhone(
    @Param('phone') phone: string,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    const profile = await this.usersService.updateCustomerProfile(phone, dto);
    return {
      success: true,
      message: 'Customer profile updated successfully',
      data: profile,
    };
  }

  @Post('delete-account')
  async deleteAccount(@Body() body: { phoneNumber: string }) {
    const success = await this.usersService.deleteAccount(body.phoneNumber);
    return {
      success,
      message: 'Account successfully scheduled for permanent deletion.',
    };
  }
}
