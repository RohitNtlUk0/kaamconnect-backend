import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

export interface SendNotificationDto {
  targetPhoneOrId: string;
  title: string;
  body: string;
  type?: string;
  payload?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  /**
   * 1. Dispatches Real Notification: Persists to PostgreSQL & Sends FCM Push
   */
  async sendNotification(dto: SendNotificationDto) {
    const cleanTarget = dto.targetPhoneOrId.trim();
    const formattedPhone = cleanTarget.startsWith('+91')
      ? cleanTarget
      : cleanTarget.length === 10
      ? `+91${cleanTarget}`
      : cleanTarget;

    // 1. Look up user
    let user: any = null;
    try {
      const userRes = await this.db.query(
        `SELECT id, phone_number, device_info FROM users WHERE phone_number = $1 OR id::text = $1 LIMIT 1;`,
        [formattedPhone],
      );
      user = userRes.rows[0];
    } catch (e) {
      this.logger.warn(`User lookup warning in notification: ${e.message}`);
    }

    // 2. Persist in `notifications` table if user exists
    let savedNotification = null;
    if (user) {
      try {
        const notifRes = await this.db.query(
          `INSERT INTO notifications (user_id, title, body, payload, notification_type, is_read)
           VALUES ($1, $2, $3, $4, $5, FALSE)
           RETURNING *;`,
          [
            user.id,
            dto.title,
            dto.body,
            JSON.stringify(dto.payload || {}),
            dto.type || 'BOOKING_UPDATE',
          ],
        );
        savedNotification = notifRes.rows[0];
      } catch (e) {
        this.logger.error(`Error saving notification to DB: ${e.message}`);
      }
    }

    // 3. Dispatch FCM Push Notification if device_info contains valid token
    let fcmResult = { success: false };
    if (user && user.device_info && user.device_info.startsWith('fcm:')) {
      const fcmToken = user.device_info.replace('fcm:', '');
      const stringData: Record<string, string> = {
        type: dto.type || 'GENERAL',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      };
      if (dto.payload) {
        for (const [k, v] of Object.entries(dto.payload)) {
          stringData[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      }

      fcmResult = await this.firebaseAdmin.sendPushNotification(
        fcmToken,
        dto.title,
        dto.body,
        stringData,
      );
    } else {
      this.logger.log(`Notification recorded: "${dto.title}" for ${formattedPhone}`);
    }

    return {
      success: true,
      notification: savedNotification,
      fcm: fcmResult,
    };
  }

  /**
   * 2. Registers or Updates FCM Device Registration Token for a User
   */
  async registerDeviceToken(phone: string, fcmToken: string) {
    const cleanPhone = phone.trim();
    const formattedPhone = cleanPhone.startsWith('+91') ? cleanPhone : `+91${cleanPhone}`;

    try {
      await this.db.query(
        `UPDATE users 
         SET device_info = $1, updated_at = NOW() 
         WHERE phone_number = $2;`,
        [`fcm:${fcmToken.trim()}`, formattedPhone],
      );
      this.logger.log(`Registered FCM token for user ${formattedPhone}`);
      return { success: true, phone: formattedPhone };
    } catch (e) {
      this.logger.error(`Failed to register FCM device token: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * 3. Retrieves User Notifications from Database
   */
  async getUserNotifications(phoneOrId: string, limit: number = 30) {
    const clean = phoneOrId.trim();
    const formatted = clean.startsWith('+91') ? clean : `+91${clean}`;

    try {
      const res = await this.db.query(
        `SELECT n.id, n.title, n.body, n.payload, n.notification_type, n.is_read, n.created_at
         FROM notifications n
         JOIN users u ON n.user_id = u.id
         WHERE u.phone_number = $1 OR u.id::text = $1
         ORDER BY n.created_at DESC
         LIMIT $2;`,
        [formatted, limit],
      );
      return res.rows;
    } catch (e) {
      this.logger.error(`Error retrieving user notifications: ${e.message}`);
      return [];
    }
  }

  /**
   * 4. Marks Notification as Read
   */
  async markAsRead(notificationId: string) {
    try {
      await this.db.query(
        `UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1;`,
        [notificationId],
      );
      return { success: true, notificationId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
