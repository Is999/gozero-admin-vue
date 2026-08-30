import { requestClient } from '#/api/request';

export namespace FileTransferApi {
  export interface DirectUploadPlan {
    method: string;
    url: string;
    headers?: Record<string, string>;
    expiresAt: string;
    objectKey: string;
  }

  export interface UploadInitReq {
    bizType?: string;
    fileName: string;
    fileSize: number;
    chunkSize: number;
    fileHash?: string;
    contentType?: string;
  }

  export interface UploadStatusReq {
    uploadId: string;
  }

  export interface UploadChunkReq {
    uploadId: string;
    chunkIndex: number;
  }

  export interface UploadCompleteReq {
    uploadId: string;
  }

  export interface UploadSession {
    uploadId: string;
    bizType: string;
    fileName: string;
    storedFileName?: string;
    fileSize: number;
    chunkSize: number;
    totalChunks: number;
    fileHash: string;
    contentType: string;
    storageType?: string;
    objectKey?: string;
    storagePath: string;
    uploadMode?: 'direct' | 'server';
    status: 'completed' | 'finalizing' | 'pending' | 'uploading';
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    uploadedChunks: number[];
    directUpload?: DirectUploadPlan;
    accessUrl?: string;
    downloadUrl?: string;
  }
}

export async function initFileUpload(data: FileTransferApi.UploadInitReq) {
  return requestClient.post<FileTransferApi.UploadSession>(
    '/file-transfer/upload/init',
    data,
  );
}

export async function fetchFileUploadStatus(uploadId: string) {
  return requestClient.get<FileTransferApi.UploadSession>(
    '/file-transfer/upload/status',
    {
      params: { uploadId },
    },
  );
}

export async function uploadFileChunk(
  params: FileTransferApi.UploadChunkReq,
  chunk: Blob,
) {
  return requestClient.put<FileTransferApi.UploadSession>(
    chunkUploadUrl(params),
    chunk,
    {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    },
  );
}

export async function completeFileUpload(
  data: FileTransferApi.UploadCompleteReq,
) {
  return requestClient.post<FileTransferApi.UploadSession>(
    '/file-transfer/upload/complete',
    undefined,
    {
      // 完成上传改为 query 传参，和后端 `form:"uploadId"` 解析口径保持一致，
      // 避免极简 JSON body 在请求拦截链里被处理后出现 uploadId 丢失。
      params: { uploadId: data.uploadId },
    },
  );
}

export async function downloadFileUpload(uploadId: string) {
  return requestClient.download<Blob>('/file-transfer/download', {
    params: { uploadId },
  });
}

function chunkUploadUrl(params: FileTransferApi.UploadChunkReq) {
  const query = new URLSearchParams({
    chunkIndex: String(params.chunkIndex),
    uploadId: params.uploadId,
  });
  return `/file-transfer/upload/chunk?${query.toString()}`;
}
