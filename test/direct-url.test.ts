import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AppError } from '../src/errors.js';
import { validateDirectMediaUrl } from '../src/media/direct-url.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/video.mp4') {
      response.statusCode = request.method === 'HEAD' ? 200 : 206;
      response.setHeader('content-type', 'video/mp4');
      response.end();
      return;
    }

    if (request.url === '/file.txt') {
      response.statusCode = 200;
      response.setHeader('content-type', 'text/plain');
      response.end();
      return;
    }

    if (request.url === '/force-download.mp4') {
      response.statusCode = request.method === 'HEAD' ? 200 : 206;
      response.setHeader('content-type', 'application/force-download');
      response.end();
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

describe('validateDirectMediaUrl', () => {
  test('accepts a direct mp4 URL', async () => {
    const url = await validateDirectMediaUrl(`${baseUrl}/video.mp4`);
    expect(url.toString()).toBe(`${baseUrl}/video.mp4`);
  });

  test('rejects unsupported extensions', async () => {
    await expect(validateDirectMediaUrl(`${baseUrl}/file.txt`)).rejects.toBeInstanceOf(AppError);
  });

  test('accepts direct mp4 URLs that resolve as force-download content', async () => {
    const url = await validateDirectMediaUrl(`${baseUrl}/force-download.mp4`);
    expect(url.toString()).toBe(`${baseUrl}/force-download.mp4`);
  });
});
