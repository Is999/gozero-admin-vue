import { requestClient } from '#/api/request';

// SystemSecurityDebugApi 定义安全调试台相关接口类型。
export namespace SystemSecurityDebugApi {
  export interface SignParams {
    appId: string; // AppID，对应 secret_key.uuid
    payloadText: string; // 待签名 JSON 文本
    requestId?: string; // 可选请求标识，和真实链路 X-Trace-Id 等价并参与签名
    timestamp?: string; // 可选秒级时间戳，和真实链路 X-Timestamp 等价并参与签名
    signatureType?: 'A' | 'R'; // 签名方式
    signFields?: string[]; // 参与签名的字段；空数组只签 AppID、TraceID 与时间戳
  }

  export interface VerifyParams extends SignParams {
    sign: string; // 待校验签名值
  }

  export interface CipherParams {
    appId: string; // AppID，对应 secret_key.uuid
    cryptoType?: 'A' | 'R'; // 加密方式
    cipherFields?: string[]; // 字段加解密配置
    payloadText?: string; // JSON 文本
  }

  export interface SignResult {
    appId: string; // 实际参与签名的 AppID
    payload: Record<string, any>; // 归一化后的待签名对象
    payloadText: string; // 归一化后的 JSON 文本
    requestId?: string; // 后端返回的请求标识
    traceId: string; // 实际参与签名的追踪标识，对应 X-Trace-Id
    timestamp: string; // 实际参与签名的秒级时间戳，对应 X-Timestamp
    debugSign: string; // 调试生成的签名，与响应传输层的 sign 分开保存
    signFields: string[]; // 实际参与签名的字段
    signText: string; // 最终签名串
    signatureType: 'A' | 'R'; // 实际签名方式
  }

  export interface VerifyResult extends SignResult {
    verified: boolean; // 是否验签成功
  }

  export interface CipherResult {
    appId: string; // AppID
    cipherFields: string[]; // 字段配置
    cipherHeader: string; // 可直接用于 X-Cipher 的头值
    cryptoType: string; // 实际加密方式
    payload?: Record<string, any>; // 输入对象
    payloadText: string; // 输入文本
    resultPayload?: Record<string, any>; // 处理后的对象
    resultPayloadText?: string; // 处理后的 JSON 文本
  }
}

// debugSecuritySign 模拟请求或响应参数签名。
export async function debugSecuritySign(
  data: SystemSecurityDebugApi.SignParams,
) {
  return requestClient.post<SystemSecurityDebugApi.SignResult>(
    '/security/debug/sign',
    data,
  );
}

// debugSecurityVerify 模拟请求或响应参数验签。
export async function debugSecurityVerify(
  data: SystemSecurityDebugApi.VerifyParams,
) {
  return requestClient.post<SystemSecurityDebugApi.VerifyResult>(
    '/security/debug/verify',
    data,
  );
}

// debugSecurityEncrypt 模拟请求或响应参数加密。
export async function debugSecurityEncrypt(
  data: SystemSecurityDebugApi.CipherParams,
) {
  return requestClient.post<SystemSecurityDebugApi.CipherResult>(
    '/security/debug/encrypt',
    data,
  );
}

// debugSecurityDecrypt 模拟请求或响应参数解密。
export async function debugSecurityDecrypt(
  data: SystemSecurityDebugApi.CipherParams,
) {
  return requestClient.post<SystemSecurityDebugApi.CipherResult>(
    '/security/debug/decrypt',
    data,
  );
}
