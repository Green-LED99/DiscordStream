import type { DaveModule } from '../dave/types.js';
import { AppError, ExitCode, toAppError } from '../errors.js';
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
import type { BaseMediaConnection } from './voice/base-media-connection.js';
import type { ReconnectDiagnostics } from './voice/reconnect.js';
import { StreamConnection } from './voice/stream-connection.js';
import { VoiceConnection } from './voice/voice-connection.js';

const INITIAL_CONNECT_ATTEMPTS = 3;
const RUNTIME_RECOVERY_ATTEMPTS = 3;

type DesiredVoiceState = {
  guildId: string;
  channelId: string;
};

type FatalListener = (error: AppError) => void;

export class Streamer {
  private voiceConnection: VoiceConnection | undefined;
  private streamConnection: StreamConnection | undefined;
  private desiredVoice: DesiredVoiceState | undefined;
  private desiredStream: DesiredVoiceState | undefined;
  private readonly rawListener: (event: GatewayEvent) => void;
  private readonly fatalListeners = new Set<FatalListener>();
  private runtimeRecoveryCount = 0;
  private recoveryPromise: Promise<void> | null = null;

  public constructor(
    private readonly client: CompanionGatewayClient,
    private readonly dave: DaveModule,
    private readonly logger: Logger
  ) {
    this.rawListener = (event) => {
      this.handleRawEvent(event);
    };

    this.client.onRaw(this.rawListener);
  }

  public destroy(): void {
    this.client.offRaw(this.rawListener);
  }

  public onFatal(listener: FatalListener): void {
    this.fatalListeners.add(listener);
  }

  public offFatal(listener: FatalListener): void {
    this.fatalListeners.delete(listener);
  }

  public async joinVoice(guildId: string, channelId: string): Promise<WebRtcConnectionWrapper> {
    const currentUser = this.client.currentUser();
    if (!currentUser) {
      throw new Error('The companion client is not logged in.');
    }

    this.desiredVoice = { guildId, channelId };
    this.runtimeRecoveryCount = 0;

    const voiceConnection = new VoiceConnection(
      this,
      this.dave,
      this.logger.child('voice'),
      guildId,
      currentUser.id,
      channelId
    );
    this.voiceConnection = voiceConnection;

    return this.connectWithRetries(
      voiceConnection,
      INITIAL_CONNECT_ATTEMPTS,
      'voice join',
      async (attempt) => {
        voiceConnection.prepareForReconnect(attempt, {
          preserveSession: true,
          preserveTokens: true,
        });
        this.requestVoiceJoin();
      }
    );
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
    this.desiredStream = { guildId: guildId ?? channelId, channelId };

    const streamConnection = new StreamConnection(
      this,
      this.dave,
      this.logger.child('stream'),
      guildId,
      currentUser.id,
      channelId
    );
    this.streamConnection = streamConnection;

    return this.connectWithRetries(
      streamConnection,
      INITIAL_CONNECT_ATTEMPTS,
      'stream create',
      async (attempt) => {
        streamConnection.prepareForReconnect(attempt, {
          preserveSession: true,
          preserveTokens: true,
        });
        this.requestStreamCreate();
      }
    );
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
    this.signalVideo(false);
    this.streamConnection = undefined;
    this.desiredStream = undefined;
  }

