import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ConditionsService,
  CreateConditionDto,
  UpdateConditionDto,
} from './conditions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { SkipAudit } from '../audit/skip-audit.decorator';
import { UserRole } from '../common/entities/user.entity';

@Controller('conditions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConditionsController {
  // Per-condition cooldown for manual trigger-now, so a double-click / rapid re-trigger can't
  // blast the real recipient list repeatedly. In-memory (AMS runs single-instance).
  private readonly lastManualTrigger = new Map<string, number>();
  private static readonly MANUAL_TRIGGER_COOLDOWN_MS = 20_000;

  constructor(
    private conditionsService: ConditionsService,
    private auditService: AuditService,
  ) {}

  @Get()
  @Roles('editor')
  async findAll(@CurrentUser() user: JwtUser) {
    return this.conditionsService.findAll(user.sub, user.role as UserRole);
  }

  @Post()
  @Roles('editor')
  async create(
    @Body() dto: CreateConditionDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.conditionsService.create(dto, user.sub, user.role as UserRole);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'condition:create',
      resource: result.id,
      detail: { name: result.name, datasetId: result.datasetId },
      ipAddress,
    });
    return result;
  }

  @Put(':id')
  @Roles('editor')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConditionDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.conditionsService.update(id, dto, user.sub, user.role as UserRole);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'condition:update',
      resource: id,
      detail: { name: result.name },
      ipAddress,
    });
    return result;
  }

  @Delete(':id')
  @Roles('editor')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.conditionsService.remove(id, user.sub, user.role as UserRole);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'condition:delete',
      resource: id,
      detail: {},
      ipAddress,
    });
  }

  @Post('test-notify-preview')
  @Roles('editor')
  @HttpCode(HttpStatus.OK)
  async testNotifyPreview(
    @Body() dto: CreateConditionDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.conditionsService.testNotifyPreview(dto, user.sub);
    return { message: 'Test notification dispatched' };
  }

  @Post(':id/preview')
  @SkipAudit() // read-like: computes a preview, mutates nothing
  @Roles('editor')
  async preview(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.conditionsService.preview(id, user.sub);
  }

  @Post(':id/trigger-now')
  @Roles('editor')
  @HttpCode(HttpStatus.OK)
  async triggerNow(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    // Cooldown: reject a repeat manual trigger of the same condition within the window, so an
    // accidental double-click can't send the alert to its real recipients twice.
    const now = Date.now();
    const last = this.lastManualTrigger.get(id) ?? 0;
    if (now - last < ConditionsController.MANUAL_TRIGGER_COOLDOWN_MS) {
      const waitS = Math.ceil((ConditionsController.MANUAL_TRIGGER_COOLDOWN_MS - (now - last)) / 1000);
      throw new HttpException(
        `This alert was triggered moments ago — please wait ${waitS}s before triggering it again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.lastManualTrigger.set(id, now);

    // Fire-and-forget — long-running scripts (e.g. Python MTD loops) exceed
    // proxy timeouts if we await here. Return immediately; execution continues
    // in the background and emits a WebSocket event when done.
    this.conditionsService.triggerNow(id).catch(() => undefined);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'condition:trigger_now',
      resource: id,
      detail: {},
      ipAddress,
    });
    return { message: 'Condition triggered' };
  }

  @Post(':id/test-notify')
  @Roles('editor')
  @HttpCode(HttpStatus.OK)
  async testNotify(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.conditionsService.testNotify(id, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'condition:test_notify',
      resource: id,
      detail: {},
      ipAddress,
    });
    return { message: 'Test notification dispatched' };
  }
}
