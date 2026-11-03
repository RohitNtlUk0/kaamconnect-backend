import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  Param, 
  Headers, 
  Req, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { VerifyGatewayPaymentDto } from './dto/verify-gateway-payment.dto';
import { ProcessRefundDto } from './dto/process-refund.dto';
import { WorkerPayoutDto } from './dto/worker-payout.dto';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * 1. Create Gateway Order (Razorpay / Cashfree)
   */
  @Post('create-order')
  @HttpCode(HttpStatus.OK)
  async createOrder(@Body() dto: CreatePaymentOrderDto) {
    const order = await this.paymentsService.createOrder(dto);
    return {
      success: true,
      message: 'Payment order generated successfully',
      data: order,
    };
  }

  /**
   * 2. Server-side Cryptographic Signature Verification & Database Recording
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(@Body() dto: VerifyGatewayPaymentDto) {
    const result = await this.paymentsService.verifyPayment(dto);
    return {
      success: true,
      message: 'Payment cryptographically verified and recorded in PostgreSQL',
      data: result,
    };
  }

  /**
   * 3. Payment Gateway Webhook Listener
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any,
  ) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const result = await this.paymentsService.handleWebhook(rawBody, signature);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 4. Process Refund Back to Original Source
   */
  @Post('refund')
  @HttpCode(HttpStatus.OK)
  async processRefund(@Body() dto: ProcessRefundDto) {
    const result = await this.paymentsService.processRefund(dto);
    return {
      success: true,
      message: 'Refund successfully executed via gateway',
      data: result,
    };
  }

  /**
   * 5. Dispatch Payout to Karigar
   */
  @Post('payout')
  @HttpCode(HttpStatus.OK)
  async processPayout(@Body() dto: WorkerPayoutDto) {
    const result = await this.paymentsService.processWorkerPayout(dto);
    return {
      success: true,
      message: 'Worker payout dispatched successfully',
      data: result,
    };
  }

  /**
   * 6. Download / View Tax-Compliant GST Invoice
   */
  @Get('invoice/:bookingId')
  async getInvoice(@Param('bookingId') bookingId: string) {
    const invoice = await this.paymentsService.getInvoice(bookingId);
    return {
      success: true,
      data: invoice,
    };
  }

  /**
   * 7. Get Payment History for Booking
   */
  @Get('booking/:id')
  async getPayment(@Param('id') bookingId: string) {
    const data = await this.paymentsService.getPaymentByBooking(bookingId);
    return {
      success: true,
      data,
    };
  }
}
