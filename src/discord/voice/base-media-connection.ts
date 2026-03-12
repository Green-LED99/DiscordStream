import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DaveMediaEncryptor } from '../../dave/media-encryptor.js';
import { DaveSessionManager } from '../../dave/session-manager.js';
import type { DaveModule } from '../../dave/types.js';
import { AppError, ExitCode } from '../../errors.js';
import type { Logger } from '../../logging.js';
import { codecPayloadType } from '../../transport/codec-payload-type.js';
import { WebRtcConnectionWrapper } from '../../transport/webrtc-connection.js';
import type { Streamer } from '../streamer.js';
import { streamsSimulcast } from '../utils.js';
import { VoiceBinaryOpcode, VoiceOpcode } from '../voice-opcodes.js';
import type {
  VoiceGatewayResponse,
  VoiceReady,
  VoiceSelectProtocolAck,
  VoiceStreamDescriptor,
} from '../voice-types.js';
import {
  type ConnectionKind,
  type ReconnectDiagnostics,
  type ReconnectState,
  type RecoveryTrigger,
  classifyVoiceCloseCode,
} from './reconnect.js';

const READY_TIMEOUT_MS = 15_000;

export type WebRtcParameters = {
  address: string;
  port: number;
  audioSsrc: number;
  videoSsrc: number;
  rtxSsrc: number;
  streams: VoiceStreamDescriptor[];
};

export type VideoAttributes = {
  width: number;
  height: number;
  fps: number;
};

type ConnectionState = {
  hasSession: boolean;
  hasToken: boolean;
  started: boolean;
  resuming: boolean;
};

type ReconnectPreparationOptions = {
  preserveSession?: boolean;
  preserveTokens?: boolean;
};

export abstract class BaseMediaConnection extends EventEmitter {
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatIntervalMs: number | undefined;
  private lastHeartbeatSentAt: number | undefined;
  private lastHeartbeatAckAt: number | undefined;
  private missedHeartbeatAcks = 0;
  private lastCloseCode: number | undefined;
  private lastCloseReason: string | undefined;
  private webSocket: WebSocket | null = null;
  private connectionState: ConnectionState = {
    hasSession: false,
    hasToken: false,
    started: false,
    resuming: false,
  };
  private sequenceNumber = -1;
  private readonly webRtcWrapper: WebRtcConnectionWrapper;
  private currentWebRtcParameters: WebRtcParameters | null = null;
  private closed = false;
  private voiceServer: string | null = null;
  private voiceToken: string | null = null;
  private sessionId: string | null = null;
  private daveProtocolVersion = 0;
  private daveSessionManager: DaveSessionManager | undefined;
  private readonly connectedUsers = new Set<string>();
  private ready = false;
  private reconnectAttempt = 0;
  private reconnectState: ReconnectState = 'idle';
  private speakingEnabled = false;
  private videoEnabled = false;
  private videoAttributes: VideoAttributes | undefined;

  public readonly daveEncryptor: DaveMediaEncryptor;

  public constructor(
    protected readonly streamer: Streamer,
    protected readonly dave: DaveModule,
    protected readonly logger: Logger,
    public readonly guildId: string | null,
    public readonly userId: string,
    public readonly channelId: string
  ) {
    super();
    this.daveEncryptor = new DaveMediaEncryptor(dave);
    this.webRtcWrapper = new WebRtcConnectionWrapper(this, logger.child('webrtc'));
  }

  public abstract get serverId(): string | null;

  public abstract get daveChannelId(): string;

  public abstract get connectionKind(): ConnectionKind;

  public get type(): 'guild' | 'call' {
    return this.guildId ? 'guild' : 'call';
  }

  public get ws(): WebSocket | null {
    return this.webSocket;
  }

  public get voiceSessionId(): string | null {
    return this.sessionId;
  }

  public get webRtcConn(): WebRtcConnectionWrapper {
    return this.webRtcWrapper;
  }

  public get webRtcParams(): WebRtcParameters | null {
    return this.currentWebRtcParameters;
  }

