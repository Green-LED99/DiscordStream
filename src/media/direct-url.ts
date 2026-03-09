import { AppError, ExitCode } from '../errors.js';

const allowedExtensions = new Set(['.mp4', '.mkv']);
const allowedContentTypes = [
  'video/mp4',
  'video/x-matroska',
  'video/webm',
  'application/octet-stream',
  'binary/octet-stream',
];

export async function validateDirectMediaUrl(input: string): Promise<URL> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(input);
  } catch {
    throw new AppError('The provided media URL is invalid.', ExitCode.Media, { input });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new AppError('Only http and https URLs are supported.', ExitCode.Media, {
      protocol: parsedUrl.protocol,
    });
  }

  const extension = extensionFromPath(parsedUrl.pathname);
  if (!allowedExtensions.has(extension)) {
    throw new AppError('Only direct .mp4 and .mkv URLs are supported.', ExitCode.Media, {
      pathname: parsedUrl.pathname,
    });
  }

  const response = await fetchWithFallback(parsedUrl);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();

  if (contentType && !allowedContentTypes.includes(contentType)) {
    throw new AppError(
      'The media URL did not resolve to a supported direct media type.',
      ExitCode.Media,
      {
        contentType,
        url: parsedUrl.toString(),
      }
    );
  }

  return parsedUrl;
}

function extensionFromPath(pathname: string): string {
  const lastDotIndex = pathname.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return '';
  }

  return pathname.slice(lastDotIndex).toLowerCase();
}

async function fetchWithFallback(url: URL): Promise<Response> {
  const head = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
  }).catch(() => null);

  if (head?.ok) {
    return head;
  }

  const ranged = await fetch(url, {
    method: 'GET',
    headers: {
      Range: 'bytes=0-0',
    },
    redirect: 'follow',
  });

  if (!ranged.ok && ranged.status !== 206) {
    throw new AppError('Failed to resolve the media URL.', ExitCode.Media, {
      status: ranged.status,
      url: url.toString(),
    });
  }

  return ranged;
}
