import { describe, expect, test, vi } from 'vitest';
import { createChainedBitstreamFilters } from '../src/media/demuxer.js';

describe('createChainedBitstreamFilters', () => {
  test('initializes each filter from the previous filter output', () => {
    const firstCodecParameters = { codec: 'annexb' };
    const secondCodecParameters = { codec: 'metadata' };
    const firstTimeBase = { num: 1, den: 90_000 };
    const secondTimeBase = { num: 1, den: 48_000 };

    const create = vi
      .fn()
      .mockImplementationOnce(() => ({
        outputCodecParameters: firstCodecParameters,
        outputTimeBase: firstTimeBase,
        filterAll: vi.fn(),
        close: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        outputCodecParameters: secondCodecParameters,
        outputTimeBase: secondTimeBase,
        filterAll: vi.fn(),
        close: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        outputCodecParameters: null,
        outputTimeBase: null,
        filterAll: vi.fn(),
        close: vi.fn(),
      }));

    const initialStream = {
      codecpar: { codec: 'source' },
      timeBase: { num: 1, den: 1_000 },
    };

    createChainedBitstreamFilters({ create }, initialStream, [
      { name: 'h264_mp4toannexb' },
      {
        name: 'h264_metadata',
        options: {
          aud: 'remove',
        },
      },
      { name: 'dump_extra' },
    ]);

    expect(create).toHaveBeenNthCalledWith(1, 'h264_mp4toannexb', initialStream, undefined);
    expect(create).toHaveBeenNthCalledWith(
      2,
      'h264_metadata',
      {
        codecpar: firstCodecParameters,
        timeBase: firstTimeBase,
      },
      {
        options: {
          aud: 'remove',
        },
      }
    );
    expect(create).toHaveBeenNthCalledWith(
      3,
      'dump_extra',
      {
        codecpar: secondCodecParameters,
        timeBase: secondTimeBase,
      },
      undefined
    );
  });

  test('reuses previous stream metadata when a filter does not expose output metadata', () => {
    const create = vi
      .fn()
      .mockImplementationOnce(() => ({
        outputCodecParameters: null,
        outputTimeBase: null,
        filterAll: vi.fn(),
        close: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        outputCodecParameters: null,
        outputTimeBase: null,
        filterAll: vi.fn(),
        close: vi.fn(),
      }));

    const initialStream = {
      codecpar: { codec: 'source' },
      timeBase: { num: 1, den: 1_000 },
    };

    createChainedBitstreamFilters({ create }, initialStream, [
      { name: 'first' },
      { name: 'second' },
    ]);

    expect(create).toHaveBeenNthCalledWith(2, 'second', initialStream, undefined);
  });
});
