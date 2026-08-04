import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { AuditService } from "../../audit/audit.service";
import { GoogleMoService } from "./google-mo.service";
import {
  SharePointSyncService,
  SpTarget,
} from "./sharepoint-sync.service";

@Controller("admin/google-mo")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class GoogleMoImportController {
  constructor(
    private readonly service: GoogleMoService,
    private readonly sharePoint: SharePointSyncService,
    private readonly auditService: AuditService,
  ) {}

  @Post("import/costs")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async importCosts(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    try {
      const result = await this.service.importCosts(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
      this.auditService.log({
        userId: user.sub,
        action: "google_mo:import_costs",
        resource: file.originalname,
        detail: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err: any) {
      throw new InternalServerErrorException(
        err?.message ?? "Import failed",
      );
    }
  }

  @Post("import/estimates")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async importEstimates(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    try {
      const result = await this.service.importEstimates(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
      this.auditService.log({
        userId: user.sub,
        action: "google_mo:import_estimates",
        resource: file.originalname,
        detail: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err: any) {
      throw new InternalServerErrorException(
        err?.message ?? "Import failed",
      );
    }
  }

  /** Current status of each SharePoint-backed import source (last sync time/result). */
  @Get("import/sharepoint")
  sharePointStatus() {
    return this.sharePoint.getStatus();
  }

  /** On-demand pull of a single source ("costs" | "estimates") from SharePoint. */
  @Post("import/sharepoint/:target")
  async syncSharePoint(
    @Param("target") target: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (target !== "costs" && target !== "estimates") {
      throw new BadRequestException(
        'Invalid target — use "costs" or "estimates"',
      );
    }
    try {
      const result = await this.sharePoint.sync(target as SpTarget);
      this.auditService.log({
        userId: user.sub,
        action: "google_mo:sharepoint_sync",
        resource: target,
        detail: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err: any) {
      throw new InternalServerErrorException(
        err?.message ?? "SharePoint sync failed",
      );
    }
  }
}
