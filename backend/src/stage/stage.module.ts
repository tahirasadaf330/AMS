import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StageService } from './stage.service';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DatasetRefreshLog]),
    WebsocketModule,
  ],
  providers: [StageService],
  exports: [StageService],
})
export class StageModule {}
