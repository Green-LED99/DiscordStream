import { BaseMediaConnection } from './base-media-connection.js';
import type { ConnectionKind } from './reconnect.js';

export class VoiceConnection extends BaseMediaConnection {
  public override get connectionKind(): ConnectionKind {
    return 'voice';
  }

  public override get serverId(): string | null {
    return this.guildId ?? this.channelId;
  }

  public override get daveChannelId(): string {
    return this.channelId;
  }
}