  public get daveReady(): boolean {
    return this.daveProtocolVersion > 0;
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get audioSsrc(): number {
    if (!this.currentWebRtcParameters) {
      throw new AppError('Audio SSRC is not available yet.', ExitCode.Transport);
    }

    return this.currentWebRtcParameters.audioSsrc;
  }

  public get videoSsrc(): number {
    if (!this.currentWebRtcParameters) {
      throw new AppError('Video SSRC is not available yet.', ExitCode.Transport);
    }

    return this.currentWebRtcParameters.videoSsrc;
  }

  public stop(): void {
    this.closed = true;
    this.ready = false;
    this.clearHeartbeatTimer();
    this.webRtcWrapper.close();
    this.webSocket?.close();
    this.webSocket = null;
    this.daveEncryptor.destroy();
  }

  public waitUntilReady(timeoutMs = READY_TIMEOUT_MS): Promise<WebRtcConnectionWrapper> {
    if (this.ready) {
      return Promise.resolve(this.webRtcWrapper);
    }

    return new Promise<WebRtcConnectionWrapper>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new AppError(
            'Timed out waiting for the voice connection to become ready.',
            ExitCode.Gateway,
            {
              timeoutMs,
              ...this.logContext(),
            }
          )
        );
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve(this.webRtcWrapper);
      };
      const onFatal = (error: AppError) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.off('ready', onReady);
        this.off('fatal_disconnect', onFatal);
      };

      this.on('ready', onReady);
      this.on('fatal_disconnect', onFatal);
    });
  }

  public setSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.connectionState.hasSession = true;
    this.start();
  }

  public setTokens(server: string, token: string): void {
    this.voiceServer = server;
    this.voiceToken = token;
    this.connectionState.hasToken = true;
    this.start();
  }

  public setReconnectAttempt(attempt: number, state: ReconnectState): void {
    this.reconnectAttempt = attempt;
    this.reconnectState = state;
  }

  public prepareForReconnect(attempt: number, options?: ReconnectPreparationOptions): void {
    const preservedSessionId = options?.preserveSession ? this.sessionId : null;
    const preservedVoiceServer = options?.preserveTokens ? this.voiceServer : null;
    const preservedVoiceToken = options?.preserveTokens ? this.voiceToken : null;

    this.setReconnectAttempt(attempt, 'refreshing');
    this.ready = false;
    this.connectionState = {
      hasSession: preservedSessionId !== null,
      hasToken: preservedVoiceServer !== null && preservedVoiceToken !== null,
      started: false,
      resuming: false,
    };
    this.sequenceNumber = -1;
    this.currentWebRtcParameters = null;
    this.voiceServer = preservedVoiceServer;
    this.voiceToken = preservedVoiceToken;
    this.sessionId = preservedSessionId;
    this.lastCloseCode = undefined;
    this.lastCloseReason = undefined;
    this.heartbeatIntervalMs = undefined;
    this.lastHeartbeatSentAt = undefined;
    this.lastHeartbeatAckAt = undefined;
    this.missedHeartbeatAcks = 0;
    this.clearHeartbeatTimer();
    this.resetDaveSession();
    this.webRtcWrapper.close();

    const socket = this.webSocket;
    this.webSocket = null;
    socket?.close();

    if (this.connectionState.hasSession && this.connectionState.hasToken) {
      this.start();
    }
  }

  public setSpeaking(speaking: boolean): void {
    this.speakingEnabled = speaking;

    if (!this.currentWebRtcParameters) {
      return;
    }

    this.sendOpcode(VoiceOpcode.Speaking, {
      delay: 0,
      speaking: speaking ? 1 : 0,
      ssrc: this.audioSsrc,
    });
  }

  public setVideoAttributes(enabled: false): void;
  public setVideoAttributes(enabled: true, attributes: VideoAttributes): void;
  public setVideoAttributes(enabled: boolean, attributes?: VideoAttributes): void {
    if (!enabled) {
      this.videoEnabled = false;
      this.videoAttributes = undefined;

      if (!this.currentWebRtcParameters) {
        return;
      }

      const { audioSsrc } = this.currentWebRtcParameters;
      this.sendOpcode(VoiceOpcode.Video, {
        audio_ssrc: audioSsrc,
        video_ssrc: 0,
        rtx_ssrc: 0,
        streams: [],
      });
      return;
    }

    if (!attributes) {
      throw new AppError('Enabled video requires explicit video attributes.', ExitCode.Transport);
    }

    this.videoEnabled = true;
    this.videoAttributes = attributes;

    if (!this.currentWebRtcParameters) {
      return;
    }

    const { audioSsrc, videoSsrc, rtxSsrc } = this.currentWebRtcParameters;
    this.sendOpcode(VoiceOpcode.Video, {
      audio_ssrc: audioSsrc,
      video_ssrc: videoSsrc,
      rtx_ssrc: rtxSsrc,
      streams: [
        {
          type: 'video',
          rid: '100',
          ssrc: videoSsrc,
          active: true,
          quality: 100,
          rtx_ssrc: rtxSsrc,
          max_bitrate: 10_000 * 1_000,
          max_framerate: attributes.fps,
          max_resolution: {
            type: 'fixed',
            width: attributes.width,
            height: attributes.height,
          },
        },
      ],
    });
  }

  protected start(): void {
    if (!this.connectionState.hasSession || !this.connectionState.hasToken) {
      return;
    }

    if (this.connectionState.started) {
      return;
    }

    if (!this.voiceServer) {
      throw new AppError('Voice server endpoint is missing.', ExitCode.Gateway);
    }

    this.connectionState.started = true;
    this.webSocket = new WebSocket(`wss://${this.voiceServer}/?v=9`);
    this.webSocket.binaryType = 'arraybuffer';

    this.webSocket.addEventListener('open', () => {
      this.logger.info('Voice websocket opened', this.logContext());

      try {
        if (this.connectionState.resuming) {
          this.resume();
          return;
        }

        this.identify();
      } catch (error) {
        this.emitFatalDisconnect(
          error instanceof AppError
            ? error
            : new AppError(
                error instanceof Error ? error.message : 'Voice socket failed during open.',
                ExitCode.Gateway,
                this.logContext()
              )
        );
      }
    });

    this.webSocket.addEventListener('message', (event) => {
      void this.handleMessage(event.data).catch((error) => {
        this.emitFatalDisconnect(
          error instanceof AppError
            ? error
            : new AppError(
                error instanceof Error ? error.message : 'Voice socket message handling failed.',
                ExitCode.Gateway,
                this.logContext()
              )
        );
      });
    });

    this.webSocket.addEventListener('close', (event) => {
      this.handleSocketClose(event.code, event.reason || undefined);
    });
  }

  protected async setProtocols(): Promise<void> {
    const peerConnection = await this.webRtcWrapper.initWebRtc();

    peerConnection.onStateChange((state: string) => {
      if (
        state === 'closed' &&
        !this.closed &&
        this.connectionState.started &&
        this.ws?.readyState === WebSocket.OPEN &&
        this.reconnectState === 'idle'
      ) {
        void this.setProtocols().catch((error) => {
          this.emitFatalDisconnect(
            error instanceof AppError
              ? error
              : new AppError(
                  error instanceof Error ? error.message : 'Failed to renegotiate WebRTC.',
                  ExitCode.Transport,
                  this.logContext()
                )
          );
        });
      }
    });

    peerConnection.onLocalDescription((sdp: string) => {
      this.sendOpcode(VoiceOpcode.SelectProtocol, {
        protocol: 'webrtc',
        codecs: Object.values(codecPayloadType),
        data: sdp,
        sdp,
        rtc_connection_id: randomUUID(),
      });
    });

    peerConnection.setLocalDescription();

    await new Promise<void>((resolve) => {
      this.once('select_protocol_ack', () => resolve());
    });
  }

  protected sendOpcode(opcode: number, payload: Record<string, unknown>): void {
    if (this.webSocket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.webSocket.send(
      JSON.stringify({
        op: opcode,
        d: payload,
      })
    );
  }

  protected sendBinaryOpcode(opcode: VoiceBinaryOpcode, payload: Uint8Array): void {
    if (this.webSocket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const frame = Buffer.allocUnsafe(payload.byteLength + 1);
    frame.writeUInt8(opcode, 0);
    Buffer.from(payload).copy(frame, 1);
    this.webSocket.send(frame);
  }

  private identify(): void {
    if (!this.serverId || !this.sessionId || !this.voiceToken) {
      throw new AppError('Voice identify is missing required connection state.', ExitCode.Gateway);
    }

    this.logger.info('Voice websocket identify sent', this.logContext());
    this.sendOpcode(VoiceOpcode.Identify, {
      server_id: this.serverId,
      user_id: this.userId,
      session_id: this.sessionId,
      token: this.voiceToken,
      channel_id: this.channelId,
      video: true,
      streams: streamsSimulcast,
      max_dave_protocol_version: this.dave.MaxSupportedProtocolVersion(),
    });
  }

  private resume(): void {
    if (!this.serverId || !this.sessionId || !this.voiceToken) {
      throw new AppError('Voice resume is missing required connection state.', ExitCode.Gateway);
    }

    this.logger.info('Voice websocket resume sent', this.logContext());
    this.sendOpcode(VoiceOpcode.Resume, {
      server_id: this.serverId,
      session_id: this.sessionId,
      token: this.voiceToken,
      channel_id: this.channelId,
      seq_ack: this.sequenceNumber,
    });
  }

  private async handleMessage(data: string | ArrayBuffer | Blob): Promise<void> {
    if (data instanceof ArrayBuffer) {
      this.handleBinaryMessage(Buffer.from(data));
      return;
    }

    if (data instanceof Blob) {
      this.handleBinaryMessage(Buffer.from(await data.arrayBuffer()));
      return;
    }

    const payload = JSON.parse(data) as VoiceGatewayResponse;
    if (typeof payload.seq === 'number') {
      this.sequenceNumber = payload.seq;
    }

    switch (payload.op) {
      case VoiceOpcode.Hello:
        this.setupHeartbeat(payload.d.heartbeat_interval);
        break;
      case VoiceOpcode.Ready:
        await this.handleReady(payload.d);
        break;
      case VoiceOpcode.SelectProtocolAck:
        await this.handleSelectProtocolAck(payload.d);
        break;
      case VoiceOpcode.HeartbeatAck:
        this.lastHeartbeatAckAt = performance.now();
        this.missedHeartbeatAcks = 0;
        break;
      case VoiceOpcode.Resumed:
        this.connectionState.resuming = false;
        this.reconnectState = 'idle';
        this.logger.info('Voice websocket resumed', this.logContext());
        break;
      case VoiceOpcode.ClientsConnect:
        for (const userId of payload.d.user_ids) {
          this.connectedUsers.add(userId);
          this.daveSessionManager?.createUser(userId);
        }
        break;
      case VoiceOpcode.ClientDisconnect:
        this.connectedUsers.delete(payload.d.user_id);
        this.daveSessionManager?.destroyUser(payload.d.user_id);
        break;
      case VoiceOpcode.DavePrepareTransition:
        this.daveSessionManager?.onPrepareTransition(
          payload.d.transition_id,
          payload.d.protocol_version
        );
        break;
      case VoiceOpcode.DaveExecuteTransition:
        this.daveSessionManager?.onExecuteTransition(payload.d.transition_id);
        this.daveProtocolVersion =
          this.daveSessionManager?.getProtocolVersion() ?? this.daveProtocolVersion;
        break;
      case VoiceOpcode.DavePrepareEpoch:
        this.daveProtocolVersion = payload.d.protocol_version;
        this.daveSessionManager?.onPrepareEpoch(payload.d.epoch, payload.d.protocol_version);
        break;
      default:
        break;
    }
  }

  private handleBinaryMessage(message: Buffer): void {
    this.sequenceNumber = message.readUInt16BE(0);
    const opcode = message.readUInt8(2) as VoiceBinaryOpcode;

    switch (opcode) {
      case VoiceBinaryOpcode.MlsExternalSender:
        this.daveSessionManager?.onExternalSenderPackage(message.subarray(3));
        break;
      case VoiceBinaryOpcode.MlsProposals:
        this.daveSessionManager?.onMlsProposals(message.subarray(3));
        break;
      case VoiceBinaryOpcode.MlsAnnounceCommitTransition:
        this.daveSessionManager?.onMlsAnnounceCommitTransition(
          message.readUInt16BE(3),
          message.subarray(5)
        );
        break;
      case VoiceBinaryOpcode.MlsWelcome:
        this.daveSessionManager?.onMlsWelcome(message.readUInt16BE(3), message.subarray(5));
        break;
      default:
        break;
    }
  }

  private async handleReady(ready: VoiceReady): Promise<void> {
    const stream = ready.streams[0];
    if (!stream) {
      throw new AppError(
        'Voice ready payload did not include a video stream descriptor.',
        ExitCode.Gateway
      );
    }

    this.currentWebRtcParameters = {
      address: ready.ip,
      port: ready.port,
      audioSsrc: ready.ssrc,
      videoSsrc: stream.ssrc,
      rtxSsrc: stream.rtx_ssrc,
      streams: ready.streams,
    };

    await this.setProtocols();
    this.connectionState.resuming = false;
    this.ready = true;
    this.reconnectState = 'idle';
    this.reapplyMediaState();
    this.emit('ready', this.webRtcWrapper);
  }

  private async handleSelectProtocolAck(payload: VoiceSelectProtocolAck): Promise<void> {
    if (!payload.sdp) {
      throw new AppError(
        'Discord did not return an SDP answer for the WebRTC stream.',
        ExitCode.Gateway
      );
    }

    this.daveProtocolVersion = payload.dave_protocol_version;
    this.ensureDaveSessionManager();
    this.daveSessionManager!.onSelectProtocolAck(payload.dave_protocol_version);

    const remoteSdp = buildRemoteSdp(payload.sdp);
    this.webRtcWrapper.getPeerConnection()?.setRemoteDescription(remoteSdp, 'answer');

    this.emit('select_protocol_ack');
  }

  private ensureDaveSessionManager(): void {
    if (this.daveSessionManager) {
      return;
    }

    this.daveSessionManager = new DaveSessionManager(
      this.dave,
      this.userId,
      this.daveChannelId,
      this.logger.child('dave'),
      (opcode, payload) => this.sendOpcode(opcode, payload),
      (opcode, payload) => this.sendBinaryOpcode(opcode as VoiceBinaryOpcode, payload),
      (keyRatchet) => this.daveEncryptor.updateSelfKeyRatchet(keyRatchet)
    );

    for (const userId of this.connectedUsers) {
      this.daveSessionManager.createUser(userId);
    }
  }

  private setupHeartbeat(intervalMs: number): void {
    this.heartbeatIntervalMs = intervalMs;
    this.lastHeartbeatAckAt ??= performance.now();
    this.missedHeartbeatAcks = 0;
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
    this.heartbeatTimer.unref?.();

    this.sendHeartbeat();
  }

  private sendHeartbeat(): void {
    if (this.webSocket?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (
      this.lastHeartbeatSentAt !== undefined &&
      (this.lastHeartbeatAckAt ?? 0) < this.lastHeartbeatSentAt
    ) {
      this.missedHeartbeatAcks += 1;
    } else {
      this.missedHeartbeatAcks = 0;
    }

    if (this.missedHeartbeatAcks >= 2) {
      this.logger.warn(
        'Voice heartbeat timed out',
        this.logContext({ trigger: 'heartbeat_timeout' })
      );
      this.requestResume('heartbeat_timeout');
      return;
    }

    this.lastHeartbeatSentAt = performance.now();
    this.sendOpcode(VoiceOpcode.Heartbeat, {
      t: Date.now(),
      seq_ack: this.sequenceNumber,
    });
  }

  private handleSocketClose(code: number, reason: string | undefined): void {
    const wasStarted = this.connectionState.started;

    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    this.ready = false;
    this.clearHeartbeatTimer();
    this.connectionState.started = false;

    const classification = classifyVoiceCloseCode(code);
    this.logger.warn('Voice websocket closed', this.logContext({ classification }));

    if (this.closed || !wasStarted) {
      return;
    }

    if (classification === 'resume') {
      this.reconnectState = 'resuming';
      this.connectionState.resuming = true;
      this.start();
      return;
    }

    if (classification === 'refresh') {
      this.requestRecovery('socket_close');
      return;
    }

    this.reconnectState = 'failed';
    this.emitFatalDisconnect(
      new AppError(
        'Discord closed the voice websocket with a fatal close code.',
        ExitCode.Gateway,
        {
          reason: 'voice_ws_fatal_close',
          ...this.logContext(),
        }
      )
    );
  }

  private requestRecovery(trigger: RecoveryTrigger): void {
    if (this.closed || this.reconnectState === 'refreshing' || this.reconnectState === 'failed') {
      return;
    }

    this.reconnectState = 'refreshing';
    this.ready = false;
    this.connectionState.started = false;
    this.clearHeartbeatTimer();
    const socket = this.webSocket;
    this.webSocket = null;
    socket?.close();

    const diagnostics: ReconnectDiagnostics = {
      connectionKind: this.connectionKind,
      attempt: this.reconnectAttempt,
      trigger,
      state: this.reconnectState,
      ...(this.lastCloseCode !== undefined ? { closeCode: this.lastCloseCode } : {}),
      ...(this.lastCloseReason ? { closeReason: this.lastCloseReason } : {}),
    };
    this.streamer.handleConnectionRecoveryRequested(this, diagnostics);
  }

  private requestResume(trigger: RecoveryTrigger): void {
    if (this.closed || this.reconnectState === 'resuming' || this.reconnectState === 'failed') {
      return;
    }

    this.ready = false;
    this.reconnectState = 'resuming';
    this.connectionState.resuming = true;
    this.clearHeartbeatTimer();

    const socket = this.webSocket;
    this.webSocket = null;
    socket?.close(3990, trigger);
  }

  private emitFatalDisconnect(error: AppError): void {
    if (this.reconnectState !== 'failed') {
      this.reconnectState = 'failed';
    }

    this.emit('fatal_disconnect', error);
    this.streamer.handleConnectionFatal(this, error);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private resetDaveSession(): void {
    this.daveSessionManager = undefined;
    this.daveProtocolVersion = 0;
    this.daveEncryptor.updateSelfKeyRatchet(null);
  }

  private reapplyMediaState(): void {
    if (this.speakingEnabled) {
      this.setSpeaking(true);
    } else {
      this.setSpeaking(false);
    }

    if (this.videoEnabled && this.videoAttributes) {
      this.setVideoAttributes(true, this.videoAttributes);
      return;
    }

    this.setVideoAttributes(false);
  }

  private logContext(context?: Record<string, unknown>): Record<string, unknown> {
    return {
      connectionKind: this.connectionKind,
      guildId: this.guildId,
      channelId: this.channelId,
      reconnectAttempt: this.reconnectAttempt,
      reconnectState: this.reconnectState,
      ...(this.lastCloseCode !== undefined ? { closeCode: this.lastCloseCode } : {}),
      ...(this.lastCloseReason ? { closeReason: this.lastCloseReason } : {}),
      ...context,
    };
  }
}

function buildRemoteSdp(discordSdp: string): string {
  let connectionLine = '';
  let port = '';
  let iceUser = '';
  let icePassword = '';
  let fingerprint = '';
  let candidate = '';

  for (const line of discordSdp.split('\n')) {
    if (line.startsWith('c=')) {
      connectionLine = line;
    } else if (line.startsWith('a=rtcp')) {
      port = line.split(':')[1] || '';
    } else if (line.startsWith('a=ice-ufrag')) {
      iceUser = line;
    } else if (line.startsWith('a=ice-pwd')) {
      icePassword = line;
    } else if (line.startsWith('a=fingerprint')) {
      fingerprint = line;
    } else if (line.startsWith('a=candidate')) {
      candidate = line;
    }
  }

  const audioSection = `
m=audio ${port} UDP/TLS/RTP/SAVPF ${codecPayloadType.opus.payload_type}
${connectionLine}
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=setup:passive
a=mid:0
a=maxptime:60
a=inactive
${iceUser}
${icePassword}
${fingerprint}
${candidate}
a=rtcp-mux
a=rtpmap:${codecPayloadType.opus.payload_type} opus/48000/2
a=fmtp:${codecPayloadType.opus.payload_type} minptime=10;useinbandfec=1;usedtx=1
a=rtcp-fb:${codecPayloadType.opus.payload_type} transport-cc
a=rtcp-fb:${codecPayloadType.opus.payload_type} nack
a=ice-lite
`.trim();

  const videoSection = `
m=video ${port} UDP/TLS/RTP/SAVPF ${codecPayloadType.H264.payload_type} ${codecPayloadType.H264.rtx_payload_type}
${connectionLine}
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:13 urn:3gpp:video-orientation
a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=setup:passive
a=mid:1
a=inactive
${iceUser}
${icePassword}
${fingerprint}
${candidate}
a=rtcp-mux
a=ice-lite
a=rtpmap:${codecPayloadType.H264.payload_type} H264/90000
a=rtpmap:${codecPayloadType.H264.rtx_payload_type} rtx/90000
a=fmtp:${codecPayloadType.H264.rtx_payload_type} apt=${codecPayloadType.H264.payload_type}
a=rtcp-fb:${codecPayloadType.H264.payload_type} ccm fir
a=rtcp-fb:${codecPayloadType.H264.payload_type} nack
a=rtcp-fb:${codecPayloadType.H264.payload_type} nack pli
a=rtcp-fb:${codecPayloadType.H264.payload_type} goog-remb
a=rtcp-fb:${codecPayloadType.H264.payload_type} transport-cc
`.trim();

  return `${audioSection}\n${videoSection}`;
}
