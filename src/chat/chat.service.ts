import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface SendMessageDto {
  conversationId?: string;
  bookingId?: string;
  senderPhone: string;
  senderName?: string;
  recipientPhone: string;
  content: string;
  attachmentUrl?: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Helper to ensure user exists and get their UUID
   */
  private async getOrCreateUserId(phone: string, fullName: string = 'User'): Promise<string> {
    const cleanPhone = phone.trim();
    const formatted = cleanPhone.startsWith('+91') ? cleanPhone : `+91${cleanPhone}`;

    const res = await this.db.query(
      `SELECT id FROM users WHERE phone_number = $1 LIMIT 1;`,
      [formatted],
    );

    if (res.rows.length > 0) {
      return res.rows[0].id;
    }

    // Create user placeholder if not exists
    const insert = await this.db.query(
      `INSERT INTO users (phone_number, full_name, role)
       VALUES ($1, $2, 'CUSTOMER')
       RETURNING id;`,
      [formatted, fullName],
    );
    return insert.rows[0].id;
  }

  /**
   * 1. Get or Create One-to-One Conversation Thread
   */
  async getOrCreateConversation(customerPhone: string, workerPhone: string, bookingId?: string) {
    const customerId = await this.getOrCreateUserId(customerPhone, 'Customer');
    const workerId = await this.getOrCreateUserId(workerPhone, 'Worker');

    // 1. Look for existing conversation
    let query = `
      SELECT id, booking_id, customer_id, worker_id, last_message, last_message_at, created_at
      FROM conversations
      WHERE (customer_id = $1 AND worker_id = $2)
         OR (customer_id = $2 AND worker_id = $1)
    `;
    const params: any[] = [customerId, workerId];

    if (bookingId) {
      query += ` AND booking_id = $3`;
      params.push(bookingId);
    }

    query += ` ORDER BY last_message_at DESC LIMIT 1;`;

    const existing = await this.db.query(query, params);
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // 2. Create new conversation
    const newConv = await this.db.query(
      `INSERT INTO conversations (booking_id, customer_id, worker_id, last_message, last_message_at)
       VALUES ($1, $2, $3, 'Conversation started', NOW())
       RETURNING *;`,
      [bookingId || null, customerId, workerId],
    );

    return newConv.rows[0];
  }

  /**
   * 2. Send Message and Trigger Instant Push Notification
   */
  async sendMessage(dto: SendMessageDto) {
    let convId = dto.conversationId;

    if (!convId) {
      const conv = await this.getOrCreateConversation(
        dto.senderPhone,
        dto.recipientPhone,
        dto.bookingId,
      );
      convId = conv.id;
    }

    const senderId = await this.getOrCreateUserId(dto.senderPhone, dto.senderName || 'Sender');
    const recipientId = await this.getOrCreateUserId(dto.recipientPhone, 'Recipient');

    // 1. Insert message record
    const msgRes = await this.db.query(
      `INSERT INTO messages (conversation_id, sender_id, recipient_id, content, attachment_url, is_read)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *;`,
      [convId, senderId, recipientId, dto.content.trim(), dto.attachmentUrl || null],
    );

    const message = msgRes.rows[0];

    // 2. Update conversation last_message
    await this.db.query(
      `UPDATE conversations 
       SET last_message = $1, last_message_at = NOW() 
       WHERE id = $2;`,
      [dto.content.trim(), convId],
    );

    // 3. Dispatch FCM Push Notification to Recipient
    this.notifications.sendNotification({
      targetPhoneOrId: dto.recipientPhone,
      title: `Message from ${dto.senderName || 'KaamConnect User'} 💬`,
      body: dto.content.length > 60 ? `${dto.content.substring(0, 57)}...` : dto.content,
      type: 'CHAT_MESSAGE',
      payload: {
        conversationId: convId,
        senderPhone: dto.senderPhone,
        content: dto.content,
      },
    }).catch(() => {});

    return {
      success: true,
      data: {
        id: message.id,
        conversationId: convId,
        senderId,
        recipientId,
        content: message.content,
        timestamp: message.created_at,
        isRead: false,
      },
    };
  }

  /**
   * 3. Fetch Message History for a Conversation
   */
  async getMessages(conversationId: string, limit: number = 50) {
    const res = await this.db.query(
      `SELECT 
        m.id, 
        m.conversation_id, 
        m.sender_id, 
        m.recipient_id, 
        m.content, 
        m.attachment_url, 
        m.is_read, 
        m.created_at,
        u.phone_number as sender_phone,
        u.full_name as sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2;`,
      [conversationId, limit],
    );
    return res.rows;
  }

  /**
   * 4. Mark Messages as Read
   */
  async markRead(conversationId: string, readerPhone: string) {
    const readerId = await this.getOrCreateUserId(readerPhone);
    await this.db.query(
      `UPDATE messages 
       SET is_read = TRUE, read_at = NOW() 
       WHERE conversation_id = $1 AND recipient_id = $2 AND is_read = FALSE;`,
      [conversationId, readerId],
    );
    return { success: true, conversationId, readerPhone };
  }

  /**
   * 5. Get List of Conversation Threads for a User
   */
  async getUserConversations(phone: string) {
    const userId = await this.getOrCreateUserId(phone);
    const res = await this.db.query(
      `SELECT 
        c.id,
        c.booking_id,
        c.last_message,
        c.last_message_at,
        c.created_at,
        CASE WHEN c.customer_id = $1 THEN u_w.full_name ELSE u_c.full_name END as partner_name,
        CASE WHEN c.customer_id = $1 THEN u_w.phone_number ELSE u_c.phone_number END as partner_phone,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.recipient_id = $1 AND m.is_read = FALSE) as unread_count
       FROM conversations c
       JOIN users u_c ON c.customer_id = u_c.id
       JOIN users u_w ON c.worker_id = u_w.id
       WHERE c.customer_id = $1 OR c.worker_id = $1
       ORDER BY c.last_message_at DESC;`,
      [userId],
    );
    return res.rows;
  }
}
