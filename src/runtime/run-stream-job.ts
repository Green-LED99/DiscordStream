import { resolveCompanionToken } from '../companion-token-provider.js';
import { loadConfig } from '../config.js';
import type { StreamJobSpec } from '../contracts.js';
import { loadDaveModule } from '../dave/libdave.js';
import { Streamer } from '../discord/streamer.js';
import { createUserGatewaySession } from '../discord/user-gateway-session.js';
import { AppError, ExitCode } from '../errors.js';
import { LifecycleReporter } from '../lifecycle.js';
import { Logger } from '../logging.js';
import { validateDirectMediaUrl } from '../media/direct-url.js';
import { createFfmpegNutProcess } from '../media/ffmpeg.js';
import { probeMedia } from '../media/ffprobe.js';
import { PipelineStats } from '../media/pipeline-stats.js';
import { playStream } from '../media/play-stream.js';
import { describeTranscodePlan, selectTranscodePlan } from '../media/transcode-plan.js';

export async function runStreamJob(spec: StreamJobSpec): Promise<void> {
  const config = loadConfig();
  const lifecycle = new LifecycleReporter();
  const logger = new Logger('discord-stream', config.logLevel);
  const abortController = new AbortController();
  const signalHandlers = createSignalHandlers(abortController);

  let streamer: Streamer | null = null;
  let gatewaySession: ReturnType<typeof createUserGatewaySession> | null = null;
  let ffmpegProcess: ReturnType<typeof createFfmpegNutProcess> | null = null;
  let pipelineStats: PipelineStats | null = null;

  try {
    lifecycle.emit('authenticating', {
      guildId: spec.guildId,
      channelId: spec.channelId,
      mode: spec.mode,
    });
    logger.info('Starting stream job', spec);

    const [mediaUrl, dave] = await Promise.all([
      validateDirectMediaUrl(spec.url),
      loadDaveModule(),
    ]);

    const ffprobeStartedAt = performance.now();
    const mediaInfo = await probeMedia(config.ffprobePath, mediaUrl.toString());
    const transcodePlan = selectTranscodePlan(mediaInfo);
    pipelineStats = new PipelineStats(logger.child('pipeline'), transcodePlan);
    pipelineStats.setFfprobeDuration(performance.now() - ffprobeStartedAt);
    logger.debug('Selected media optimization plan', describeTranscodePlan(transcodePlan));
    lifecycle.emit('resolved_media', {
      url: mediaUrl.toString(),
      streamCount: mediaInfo.streams.length,
    });

    const companionToken = await resolveCompanionToken(config.companionTokenProvider);
    gatewaySession = createUserGatewaySession(logger.child('gateway'));
    await gatewaySession.login(companionToken);

    const currentUser = gatewaySession.currentUser();
    if (!currentUser) {
      throw new AppError(
        'The companion client did not expose the authenticated user.',
        ExitCode.Auth
      );
    }

    if (currentUser.bot) {
      throw new AppError(
        'Bot tokens are not supported for companion streaming; use a dedicated user client token.',
        ExitCode.Auth
      );
    }

    streamer = new Streamer(gatewaySession, dave, logger.child('streamer'));
    lifecycle.emit('joining_voice', {
      guildId: spec.guildId,
      channelId: spec.channelId,
      userId: currentUser.id,
    });
    await streamer.joinVoice(spec.guildId, spec.channelId);

    ffmpegProcess = createFfmpegNutProcess(config.ffmpegPath, mediaUrl.toString(), transcodePlan);
    pipelineStats.markFfmpegStarted(ffmpegProcess.startedAt);
    lifecycle.emit('starting_stream', {
      url: mediaUrl.toString(),
      mode: spec.mode,
    });

    const streamPromise = playStream(
      ffmpegProcess.output,
      streamer,
      logger.child('media'),
      pipelineStats,
      abortController.signal
    );

    await Promise.race([streamPromise, ffmpegProcess.wait]);

    lifecycle.emit('completed', {
      guildId: spec.guildId,
      channelId: spec.channelId,
    });
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(
            error instanceof Error ? error.message : 'Unknown stream failure',
            ExitCode.Internal
          );
    logger.error('Stream job failed', {
      message: appError.message,
      exitCode: appError.exitCode,
      details: appError.details,
    });
    throw appError;
  } finally {
    for (const [signalName, handler] of signalHandlers) {
      process.off(signalName, handler);
    }

    pipelineStats?.stop();
    ffmpegProcess?.stop();
    streamer?.leaveVoice();
    streamer?.destroy();
    gatewaySession?.destroy();
  }
}

function createSignalHandlers(
  abortController: AbortController
): Array<[NodeJS.Signals, () => void]> {
  const handlers: Array<[NodeJS.Signals, () => void]> = [
    [
      'SIGINT',
      () => {
        abortController.abort(new Error('Received SIGINT'));
      },
    ],
    [
      'SIGTERM',
      () => {
        abortController.abort(new Error('Received SIGTERM'));
      },
    ],
  ];

  for (const [signalName, handler] of handlers) {
    process.on(signalName, handler);
  }

  return handlers;
}
