import { BaseMediaConnection } from './base-media-connection.js';

export class StreamConnection extends BaseMediaConnection {
  private rtcServerId: string | null = null;
  private currentStreamKey: string | null = null;

  public override get serverId(): string | null {
    return this.rtcServerId;
  }

  public override get daveChannelId(): string {
    if (!this.rtcServerId) {
      throw new Error('RTC server id has not been set yet.');
    }

    return (BigInt(this.rtcServerId) - 1n).toString();
  }

  public setStreamContext(rtcServerId: string, streamKey: string): void {
    this.rtcServerId = rtcServerId;
    this.currentStreamKey = streamKey;
  }

  public get streamKey(): string | null {
    return this.currentStreamKey;
  }
}
