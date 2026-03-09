import { beforeEach, describe, expect, test, vi } from 'vitest';

const runStreamJob = vi.fn();

vi.mock('../src/runtime/run-stream-job.js', () => ({
  runStreamJob,
}));

describe('CLI', () => {
  beforeEach(() => {
    runStreamJob.mockReset();
  });

  test('parses play-url arguments into a stream job spec', async () => {
    const { buildProgram } = await import('../src/cli.js');
    const program = buildProgram();

    await program.parseAsync(
      [
        'node',
        'discord-stream',
        'play-url',
        '--guild-id',
        '123456789012345678',
        '--channel-id',
        '234567890123456789',
        '--url',
        'https://example.com/video.mp4',
      ],
      {
        from: 'node',
      }
    );

    expect(runStreamJob).toHaveBeenCalledWith({
      guildId: '123456789012345678',
      channelId: '234567890123456789',
      url: 'https://example.com/video.mp4',
      mode: 'go-live',
    });
  });
});
