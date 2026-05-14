import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../common/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../common/entities/user.entity';

@Controller('export')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportController {
  constructor(
    private exportService: ExportService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private auditService: AuditService,
  ) {}

  @Get(':datasetId/csv')
  async exportCsv(
    @Param('datasetId') datasetId: string,
    @Query() query: Record<string, string>,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userRecord = await this.userRepo.findOne({ where: { id: user.sub } });
    const userName = userRecord?.name || user.email;

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'export:csv',
      resource: datasetId,
      detail: {},
      ipAddress,
    });

    await this.exportService.exportCsv(datasetId, user.sub, user.role as UserRole, userName, res, query);
  }

  @Get(':datasetId/excel')
  async exportExcel(
    @Param('datasetId') datasetId: string,
    @Query() query: Record<string, string>,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userRecord = await this.userRepo.findOne({ where: { id: user.sub } });
    const userName = userRecord?.name || user.email;

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'export:excel',
      resource: datasetId,
      detail: {},
      ipAddress,
    });

    await this.exportService.exportExcel(datasetId, user.sub, user.role as UserRole, userName, res, query);
  }
}
