export type StreamMode = 'go-live';

export type StreamJobSpec = {
  guildId: string;
  channelId: string;
  url: string;
  mode: StreamMode;
};

export type StreamLifecycleEventName =
  | 'authenticating'
  | 'resolved_media'
  | 'joining_voice'
  | 'starting_stream'
  | 'completed'
  | 'failed';

export type StreamLifecycleEvent = {
  event: StreamLifecycleEventName;
  timestamp: string;
  details?: Record<string, unknown>;
};
