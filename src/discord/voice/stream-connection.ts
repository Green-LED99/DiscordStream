import { BaseMediaConnection } from './base-media-connection.js';
import type { ConnectionKind } from './reconnect.js';

export class StreamConnection extends BaseMediaConnection {
  public override get connectionKind(): ConnectionKind {
    return 'stream';
  }

  private rtcServerId: string | null = null;
  private rtcChannelId: string | null = null;
  private currentStreamKey: string | null = null;

  public override get serverId(): string | null {
    return this.rtcServerId;
  }

  public override get daveChannelId(): string {
    if (!this.rtcChannelId) {
      throw new Error('RTC channel id has not been set yet.');
    }

    return this.rtcChannelId;
  }

  protected override get voiceGatewayChannelId(): string {
    if (!this.rtcChannelId) {
      throw new Error('RTC channel id has not been set yet.');
    }

    return this.rtcChannelId;
  }

  public setStreamContext(rtcServerId: string, rtcChannelId: string, streamKey: string): void {
    this.rtcServerId = rtcServerId;
    this.rtcChannelId = rtcChannelId;
    this.currentStreamKey = streamKey;
  }

  public get streamKey(): string | null {
    return this.currentStreamKey;
  }
}
