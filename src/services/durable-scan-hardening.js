import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function scanError(message, { code, status = 400, retryable = false } = {}) {
  const error = new Error(message);
  error.code = code || 'SCAN_JOB_VALIDATION_FAILED';
  error.status = status;
  error.retryable = retryable;
  return error;
}

function parseDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(value || ''));
  if (!match) {
    throw scanError('A base64 JPEG, PNG, or WebP data URL is required.', {
      code: 'SCAN_IMAGE_FORMAT_UNSUPPORTED',
      status: 415,
    });
  }
  const mimeType = match[1].toLowerCase();
  const encoded = match[2].replace(/[\r\n]/g, '');
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw scanError('Image data is not valid base64.', {
      code: 'SCAN_IMAGE_BASE64_INVALID',
      status: 400,
    });
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) {
    throw scanError('The uploaded image is empty.', {
      code: 'SCAN_IMAGE_EMPTY',
      status: 400,
    });
  }
  return {
    mimeType,
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function signatureMatches(mimeType, bytes) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function validatedImageInput(input = {}, maximumBytes) {
  const parsed = parseDataUrl(input.dataUrl);
  if (!MIME_EXTENSIONS.has(parsed.mimeType)) {
    throw scanError('Unsupported image type.', {
      code: 'SCAN_IMAGE_FORMAT_UNSUPPORTED',
      status: 415,
    });
  }
  if (parsed.bytes.length > maximumBytes) {
    throw scanError(`Image exceeds the ${maximumBytes}-byte limit.`, {
      code: 'SCAN_IMAGE_TOO_LARGE',
      status: 413,
    });
  }
  if (!signatureMatches(parsed.mimeType, parsed.bytes)) {
    throw scanError('Image file signature does not match its declared MIME type.', {
      code: 'SCAN_IMAGE_SIGNATURE_MISMATCH',
      status: 415,
    });
  }
  const declaredMimeType = String(input.mimeType || '').trim().toLowerCase();
  if (declaredMimeType && declaredMimeType !== parsed.mimeType) {
    throw scanError('Declared image MIME type does not match the data URL.', {
      code: 'SCAN_IMAGE_MIME_MISMATCH',
      status: 409,
    });
  }
  if (input.size != null && input.size !== '' && Number(input.size) !== parsed.bytes.length) {
    throw scanError('Image byte count does not match the declared size.', {
      code: 'SCAN_IMAGE_SIZE_MISMATCH',
      status: 409,
    });
  }
  return parsed;
}

function exactPositiveInteger(value, maximum, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw scanError(`${fieldName} must be an integer between 1 and ${maximum}.`, {
      code: 'SCAN_JOB_ITEM_COUNT_INVALID',
      status: 400,
    });
  }
  return number;
}

export function hardenDurableScanJobSpool(spool) {
  if (!spool || typeof spool.createJob !== 'function' || typeof spool.addItem !== 'function') {
    throw new TypeError('hardenDurableScanJobSpool requires an initialized DurableScanJobSpool.');
  }
  if (spool.__maneflowHardened === true) return spool;

  const deletedOwners = new Set();
  const persist = spool.persist.bind(spool);
  const createJob = spool.createJob.bind(spool);
  const addItem = spool.addItem.bind(spool);
  const commit = spool.commit.bind(spool);
  const cancel = spool.cancel.bind(spool);

  spool.persist = async (job) => {
    if (deletedOwners.has(String(job?.ownerUserId || ''))) return;
    return persist(job);
  };

  spool.createJob = async (input = {}) => {
    const expectedItems = exactPositiveInteger(input.expectedItems, spool.maxItems, 'expectedItems');
    return createJob({ ...input, expectedItems });
  };

  spool.addItem = async (ownerUserId, jobId, input = {}) => {
    const job = spool.findOwned(ownerUserId, jobId);
    if (!job) return null;
    const parsed = validatedImageInput(input, spool.maxItemBytes);
    const itemKey = String(input.itemKey || '').trim();
    const existing = job.items.find((item) => item.itemKey === itemKey);
    if (existing && existing.sha256 !== parsed.sha256) {
      throw scanError('itemKey already exists with different image content.', {
        code: 'SCAN_ITEM_ID_CONFLICT',
        status: 409,
      });
    }
    return addItem(ownerUserId, jobId, input);
  };

  spool.commit = async (ownerUserId, jobId) => {
    const job = spool.findOwned(ownerUserId, jobId);
    if (!job) return null;
    if (job.items.length !== job.expectedItems) {
      throw scanError(
        `Upload manifest is incomplete: ${job.items.length} of ${job.expectedItems} images are stored.`,
        {
          code: 'SCAN_JOB_UPLOAD_INCOMPLETE',
          status: 409,
          retryable: true,
        },
      );
    }
    return commit(ownerUserId, jobId);
  };

  spool.deleteOwnerJobs = async (ownerUserId) => {
    const owner = String(ownerUserId || '').trim();
    if (!owner) return 0;
    const owned = [...spool.jobs.values()].filter((job) => job.ownerUserId === owner);
    if (!owned.length) return 0;
    deletedOwners.add(owner);
    for (const job of owned) {
      if (!['complete', 'partial', 'failed', 'canceled'].includes(job.status)) {
        await cancel(owner, job.id).catch(() => {});
      }
    }
    await Promise.allSettled(owned.map((job) => fs.rm(spool.jobDir(job.id), {
      recursive: true,
      force: true,
    })));
    for (const job of owned) spool.jobs.delete(job.id);
    return owned.length;
  };

  spool.__maneflowHardened = true;
  return spool;
}

export const durableScanHardeningInternals = {
  parseDataUrl,
  signatureMatches,
  validatedImageInput,
};
