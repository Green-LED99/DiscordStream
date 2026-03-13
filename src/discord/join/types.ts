export type JoinFailureReason =
  | 'join_timeout_no_gateway_response'
  | 'join_timeout_missing_voice_state'
  | 'join_timeout_missing_voice_server'
  | 'join_timeout_missing_stream_create'
  | 'join_timeout_missing_stream_server'
  | 'stream_delete:stream_full'
  | 'stream_delete:unauthorized'
  | 'stream_delete:invalid_channel'
  | 'stream_delete:unavailable'
  | 'stream_delete:unknown'
  | `stream_delete:${string}`;

export type JoinAttemptDiagnostics = {
  attempt: number;
  reason: JoinFailureReason;
  sawVoiceState?: boolean;
  sawVoiceServer?: boolean;
  sawNullEndpoint?: boolean;
  sawStreamCreate?: boolean;
  sawStreamServer?: boolean;
  lastChannelId?: string | null;
  deletedReason?: string;
  unavailable?: boolean;
};

export type VoiceJoinState =
  | 'idle'
  | 'requesting'
  | 'awaiting_voice_state'
  | 'awaiting_voice_server'
  | 'connecting_voice_ws'
  | 'ready'
  | 'failed';

export type StreamJoinState =
  | 'idle'
  | 'requesting'
  | 'awaiting_stream_create'
  | 'awaiting_stream_server'
  | 'connecting_stream_ws'
  | 'ready'
  | 'failed';

export type VoiceHandshakeState = {
  state: VoiceJoinState;
  sessionId: string | null;
  endpoint: string | null;
  token: string | null;
  sawVoiceState: boolean;
  sawVoiceServer: boolean;
  sawNullEndpoint: boolean;
  lastChannelId: string | null;
};

export type StreamHandshakeState = {
  state: StreamJoinState;
  streamKey: string | null;
  rtcServerId: string | null;
  endpoint: string | null;
  token: string | null;
  sawStreamCreate: boolean;
  sawStreamServer: boolean;
  sawNullEndpoint: boolean;
  deletedReason: string | null;
};
