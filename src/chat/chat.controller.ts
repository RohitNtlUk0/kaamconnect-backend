import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Body, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { ChatService, SendMessageDto } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 1. Get or Create Conversation Thread
   */
  @Post('conversation')
  @HttpCode(HttpStatus.OK)
  async getOrCreateConversation(
    @Body() body: { customerPhone: string; workerPhone: string; bookingId?: string },
  ) {
    const conv = await this.chatService.getOrCreateConversation(
      body.customerPhone,
      body.workerPhone,
      body.bookingId,
    );
    return {
      success: true,
      data: conv,
    };
  }

  /**
   * 2. Send Message
   */
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(@Body() dto: SendMessageDto) {
    const result = await this.chatService.sendMessage(dto);
    return result;
  }

  /**
   * 3. Fetch Message History for Conversation
   */
  @Get(':conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const messages = await this.chatService.getMessages(conversationId, limitNum);
    return {
      success: true,
      count: messages.length,
      data: messages,
    };
  }

  /**
   * 4. Mark Conversation as Read
   */
  @Patch(':conversationId/read')
  async markRead(
    @Param('conversationId') conversationId: string,
    @Body() body: { readerPhone: string },
  ) {
    const result = await this.chatService.markRead(conversationId, body.readerPhone);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 5. Get User Conversations
   */
  @Get('conversations/:phone')
  async getUserConversations(@Param('phone') phone: string) {
    const conversations = await this.chatService.getUserConversations(phone);
    return {
      success: true,
      count: conversations.length,
      data: conversations,
    };
  }
}
