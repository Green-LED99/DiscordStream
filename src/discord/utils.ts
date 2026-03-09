export const streamsSimulcast = [{ type: 'screen', rid: '100', quality: 100 }] as const;

export function generateStreamKey(
  type: 'guild' | 'call',
  guildId: string | null,
  channelId: string,
  userId: string
): string {
  return `${type}${type === 'guild' ? `:${guildId}` : ''}:${channelId}:${userId}`;
}

export function parseStreamKey(streamKey: string): {
  type: 'guild' | 'call';
  guildId: string | null;
  channelId: string;
  userId: string;
} {
  const [type, a, b, c] = streamKey.split(':');

  if (type === 'guild') {
    if (!a || !b || !c) {
      throw new Error(`Invalid guild stream key: ${streamKey}`);
    }

    return {
      type,
      guildId: a,
      channelId: b,
      userId: c,
    };
  }

  if (type === 'call') {
    if (!a || !b) {
      throw new Error(`Invalid call stream key: ${streamKey}`);
    }

    return {
      type,
      guildId: null,
      channelId: a,
      userId: b,
    };
  }

  throw new Error(`Invalid stream key type in ${streamKey}`);
}
