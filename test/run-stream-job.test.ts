import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CompanionTokenProviderConfig } from '../src/companion-token-provider.js';

const callOrder: string[] = [];

const loadConfig = vi.fn();
const resolveCompanionToken = vi.fn();
const validateDirectMediaUrl = vi.fn();
const loadDaveModule = vi.fn();
const probeMedia = vi.fn();
const selectTranscodePlan = vi.fn();
const describeTranscodePlan = vi.fn();
const playStream = vi.fn();
const createFfmpegNutProcess = vi.fn();
const gatewayLogin = vi.fn();
const gatewayDestroy = vi.fn();
const gatewayCurrentUser = vi.fn();
const joinVoice = vi.fn();
const leaveVoice = vi.fn();
const destroyStreamer = vi.fn();

vi.mock('../src/config.js', () => ({
  loadConfig,
}));

vi.mock('../src/companion-token-provider.js', async () => {
  const actual = await vi.importActual('../src/companion-token-provider.js');
  return {
    ...actual,
    resolveCompanionToken,
  };
});

vi.mock('../src/media/direct-url.js', () => ({
  validateDirectMediaUrl,
}));

vi.mock('../src/dave/libdave.js', () => ({
  loadDaveModule,
}));

vi.mock('../src/media/ffprobe.js', () => ({
  probeMedia,
}));

vi.mock('../src/media/transcode-plan.js', () => ({
  selectTranscodePlan,
  describeTranscodePlan,
}));

vi.mock('../src/media/play-stream.js', () => ({
  playStream,
}));

vi.mock('../src/media/ffmpeg.js', () => ({
  createFfmpegNutProcess,
}));

vi.mock('../src/discord/user-gateway-session.js', () => ({
  createUserGatewaySession: vi.fn(() => ({
    login: gatewayLogin,
    destroy: gatewayDestroy,
    currentUser: gatewayCurrentUser,
  })),
}));

vi.mock('../src/discord/streamer.js', () => ({
  Streamer: vi.fn().mockImplementation(() => ({
    joinVoice,
    leaveVoice,
    destroy: destroyStreamer,
  })),
}));

vi.mock('../src/lifecycle.js', () => ({
  LifecycleReporter: vi.fn().mockImplementation(() => ({
    emit: vi.fn(),
  })),
}));

vi.mock('../src/media/pipeline-stats.js', () => ({
  PipelineStats: vi.fn().mockImplementation(() => ({
    setFfprobeDuration: vi.fn(),
    markFfmpegStarted: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe('runStreamJob', () => {
  beforeEach(() => {
    vi.resetModules();
    callOrder.length = 0;

    const provider: CompanionTokenProviderConfig = {
      kind: 'env',
      envVar: 'DISCORD_COMPANION_TOKEN',
    };

    loadConfig.mockReturnValue({
      companionTokenProvider: provider,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      logLevel: 'info',
    });
    resolveCompanionToken.mockImplementation(async () => {
      callOrder.push('resolve-token');
      return 'resolved-token';
    });
    validateDirectMediaUrl.mockImplementation(async () => {
      callOrder.push('validate-media');
      return new URL('https://example.com/video.mp4');
    });
    loadDaveModule.mockImplementation(async () => {
      callOrder.push('load-dave');
      return {};
    });
    probeMedia.mockImplementation(async () => {
      callOrder.push('probe-media');
      return {
        streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      };
    });
    selectTranscodePlan.mockImplementation(() => {
      callOrder.push('select-plan');
      return { video: { mode: 'copy' }, audio: { mode: 'copy' } };
    });
    describeTranscodePlan.mockReturnValue('copy');
    gatewayLogin.mockImplementation(async (token: string) => {
      callOrder.push(`gateway-login:${token}`);
    });
    gatewayCurrentUser.mockReturnValue({
      id: 'user-1',
      bot: false,
    });
    joinVoice.mockImplementation(async () => {
      callOrder.push('join-voice');
    });
    createFfmpegNutProcess.mockImplementation(() => ({
      output: {},
      startedAt: performance.now(),
      wait: Promise.resolve(),
      stop: vi.fn(),
    }));
    playStream.mockImplementation(async () => {
      callOrder.push('play-stream');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('resolves the companion token once immediately before gateway login', async () => {
    const { runStreamJob } = await import('../src/runtime/run-stream-job.js');

    await runStreamJob({
      guildId: 'guild-1',
      channelId: 'channel-1',
      url: 'https://example.com/video.mp4',
      mode: 'go-live',
    });

    expect(resolveCompanionToken).toHaveBeenCalledTimes(1);
    expect(gatewayLogin).toHaveBeenCalledWith('resolved-token');
    expect(callOrder).toEqual([
      'validate-media',
      'load-dave',
      'probe-media',
      'select-plan',
      'resolve-token',
      'gateway-login:resolved-token',
      'join-voice',
      'play-stream',
    ]);
  });
});
