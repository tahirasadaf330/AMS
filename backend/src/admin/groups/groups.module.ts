import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGroupsController } from './groups.controller';
import { AdminGroupsService } from './groups.service';
import { UserGroup } from '../../common/entities/user-group.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserGroup])],
  controllers: [AdminGroupsController],
  providers: [AdminGroupsService],
  exports: [AdminGroupsService],
})
export class AdminGroupsModule {}
