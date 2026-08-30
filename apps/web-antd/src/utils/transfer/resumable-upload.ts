import type { FileTransferApi } from '#/api/core/file-transfer';

import {
  completeFileUpload,
  fetchFileUploadStatus,
  initFileUpload,
  uploadFileChunk,
} from '#/api/core/file-transfer';
import { $t } from '#/locales';

export interface ResumableUploadOptions {
  bizType?: string;
  chunkSize?: number;
  concurrency?: number;
  file: File;
  onProgress?: (session: FileTransferApi.UploadSession) => Promise<void> | void;
}

export async function createResumableUpload(options: ResumableUploadOptions) {
  const file = options.file;
  const chunkSize = normalizeChunkSize(options.chunkSize);
  const concurrency = normalizeConcurrency(options.concurrency);
  const fileHash = await sha256Hex(file);

  let session = await initFileUpload({
    bizType: options.bizType,
    chunkSize,
    contentType: file.type || 'application/octet-stream',
    fileHash,
    fileName: file.name,
    fileSize: file.size,
  });
  await options.onProgress?.(session);

  if (session.status === 'completed') {
    return session;
  }

  if (session.status === 'finalizing') {
    // 分片已经由服务端合并，只重试最终对象提交，避免重新切片或覆盖已校验的本地文件。
    session = await completeFileUpload({ uploadId: session.uploadId });
    await options.onProgress?.(session);
    return session;
  }

  if (session.uploadMode === 'direct' && session.directUpload?.url) {
    await uploadDirectFile(session.directUpload, file);
    session = await completeFileUpload({ uploadId: session.uploadId });
    await options.onProgress?.(session);
    return session;
  }

  const pendingChunks = buildPendingChunks(
    session.totalChunks,
    session.uploadedChunks,
  );
  for (let offset = 0; offset < pendingChunks.length; offset += concurrency) {
    const chunkIndexes = pendingChunks.slice(offset, offset + concurrency);
    const chunkResults = await Promise.all(
      chunkIndexes.map(async (chunkIndex) => {
        const start = chunkIndex * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const chunk = file.slice(start, end);
        return uploadFileChunk(
          {
            chunkIndex,
            uploadId: session.uploadId,
          },
          chunk,
        );
      }),
    );
    session = chunkResults[chunkResults.length - 1] || session;
    await options.onProgress?.(session);
  }

  session = await completeFileUpload({ uploadId: session.uploadId });
  await options.onProgress?.(session);
  return session;
}

export async function refreshResumableUpload(uploadId: string) {
  return fetchFileUploadStatus(uploadId);
}

export async function sha256Hex(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hashBuffer)]
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

function buildPendingChunks(totalChunks: number, uploadedChunks: number[]) {
  const uploadedSet = new Set(uploadedChunks || []);
  const pending: number[] = [];
  for (let index = 0; index < totalChunks; index += 1) {
    if (!uploadedSet.has(index)) {
      pending.push(index);
    }
  }
  return pending;
}

function normalizeChunkSize(chunkSize?: number) {
  const fallback = 2 * 1024 * 1024;
  const value = Number(chunkSize) || fallback;
  return Math.max(256 * 1024, value);
}

function normalizeConcurrency(concurrency?: number) {
  const value = Number(concurrency) || 3;
  return Math.min(4, Math.max(1, value));
}

async function uploadDirectFile(
  plan: NonNullable<FileTransferApi.UploadSession['directUpload']>,
  file: File,
) {
  const response = await fetch(plan.url, {
    body: file,
    headers: {
      ...plan.headers,
    },
    method: plan.method || 'PUT',
  });
  if (response.ok) {
    return;
  }
  const errorText = await response.text().catch(() => '');
  throw new Error(
    errorText ||
      $t('business.message.directUploadFailedWithStatus', [response.status]),
  );
}
