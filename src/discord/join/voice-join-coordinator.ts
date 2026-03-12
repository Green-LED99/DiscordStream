import { setTimeout as sleep } from 'node:timers/promises';
import { AppError, ExitCode } from '../../errors.js';
import type { Logger } from '../../logging.js';
import type { WebRtcConnectionWrapper } from '../../transport/webrtc-connection.js';
import type { GatewayVoiceServerUpdate, GatewayVoiceStateUpdate } from '../gateway-events.js';
import { GatewayOpcode } from '../gateway-opcodes.js';
import type { UserGatewaySession } from '../user-gateway-session.js';
import type { VoiceConnection } from '../voice/voice-connection.js';
import type { JoinAttemptDiagnostics, VoiceHandshakeState } from './types.js';

const INITIAL_JOIN_ATTEMPTS = 3;
const HANDSHAKE_TIMEOUT_MS = 8_000;

type VoiceJoinCoordinatorOptions = {
  initialAttempts?: number;
  handshakeTimeoutMs?: number;
};

export class VoiceJoinCoordinator {
  private handshake: VoiceHandshakeState = {
    state: 'idle',
    sessionId: null,
    endpoint: null,
    token: null,
    sawVoiceState: false,
    sawVoiceServer: false,
    sawNullEndpoint: false,
    lastChannelId: null,
  };
  private pendingAttempt:
    | {
        resolve: () => void;
        reject: (error: AppError) => void;
        timeout: NodeJS.Timeout;
      }
    | undefined;

  public constructor(
    private readonly session: UserGatewaySession,
    private readonly connection: VoiceConnection,
    private readonly logger: Logger,
    private readonly guildId: string,
    private readonly channelId: string,
    private readonly options: VoiceJoinCoordinatorOptions = {}
  ) {}

  public async connectInitial(): Promise<WebRtcConnectionWrapper> {
    let lastError: AppError | null = null;
    const initialAttempts = this.options.initialAttempts ?? INITIAL_JOIN_ATTEMPTS;

    for (let attempt = 1; attempt <= initialAttempts; attempt += 1) {
      try {
        return await this.runAttempt(attempt);
      } catch (error) {
        lastError =
          error instanceof AppError ? error : new AppError('Voice join failed.', ExitCode.Gateway);
        this.handshake.state = 'failed';
        this.logger.warn('Voice join attempt failed', {
          guildId: this.guildId,
          channelId: this.channelId,
          attempt,
          message: lastError.message,
          details: lastError.details,
        });
        if (attempt < initialAttempts) {
          await sleep(backoffDelay(attempt));
        }
      }
    }

    throw lastError ?? new AppError('Voice join failed.', ExitCode.Gateway);
  }

  public async refresh(attempt: number): Promise<void> {
    await this.runAttempt(attempt);
  }

  public handleVoiceStateUpdate(payload: GatewayVoiceStateUpdate): void {
    if (payload.d.channel_id !== this.channelId) {
      this.handshake.lastChannelId = payload.d.channel_id ?? null;
      return;
    }

    this.handshake.sawVoiceState = true;
    this.handshake.lastChannelId = payload.d.channel_id;
    this.handshake.sessionId = payload.d.session_id;
    this.handshake.state = this.handshake.endpoint
      ? 'connecting_voice_ws'
      : 'awaiting_voice_server';
    this.logger.info('Voice state received', {
      guildId: this.guildId,
      channelId: this.channelId,
      sessionId: payload.d.session_id,
    });
    this.maybeResolveAttempt();
  }

