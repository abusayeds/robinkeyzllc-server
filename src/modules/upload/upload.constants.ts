import { join } from 'path';

export const UPLOAD_ROOT = join(process.cwd(), 'public');

export const UPLOAD_SUBDIR = 'files';

export const UPLOAD_DIR = join(UPLOAD_ROOT, UPLOAD_SUBDIR);

export const UPLOAD_PUBLIC_PREFIX = '/public';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const MAX_FILES_PER_REQUEST = 10;

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'text/csv',
  'application/vnd.ms-excel',
  'application/pdf',
] as const;

export const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.svg',
  '.csv',
  '.pdf',
] as const;
