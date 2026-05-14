import { Global, Module } from '@nestjs/common';
import { JerasoftService } from './jerasoft.service';

@Global()
@Module({
  providers: [JerasoftService],
  exports: [JerasoftService],
})
export class JerasoftModule {}