  public handleVoiceServerUpdate(payload: GatewayVoiceServerUpdate): void {
    if (!matchesGuild(payload.d.guild_id, this.guildId)) {
      return;
    }

    if (payload.d.channel_id && payload.d.channel_id !== this.channelId) {
      return;
    }

    this.handshake.sawVoiceServer = true;
    if (!payload.d.endpoint) {
      this.handshake.endpoint = null;
      this.handshake.token = null;
      this.handshake.sawNullEndpoint = true;
      this.logger.warn('Voice server reallocated, waiting for a replacement endpoint', {
        guildId: this.guildId,
        channelId: this.channelId,
      });
      return;
    }

    this.handshake.endpoint = payload.d.endpoint;
    this.handshake.token = payload.d.token;
    this.handshake.state = this.handshake.sessionId
      ? 'connecting_voice_ws'
      : 'awaiting_voice_state';
    this.logger.info('Voice server received', {
      guildId: this.guildId,
      channelId: this.channelId,
      endpoint: payload.d.endpoint,
    });
    this.maybeResolveAttempt();
  }

  private async runAttempt(attempt: number): Promise<WebRtcConnectionWrapper> {
    this.cancelPendingAttempt();
    this.handshake.state = 'requesting';
    this.connection.setReconnectAttempt(attempt, 'refreshing');

    this.logger.info('Voice join requested', {
      guildId: this.guildId,
      channelId: this.channelId,
      attempt,
      sessionKnown: Boolean(this.handshake.sessionId),
      serverKnown: Boolean(this.handshake.endpoint && this.handshake.token),
    });

    this.session.sendGatewayOpcode(GatewayOpcode.VoiceStateUpdate, {
      guild_id: this.guildId,
      channel_id: this.channelId,
      self_mute: false,
      self_deaf: true,
      self_video: false,
    });

    await this.waitForHandshake(attempt);

    this.handshake.state = 'connecting_voice_ws';
    this.connection.prepareForReconnect(attempt);
    this.connection.setSession(this.handshake.sessionId!);
    this.connection.setTokens(this.handshake.endpoint!, this.handshake.token!);
    return this.connection.waitUntilReady();
  }

  private waitForHandshake(attempt: number): Promise<void> {
    if (this.hasHandshake()) {
      return Promise.resolve();
    }

    this.handshake.state = this.handshake.sawVoiceState
      ? 'awaiting_voice_server'
      : this.handshake.sawVoiceServer
        ? 'awaiting_voice_state'
        : 'requesting';

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAttempt = undefined;
        reject(this.createTimeoutError(attempt));
      }, this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);

      this.pendingAttempt = { resolve, reject, timeout };
    });
  }

  private maybeResolveAttempt(): void {
    if (!this.hasHandshake() || !this.pendingAttempt) {
      return;
    }

    clearTimeout(this.pendingAttempt.timeout);
    const resolve = this.pendingAttempt.resolve;
    this.pendingAttempt = undefined;
    resolve();
  }

  private cancelPendingAttempt(): void {
    if (!this.pendingAttempt) {
      return;
    }

    clearTimeout(this.pendingAttempt.timeout);
    this.pendingAttempt = undefined;
  }

  private hasHandshake(): boolean {
    return Boolean(this.handshake.sessionId && this.handshake.endpoint && this.handshake.token);
  }

  private createTimeoutError(attempt: number): AppError {
    const diagnostics: JoinAttemptDiagnostics = {
      attempt,
      reason:
        !this.handshake.sawVoiceState && !this.handshake.sawVoiceServer
          ? 'join_timeout_no_gateway_response'
          : this.handshake.sawVoiceState
            ? 'join_timeout_missing_voice_server'
            : 'join_timeout_missing_voice_state',
      sawVoiceState: this.handshake.sawVoiceState,
      sawVoiceServer: this.handshake.sawVoiceServer,
      sawNullEndpoint: this.handshake.sawNullEndpoint,
      lastChannelId: this.handshake.lastChannelId,
    };

    return new AppError(
      'Timed out waiting for Discord to complete the voice join handshake.',
      ExitCode.Gateway,
      {
        guildId: this.guildId,
        channelId: this.channelId,
        ...diagnostics,
      }
    );
  }
}

function backoffDelay(attempt: number): number {
  return 250 * attempt + Math.floor(Math.random() * 150);
}

function matchesGuild(
  receivedGuildId: string | null | undefined,
  expectedGuildId: string
): boolean {
  return receivedGuildId === expectedGuildId;
}