  public leaveVoice(): void {
    this.stopStream();
    this.voiceConnection?.stop();
    this.voiceConnection = undefined;
    this.desiredVoice = undefined;
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

  public handleConnectionRecoveryRequested(
    connection: BaseMediaConnection,
    diagnostics: ReconnectDiagnostics
  ): void {
    if (this.recoveryPromise || !this.isActiveConnection(connection)) {
      return;
    }

    this.recoveryPromise = this.recoverConnection(connection, diagnostics)
      .catch((error) => {
        this.handleConnectionFatal(connection, toAppError(error));
      })
      .finally(() => {
        this.recoveryPromise = null;
      });
  }

  public handleConnectionFatal(connection: BaseMediaConnection, error: AppError): void {
    if (!this.isActiveConnection(connection)) {
      return;
    }

    this.logger.error('Connection failed permanently', {
      connectionKind: connection.connectionKind,
      guildId: connection.guildId,
      channelId: connection.channelId,
      message: error.message,
      exitCode: error.exitCode,
      details: error.details,
    });

    for (const listener of this.fatalListeners) {
      listener(error);
    }
  }

  private async connectWithRetries(
    connection: BaseMediaConnection,
    attempts: number,
    description: string,
    connect: (attempt: number) => Promise<void>
  ): Promise<WebRtcConnectionWrapper> {
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      connection.setReconnectAttempt(attempt, 'refreshing');

      try {
        await connect(attempt);
        const ready = await connection.waitUntilReady();
        this.logger.info('Connection became ready', {
          connectionKind: connection.connectionKind,
          guildId: connection.guildId,
          channelId: connection.channelId,
          description,
          attempt,
        });
        return ready;
      } catch (error) {
        lastError = toAppError(error);
        this.logger.warn('Connection attempt failed', {
          connectionKind: connection.connectionKind,
          guildId: connection.guildId,
          channelId: connection.channelId,
          description,
          attempt,
          message: lastError.message,
          details: lastError.details,
        });
      }
    }

    throw (
      lastError ??
      new AppError(`Unable to complete ${description}.`, ExitCode.Gateway, {
        connectionKind: connection.connectionKind,
        guildId: connection.guildId,
        channelId: connection.channelId,
      })
    );
  }

  private handleRawEvent(event: GatewayEvent): void {
    const currentUser = this.client.currentUser();
    if (!currentUser) {
      return;
    }

    switch (event.t) {
      case 'VOICE_STATE_UPDATE':
        this.handleVoiceStateUpdate(currentUser.id, event);
        break;
      case 'VOICE_SERVER_UPDATE':
        this.handleVoiceServerUpdate(event);
        break;
      case 'STREAM_CREATE':
        this.handleStreamCreate(currentUser.id, event);
        break;
      case 'STREAM_SERVER_UPDATE':
        this.handleStreamServerUpdate(currentUser.id, event);
        break;
      default:
        break;
    }
  }

  private handleVoiceStateUpdate(currentUserId: string, payload: GatewayVoiceStateUpdate): void {
    if (payload.d.user_id !== currentUserId || !this.voiceConnection || !this.desiredVoice) {
      return;
    }

    if (
      this.voiceConnection.guildId &&
      payload.d.guild_id &&
      payload.d.guild_id !== this.voiceConnection.guildId
    ) {
      return;
    }

    if (payload.d.channel_id === this.desiredVoice.channelId) {
      this.voiceConnection.setSession(payload.d.session_id);
      if (this.streamConnection && this.desiredStream) {
        this.streamConnection.setSession(payload.d.session_id);
      }
      return;
    }

    if (!this.voiceConnection.isReady) {
      return;
    }

    void this.handleConnectionRecoveryRequested(this.voiceConnection, {
      connectionKind: 'voice',
      attempt: this.runtimeRecoveryCount,
      trigger: 'voice_state_update',
      state: 'refreshing',
      closeReason: `voice_state:${payload.d.channel_id ?? 'null'}`,
    });
  }

  private handleVoiceServerUpdate(payload: GatewayVoiceServerUpdate): void {
    if (!this.voiceConnection || !this.desiredVoice) {
      return;
    }

    if (payload.d.guild_id !== this.desiredVoice.guildId || !payload.d.endpoint) {
      return;
    }

    if (payload.d.channel_id && payload.d.channel_id !== this.desiredVoice.channelId) {
      return;
    }

    this.voiceConnection.setTokens(payload.d.endpoint, payload.d.token);
  }

  private handleStreamCreate(currentUserId: string, payload: GatewayStreamCreate): void {
    if (!this.streamConnection || !this.desiredStream || !this.voiceConnection?.voiceSessionId) {
      return;
    }

    const parsed = parseStreamKey(payload.d.stream_key);
    if (
      parsed.type !== 'guild' ||
      parsed.userId !== currentUserId ||
      parsed.channelId !== this.desiredStream.channelId ||
      parsed.guildId !== this.desiredStream.guildId
    ) {
      return;
    }

    this.streamConnection.setStreamContext(payload.d.rtc_server_id, payload.d.stream_key);
    this.streamConnection.setSession(this.voiceConnection.voiceSessionId);
  }

