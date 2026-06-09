import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

export class SocketIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: false,
      },
      // Allow polling + websocket upgrade
      transports: ['polling', 'websocket'],
    });
  }
}
