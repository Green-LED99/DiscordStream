export type GatewayEventGeneric<Type extends string, Data> = {
  t: Type;
  d: Data;
};

export type GatewayVoiceStateUpdate = GatewayEventGeneric<
  'VOICE_STATE_UPDATE',
  {
    user_id: string;
    session_id: string;
  }
>;

export type GatewayVoiceServerUpdate = GatewayEventGeneric<
  'VOICE_SERVER_UPDATE',
  {
    guild_id: string;
    channel_id?: string;
    endpoint: string;
    token: string;
  }
>;

export type GatewayStreamCreate = GatewayEventGeneric<
  'STREAM_CREATE',
  {
    stream_key: string;
    rtc_server_id: string;
  }
>;

export type GatewayStreamServerUpdate = GatewayEventGeneric<
  'STREAM_SERVER_UPDATE',
  {
    stream_key: string;
    endpoint: string;
    token: string;
  }
>;

export type GatewayEvent =
  | GatewayVoiceStateUpdate
  | GatewayVoiceServerUpdate
  | GatewayStreamCreate
  | GatewayStreamServerUpdate;