  private handleStreamServerUpdate(
    currentUserId: string,
    payload: GatewayStreamServerUpdate
  ): void {
    if (!this.streamConnection || !this.desiredStream) {
      return;
    }

    const parsed = parseStreamKey(payload.d.stream_key);
    if (
      parsed.type !== 'guild' ||
      parsed.userId !== currentUserId ||
      parsed.channelId !== this.desiredStream.channelId ||
      parsed.guildId !== this.desiredStream.guildId
    ) {
      return;
    }

    this.streamConnection.setTokens(payload.d.endpoint, payload.d.token);
  }

  private async recoverConnection(
    connection: BaseMediaConnection,
    diagnostics: ReconnectDiagnostics
  ): Promise<void> {
    const nextAttempt = this.runtimeRecoveryCount + 1;
    if (nextAttempt > RUNTIME_RECOVERY_ATTEMPTS) {
      throw new AppError(
        'Exceeded the maximum number of runtime reconnect attempts.',
        ExitCode.Gateway,
        {
          ...diagnostics,
          maxAttempts: RUNTIME_RECOVERY_ATTEMPTS,
        }
      );
    }

    this.runtimeRecoveryCount = nextAttempt;
    this.logger.warn('Attempting connection recovery', {
      ...diagnostics,
      attempt: nextAttempt,
      guildId: connection.guildId,
      channelId: connection.channelId,
    });

    if (connection.connectionKind === 'voice') {
      await this.recoverVoice(nextAttempt);
    } else {
      await this.recoverStream(nextAttempt);
    }

    this.logger.info('Connection recovery succeeded', {
      connectionKind: connection.connectionKind,
      guildId: connection.guildId,
      channelId: connection.channelId,
      attempt: nextAttempt,
      trigger: diagnostics.trigger,
    });
  }

  private async recoverVoice(attempt: number): Promise<void> {
    if (!this.voiceConnection || !this.desiredVoice) {
      throw new AppError('No active voice connection is available for recovery.', ExitCode.Gateway);
    }

    this.voiceConnection.prepareForReconnect(attempt);
    if (this.streamConnection && this.desiredStream) {
      this.streamConnection.prepareForReconnect(attempt);
    }

    this.requestVoiceJoin();
    await this.voiceConnection.waitUntilReady();

    if (this.streamConnection && this.desiredStream) {
      this.requestStreamCreate();
      await this.streamConnection.waitUntilReady();
    }
  }

  private async recoverStream(attempt: number): Promise<void> {
    if (!this.streamConnection || !this.desiredStream) {
      throw new AppError(
        'No active stream connection is available for recovery.',
        ExitCode.Gateway
      );
    }

    this.streamConnection.prepareForReconnect(attempt);
    this.requestStreamCreate();
    await this.streamConnection.waitUntilReady();
  }

  private requestVoiceJoin(): void {
    if (!this.desiredVoice) {
      throw new AppError('The target voice session is not available.', ExitCode.Gateway);
    }

    this.client.sendGatewayOpcode(GatewayOpcode.VoiceStateUpdate, {
      guild_id: this.desiredVoice.guildId,
      channel_id: this.desiredVoice.channelId,
      self_mute: false,
      self_deaf: true,
      self_video: Boolean(this.desiredStream),
    });
  }

  private requestStreamCreate(): void {
    if (!this.voiceConnection || !this.desiredStream) {
      throw new AppError('The target stream session is not available.', ExitCode.Gateway);
    }

    const currentUser = this.client.currentUser();
    if (!currentUser) {
      throw new AppError('The companion client is not logged in.', ExitCode.Auth);
    }

    this.signalVideo(true);
    this.client.sendGatewayOpcode(GatewayOpcode.StreamCreate, {
      type: 'guild',
      guild_id: this.desiredStream.guildId,
      channel_id: this.desiredStream.channelId,
      preferred_region: null,
    });
    this.client.sendGatewayOpcode(GatewayOpcode.StreamSetPaused, {
      stream_key: generateStreamKey(
        'guild',
        this.desiredStream.guildId,
        this.desiredStream.channelId,
        currentUser.id
      ),
      paused: false,
    });
  }

  private isActiveConnection(connection: BaseMediaConnection): boolean {
    return connection === this.voiceConnection || connection === this.streamConnection;
  }
}
