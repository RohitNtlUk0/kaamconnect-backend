import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Param, 
  Body, 
  Query, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { NotificationsService, SendNotificationDto } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * 1. Register User Device FCM Token for Push Notifications
   */
  @Post('register-token')
  @HttpCode(HttpStatus.OK)
  async registerToken(@Body() body: { phone: string; fcmToken: string }) {
    const result = await this.notificationsService.registerDeviceToken(body.phone, body.fcmToken);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 2. Send Push Notification (Event Trigger)
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async send(@Body() dto: SendNotificationDto) {
    const result = await this.notificationsService.sendNotification(dto);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 3. Fetch User Notification Inbox
   */
  @Get(':phone')
  async getUserNotifications(
    @Param('phone') phone: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const notifications = await this.notificationsService.getUserNotifications(phone, limitNum);
    return {
      success: true,
      count: notifications.length,
      data: notifications,
    };
  }

  /**
   * 4. Mark Notification as Read
   */
  @Patch(':id/read')
  async markRead(@Param('id') id: string) {
    const result = await this.notificationsService.markAsRead(id);
    return {
      success: true,
      data: result,
    };
  }
}
