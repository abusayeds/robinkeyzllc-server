import { createUserDto } from './dto/create-user.dto';
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { usersService } from './user.service';

@Controller('users')
export class usersController {
  constructor(private readonly usersService: usersService) {}
  //================= Registration ================= //
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() createUserDto: createUserDto) {
    return this.usersService.register(createUserDto);
  }
}
