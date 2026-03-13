export type ConnectionKind = 'voice' | 'stream';
export type ReconnectState = 'idle' | 'resuming' | 'refreshing' | 'failed';
export type RecoveryTrigger =
  | 'socket_close'
  | 'heartbeat_timeout'
  | 'voice_state_update'
  | 'stream_delete';
export type CloseClassification = 'resume' | 'refresh' | 'fatal';

export type ReconnectDiagnostics = {
  connectionKind: ConnectionKind;
  attempt: number;
  trigger: RecoveryTrigger;
  state: ReconnectState;
  closeCode?: number;
  closeReason?: string;
};

export function classifyVoiceCloseCode(code: number): CloseClassification {
  if (code < 4000 || code === 4015) {
    return 'resume';
  }

  if (code === 4006 || code === 4009) {
    return 'refresh';
  }

  if (code === 4014 || code === 4022) {
    return 'fatal';
  }

  return 'fatal';
}
