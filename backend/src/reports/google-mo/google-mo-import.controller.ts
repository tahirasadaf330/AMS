import {
  BadRequestException,
  Controller,
  InternalServerErrorException,
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
import { GoogleMoService } from "./google-mo.service";

@Controller("admin/google-mo")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class GoogleMoImportController {
  constructor(private readonly service: GoogleMoService) {}

  @Post("import/costs")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async importCosts(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    try {
      return await this.service.importCosts(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    } catch (err: any) {
      throw new InternalServerErrorException(
        err?.message ?? "Import failed",
      );
    }
  }

  @Post("import/estimates")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async importEstimates(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    try {
      return await this.service.importEstimates(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    } catch (err: any) {
      throw new InternalServerErrorException(
        err?.message ?? "Import failed",
      );
    }
  }
}
