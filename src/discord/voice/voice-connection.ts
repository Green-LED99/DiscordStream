import { BaseMediaConnection } from './base-media-connection.js';

export class VoiceConnection extends BaseMediaConnection {
  public override get serverId(): string | null {
    return this.guildId ?? this.channelId;
  }

  public override get daveChannelId(): string {
    return this.channelId;
  }
}
