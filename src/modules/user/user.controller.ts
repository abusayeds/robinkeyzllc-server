import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { BearerToken } from '../../common/decorators/bearer-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TAuthUser } from '../../interface/auth.interface';
import { role } from '../../utils/role';
import { createUserDto } from './dto/create-user.dto';
import { verifyEmailDto } from './dto/verify-email.dto';
import { usersService } from './user.service';

@Controller('users')
export class usersController {
  constructor(private readonly usersService: usersService) {}

  @Post('register')
  async register(@Res() res: Response, @Body() createUserDto: createUserDto) {
    const data = await this.usersService.register(createUserDto);
    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message:
        'An OTP has been sent to your email. Please verify it to complete registration.',
      data: data,
    });
  }

  @Post('verify-email-otp')
  async verifyEmailOtp(
    @Res() res: Response,
    @Body() payload: verifyEmailDto,
    @BearerToken() token: string,
  ) {
    const data = await this.usersService.verifyEmailOtpDB(payload, token);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Email verified successfully. You can log in now.',
      data: data,
    });
  }

  @Post('resend-email-otp')
  async resendEmailOtp(@Res() res: Response, @BearerToken() token: string) {
    const data = await this.usersService.resendEmailOtpDB(token);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'A new OTP has been sent to your email.',
      data: data,
    });
  }

  @Get('me')
  @Auth()
  async myProfile(@Res() res: Response, @CurrentUser() user: TAuthUser) {
    const data = await this.usersService.myProfileDB(user.id);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'profile information retrieved successfully',
      data: data,
    });
  }

  @Get('all-user')
  @Auth(role.admin)
  async getAllUsers(
    @Res() res: Response,
    @Query() query: Record<string, unknown>,
  ) {
    const result = await this.usersService.getAllUsersDB(query);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User list retrieved successfully',
      pagination: result.pagination,
      data: result.data,
    });
  }

  @Get(':id')
  @Auth(role.admin, role.user)
  async getSingleUser(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.usersService.getSingleUserDB(id);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User retrieved successfully',
      data: data,
    });
  }

  @Delete(':id')
  @Auth(role.admin)
  async deleteUser(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.usersService.deleteUserDB(id);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'user deleted successfully',
      data: data,
    });
  }
}
