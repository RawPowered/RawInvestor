import fs from 'node:fs/promises';
import path from 'node:path';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const extFromUrl = (url: string): string => {
  const m = url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '';
};

export type DownloadResult = {
  relPath: string;      // e.g. "/images/foo.jpg" — servable URL
  absPath: string;      // filesystem path
  bytes: number;
};

/**
 * Downloads an image into `baseDir` using `slug` as the filename stem. The
 * extension is inferred from the response Content-Type (falls back to URL).
 * Returns a public /images/... path suitable for serving.
 */
export const downloadImage = async (
  imageUrl: string,
  slug: string,
  baseDir: string
): Promise<DownloadResult> => {
  const res = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Referer: 'https://www.pricecharting.com/',
    },
  });
  if (!res.ok) throw new Error(`Image download ${res.status}`);

  const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[ct] || extFromUrl(imageUrl) || '.jpg';
  const filename = `${slug}${ext}`;
  const absPath = path.join(baseDir, filename);

  await fs.mkdir(baseDir, { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(absPath, buf);

  return {
    relPath: `/images/${filename}`,
    absPath,
    bytes: buf.length,
  };
};
