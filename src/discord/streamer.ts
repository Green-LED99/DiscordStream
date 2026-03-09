import type { DaveModule } from '../dave/types.js';
import type { Logger } from '../logging.js';
import type { WebRtcConnectionWrapper } from '../transport/webrtc-connection.js';
import type { CompanionGatewayClient } from './gateway-client.js';
import type {
  GatewayEvent,
  GatewayStreamCreate,
  GatewayStreamServerUpdate,
  GatewayVoiceServerUpdate,
  GatewayVoiceStateUpdate,
} from './gateway-events.js';
import { GatewayOpcode } from './gateway-opcodes.js';
import { generateStreamKey, parseStreamKey } from './utils.js';
import { StreamConnection } from './voice/stream-connection.js';
import { VoiceConnection } from './voice/voice-connection.js';

export class Streamer {
  private voiceConnection: VoiceConnection | undefined;
  private streamConnection: StreamConnection | undefined;
  private readonly rawListener: (event: GatewayEvent) => void;
  private readonly waiters = new Set<(event: GatewayEvent) => void>();

  public constructor(
    private readonly client: CompanionGatewayClient,
    private readonly dave: DaveModule,
    private readonly logger: Logger
  ) {
    this.rawListener = (event) => {
      for (const waiter of this.waiters) {
        waiter(event);
      }
    };

    this.client.onRaw(this.rawListener);
  }

  public destroy(): void {
    this.client.offRaw(this.rawListener);
  }

  public async joinVoice(guildId: string, channelId: string): Promise<WebRtcConnectionWrapper> {
    const currentUser = this.client.currentUser();
    if (!currentUser) {
      throw new Error('The companion client is not logged in.');
    }

    const connection = await new Promise<WebRtcConnectionWrapper>((resolve, reject) => {
      const voiceConnection = new VoiceConnection(
        this,
        this.dave,
        this.logger.child('voice'),
        guildId,
        currentUser.id,
        channelId,
        resolve
      );

      const cleanup = () => {
        this.waiters.delete(waitForVoiceState);
        this.waiters.delete(waitForVoiceServer);
      };

      const waitForVoiceState = (event: GatewayEvent) => {
        if (event.t !== 'VOICE_STATE_UPDATE') {
          return;
        }

        const payload = event as GatewayVoiceStateUpdate;
        if (payload.d.user_id !== currentUser.id) {
          return;
        }

        voiceConnection.setSession(payload.d.session_id);
      };

      const waitForVoiceServer = (event: GatewayEvent) => {
        if (event.t !== 'VOICE_SERVER_UPDATE') {
          return;
        }

        const payload = event as GatewayVoiceServerUpdate;
        if (payload.d.guild_id !== guildId) {
          return;
        }

        if (payload.d.channel_id && payload.d.channel_id !== channelId) {
          return;
        }

        voiceConnection.setTokens(payload.d.endpoint, payload.d.token);
      };

      this.waiters.add(waitForVoiceState);
      this.waiters.add(waitForVoiceServer);
      this.voiceConnection = voiceConnection;
      this.signalVideo(false);

      this.client.sendGatewayOpcode(GatewayOpcode.VoiceStateUpdate, {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: true,
        self_video: false,
      });

      voiceConnection.once('error', (error) => {
        cleanup();
        reject(error);
      });
      voiceConnection.once('select_protocol_ack', cleanup);
    });

    return connection;
  }

  public async createStream(): Promise<WebRtcConnectionWrapper> {
    if (!this.voiceConnection) {
      throw new Error('A voice connection must exist before creating a stream.');
    }

    const currentUser = this.client.currentUser();
    if (!currentUser) {
      throw new Error('The companion client is not logged in.');
    }

    const { guildId, channelId } = this.voiceConnection;
    const sessionId = this.voiceConnection.voiceSessionId;
    if (!sessionId) {
      throw new Error('The voice session id is not available yet.');
    }

    const connection = await new Promise<WebRtcConnectionWrapper>((resolve, reject) => {
      const streamConnection = new StreamConnection(
        this,
        this.dave,
        this.logger.child('stream'),
        guildId,
        currentUser.id,
        channelId,
        resolve
      );

      const cleanup = () => {
        this.waiters.delete(waitForStreamCreate);
        this.waiters.delete(waitForStreamServerUpdate);
      };

      const waitForStreamCreate = (event: GatewayEvent) => {
        if (event.t !== 'STREAM_CREATE') {
          return;
        }

        const payload = event as GatewayStreamCreate;
        const parsed = parseStreamKey(payload.d.stream_key);
        if (
          parsed.type !== 'guild' ||
          parsed.guildId !== guildId ||
          parsed.channelId !== channelId ||
          parsed.userId !== currentUser.id
        ) {
          return;
        }

        streamConnection.setStreamContext(payload.d.rtc_server_id, payload.d.stream_key);
        streamConnection.setSession(sessionId);
      };

      const waitForStreamServerUpdate = (event: GatewayEvent) => {
        if (event.t !== 'STREAM_SERVER_UPDATE') {
          return;
        }

        const payload = event as GatewayStreamServerUpdate;
        const parsed = parseStreamKey(payload.d.stream_key);
        if (
          parsed.type !== 'guild' ||
          parsed.guildId !== guildId ||
          parsed.channelId !== channelId ||
          parsed.userId !== currentUser.id
        ) {
          return;
        }

        streamConnection.setTokens(payload.d.endpoint, payload.d.token);
      };

      this.waiters.add(waitForStreamCreate);
      this.waiters.add(waitForStreamServerUpdate);
      this.streamConnection = streamConnection;

      this.client.sendGatewayOpcode(GatewayOpcode.StreamCreate, {
        type: 'guild',
        guild_id: guildId,
        channel_id: channelId,
        preferred_region: null,
      });
      this.client.sendGatewayOpcode(GatewayOpcode.StreamSetPaused, {
        stream_key: generateStreamKey('guild', guildId, channelId, currentUser.id),
        paused: false,
      });

      streamConnection.once('error', (error) => {
        cleanup();
        reject(error);
      });
      streamConnection.once('select_protocol_ack', cleanup);
    });

    return connection;
  }

  public stopStream(): void {
    const currentUser = this.client.currentUser();
    if (!this.streamConnection || !this.voiceConnection || !currentUser) {
      return;
    }

    this.streamConnection.stop();
    this.client.sendGatewayOpcode(GatewayOpcode.StreamDelete, {
      stream_key: generateStreamKey(
        'guild',
        this.voiceConnection.guildId,
        this.voiceConnection.channelId,
        currentUser.id
      ),
    });
    this.streamConnection = undefined;
  }

  public leaveVoice(): void {
    this.stopStream();
    this.voiceConnection?.stop();
    this.voiceConnection = undefined;
    this.client.sendGatewayOpcode(GatewayOpcode.VoiceStateUpdate, {
      guild_id: null,
      channel_id: null,
      self_mute: true,
      self_deaf: false,
      self_video: false,
    });
  }

  public signalVideo(enabled: boolean): void {
    if (!this.voiceConnection) {
      return;
    }

    this.client.sendGatewayOpcode(GatewayOpcode.VoiceStateUpdate, {
      guild_id: this.voiceConnection.guildId,
      channel_id: this.voiceConnection.channelId,
      self_mute: false,
      self_deaf: true,
      self_video: enabled,
    });
  }
}
