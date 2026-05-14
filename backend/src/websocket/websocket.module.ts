import { Module, forwardRef } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { AuthModule } from '../auth/auth.module';
import { JerasoftModule } from '../datasources/jerasoft/jerasoft.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    JerasoftModule,
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketModule {}
