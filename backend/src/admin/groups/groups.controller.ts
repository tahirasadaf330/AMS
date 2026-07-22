import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AdminGroupsService } from './groups.service';

@Controller('admin/groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminGroupsController {
  constructor(private readonly groupsService: AdminGroupsService) {}

  @Get()
  findAll() {
    return this.groupsService.findAll();
  }

  @Post()
  create(
    @Body() body: { name: string; description?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.groupsService.create(body.name, body.description, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string;
      // The frontend sends snake_case; the app's inbound camelCase middleware is a
      // no-op (it runs before the body is parsed), so read snake_case here with a
      // camelCase fallback to stay robust regardless of that middleware.
      dataset_access?: string[];
      report_access?: string[];
      datasetAccess?: string[];
      reportAccess?: string[];
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.groupsService.update(
      id,
      body.name,
      body.description,
      body.dataset_access ?? body.datasetAccess,
      body.report_access ?? body.reportAccess,
      user.sub,
    );
  }

  @Put(':id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  setMembers(
    @Param('id') id: string,
    @Body() body: { userIds?: string[] },
  ) {
    return this.groupsService.setMembers(id, body.userIds ?? []);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string) {
    return this.groupsService.delete(id);
  }
}
