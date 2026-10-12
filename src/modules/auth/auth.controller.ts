import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { BearerToken } from '../../common/decorators/bearer-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TAuthUser } from '../../interface/auth.interface';
import { authService } from './auth.service';
import {
  changePasswordDto,
  forgotPasswordDto,
  resetPasswordDto,
  verifyOtpDto,
} from './dto/auth.dto';
import { loginUserDto } from './dto/login-user.dto';

@Controller('auth')
export class authController {
  constructor(private readonly authService: authService) {}

  @Post('login')
  async login(@Res() res: Response, @Body() payload: loginUserDto) {
    const data = await this.authService.login(payload);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Login successful',
      data: data,
    });
  }

  @Get('me')
  @Auth()
  async myProfile(@Res() res: Response, @CurrentUser() user: TAuthUser) {
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
    });
  }

  @Post('forget-password')
  async forgetPassword(
    @Res() res: Response,
    @Body() payload: forgotPasswordDto,
  ) {
    const data = await this.authService.forgotPassword(payload);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'OTP sent to your email. Please check!',
      data: data,
    });
  }

  @Post('verify-forget-otp')
  async verifyForgetOtp(
    @Res() res: Response,
    @Body() payload: verifyOtpDto,
    @BearerToken() token: string,
  ) {
    const data = await this.authService.verifyForgotPasswordOtp(payload, token);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'OTP verified successfully.',
      data: data,
    });
  }

  @Post('resend-otp')
  async resendOtp(@Res() res: Response, @BearerToken() token: string) {
    const data = await this.authService.resendOtp(token);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'A new OTP has been sent to your email.',
      data: data,
    });
  }

  @Post('reset-password')
  async resetPassword(
    @Res() res: Response,
    @Body() payload: resetPasswordDto,
    @BearerToken() token: string,
  ) {
    const data = await this.authService.resetPassword(payload, token);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Password reset successfully.',
      data: data,
    });
  }

  @Post('change-password')
  @Auth()
  async changePassword(
    @Res() res: Response,
    @Body() payload: changePasswordDto,
    @CurrentUser() user: TAuthUser,
  ) {
    const data = await this.authService.changePassword(payload, user);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'You have successfully changed the password.',
      data: data,
    });
  }
}
