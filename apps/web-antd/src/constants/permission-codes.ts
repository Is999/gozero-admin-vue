// PermissionCode 表示后端 `/auth/codes` 返回的单个 uuid 权限码。
// 前端路由 authority、按钮 v-access、表格 action.auth 最终都基于这个字符串做匹配。
export type PermissionCode = string;
type ValueOf<T> = T[keyof T];

// SYSTEM_ROUTE_PERMISSION_CODES 统一维护系统管理模块的页面级 uuid 权限码。
export const SYSTEM_ROUTE_PERMISSION_CODES = {
  ADMIN_LIST: '100023',
  ADMIN_LOG_QUERY: '100052',
  CACHE_LIST: '100043',
  PERMISSION_LIST: '100011',
  PROJECT_DIR: '100065',
  ROLE_LIST: '100002',
  SECRET_KEY_INDEX: '100059',
  SECURITY_DEBUG_INDEX: '200030',
  SYSTEM_CONFIG_LIST: '100036',
  SYSTEM_MANAGE: '100001',
} as const satisfies Record<string, PermissionCode>;

// SYSTEM_ACTION_PERMISSION_CODES 统一维护系统管理模块的按钮与接口级 uuid 权限码。
export const SYSTEM_ACTION_PERMISSION_CODES = {
  ADMIN_ADD: '100025',
  ADMIN_DELETE: '100071',
  ADMIN_EXPORT: '100074',
  ADMIN_EXPORT_DOWNLOAD: '100077',
  ADMIN_EXPORT_STATUS: '100076',
  ADMIN_INFO: '100072',
  ADMIN_PASSWORD_RESET: '100033',
  ADMIN_RESET_INITIAL_STATE: '100075',
  ADMIN_ROLE_LIST: '100029',
  ADMIN_ROLE_UPDATE: '100035',
  ADMIN_STATUS_UPDATE: '100028',
  ADMIN_UPDATE: '100027',
  CACHE_KEY_INFO: '100044',
  CACHE_RENEW: '100045',
  CACHE_RENEW_ALL: '100046',
  CACHE_SEARCH: '100049',
  CACHE_SEARCH_KEY_INFO: '100050',
  CACHE_WARMUP: '100082',
  DOC_PERMISSION_LIST: '100103',
  DOC_PERMISSION_STATUS_UPDATE: '100104',
  PERMISSION_ADD: '100013',
  PERMISSION_DELETE: '100016',
  PERMISSION_STATUS_UPDATE: '100058',
  PERMISSION_UPDATE: '100015',
  ROLE_ADD: '100004',
  ROLE_DELETE: '100007',
  ROLE_STATUS_UPDATE: '100008',
  ROLE_PERMISSION_TREE: '100009',
  ROLE_PERMISSION_UPDATE: '100010',
  ROLE_UPDATE: '100006',
  SECRET_KEY_ADD: '100061',
  SECRET_KEY_EDIT: '100063',
  SECRET_KEY_GET: '100073',
  SECRET_KEY_RENEW: '100070',
  SECRET_KEY_STATUS: '100064',
  SECURITY_DEBUG_DECRYPT: '200038',
  SECURITY_DEBUG_ENCRYPT: '200036',
  SECURITY_DEBUG_SIGN: '200032',
  SECURITY_DEBUG_VERIFY: '200034',
  SYSTEM_CONFIG_ADD: '100038',
  SYSTEM_CONFIG_CACHE: '100041',
  SYSTEM_CONFIG_EXPORT: '100078',
  SYSTEM_CONFIG_IMPORT: '100079',
  SYSTEM_CONFIG_RENEW: '100042',
  SYSTEM_CONFIG_UPDATE: '100040',
} as const satisfies Record<string, PermissionCode>;

// USER_ROUTE_PERMISSION_CODES 统一维护用户管理模块的页面级 uuid 权限码。
export const USER_ROUTE_PERMISSION_CODES = {
  USER_MANAGE: '100099',
  USER_LIST: '100092',
} as const satisfies Record<string, PermissionCode>;

// USER_ACTION_PERMISSION_CODES 统一维护用户管理模块的按钮与接口级 uuid 权限码。
export const USER_ACTION_PERMISSION_CODES = {
  USER_ADD: '100094',
  USER_EXPORT: '100100',
  USER_EXPORT_DOWNLOAD: '100102',
  USER_EXPORT_STATUS: '100101',
  USER_INFO: '100093',
  USER_PASSWORD_RESET: '100097',
  USER_RUNTIME_SYNC: '100098',
  USER_STATUS_UPDATE: '100096',
  USER_UPDATE: '100095',
} as const satisfies Record<string, PermissionCode>;

// OPS_ROUTE_PERMISSION_CODES 统一维护任务运维模块页面级 uuid 权限码。
export const OPS_ROUTE_PERMISSION_CODES = {
  API_DOCS: '200029',
  API_SERVICE_DOCS: '200068',
  COLLECTOR: '200039',
  CONFIG_RELOAD: '200046',
  HOME: '200001',
  RUNTIME_CONFIG: '200050',
  TASK_CONSOLE: '200002',
  TASK_ITEM: '200017',
  TASK_QUEUE: '200013',
  TASK_WORKFLOW_STATUS: '200045',
  USER_TAG: '200024',
} as const satisfies Record<string, PermissionCode>;

// OPS_ACTION_PERMISSION_CODES 统一维护任务运维模块按钮与接口级 uuid 权限码。
export const OPS_ACTION_PERMISSION_CODES = {
  API_RUNTIME_CONFIG_RELOAD_ITEMS: '200070',
  API_RUNTIME_CONFIG_RELOAD_RUN: '200058',
  API_RUNTIME_CONFIG_RELOAD_STATUS: '200057',
  COLLECTOR_FAILURE_RETRY: '200043',
  COLLECTOR_FAILURE_RUN: '200041',
  COLLECTOR_OVERVIEW: '200044',
  RUNTIME_CONFIG_LIST: '200051',
  RUNTIME_CONFIG_OVERVIEW: '200071',
  RUNTIME_CONFIG_PUBLISH: '200054',
  RUNTIME_CONFIG_ROLLBACK: '200055',
  RUNTIME_CONFIG_SAVE: '200052',
  RUNTIME_CONFIG_VALIDATE: '200053',
  TASK_CONFIG_RELOAD_ITEMS: '200049',
  TASK_CONFIG_RELOAD_RUN: '200012',
  TASK_CONFIG_RELOAD_STATUS: '200010',
  TASK_DELETE: '200023',
  TASK_ENQUEUE: '200006',
  TASK_INFO_GET: '200019',
  TASK_QUEUE_PAUSE: '200015',
  TASK_QUEUE_RESUME: '200016',
  TASK_RUN: '200021',
  TASK_WORKFLOW_STATUS: '200008',
  TASK_WORKFLOW_TRIGGER: '200004',
  USER_TAG_RECALCULATE: '200028',
  USER_TAG_WORKFLOW_LEASE_RELEASE: '200048',
  USER_TAG_WORKFLOW_TRIGGER: '200026',
} as const satisfies Record<string, PermissionCode>;

// ROUTE_PERMISSION_CODE_GROUPS 便于按业务模块聚合页面权限。
export const ROUTE_PERMISSION_CODE_GROUPS = {
  ops: OPS_ROUTE_PERMISSION_CODES,
  system: SYSTEM_ROUTE_PERMISSION_CODES,
  user: USER_ROUTE_PERMISSION_CODES,
} as const;

// ACTION_PERMISSION_CODE_GROUPS 便于按业务模块聚合按钮与接口权限。
export const ACTION_PERMISSION_CODE_GROUPS = {
  ops: OPS_ACTION_PERMISSION_CODES,
  system: SYSTEM_ACTION_PERMISSION_CODES,
  user: USER_ACTION_PERMISSION_CODES,
} as const;

// SystemRoutePermissionCode 表示系统管理模块页面级权限码联合类型。
export type SystemRoutePermissionCode = ValueOf<
  typeof SYSTEM_ROUTE_PERMISSION_CODES
>;
// SystemActionPermissionCode 表示系统管理模块按钮与接口级权限码联合类型。
export type SystemActionPermissionCode = ValueOf<
  typeof SYSTEM_ACTION_PERMISSION_CODES
>;
// UserRoutePermissionCode 表示用户管理模块页面级权限码联合类型。
export type UserRoutePermissionCode = ValueOf<
  typeof USER_ROUTE_PERMISSION_CODES
>;
// UserActionPermissionCode 表示用户管理模块按钮与接口级权限码联合类型。
export type UserActionPermissionCode = ValueOf<
  typeof USER_ACTION_PERMISSION_CODES
>;
// OpsRoutePermissionCode 表示任务运维模块页面级权限码联合类型。
export type OpsRoutePermissionCode = ValueOf<typeof OPS_ROUTE_PERMISSION_CODES>;
// OpsActionPermissionCode 表示任务运维模块按钮与接口级权限码联合类型。
export type OpsActionPermissionCode = ValueOf<
  typeof OPS_ACTION_PERMISSION_CODES
>;
// RoutePermissionCode 表示所有页面级权限码联合类型。
export type RoutePermissionCode =
  | OpsRoutePermissionCode
  | SystemRoutePermissionCode
  | UserRoutePermissionCode;
// ActionPermissionCode 表示所有按钮与接口级权限码联合类型。
export type ActionPermissionCode =
  | OpsActionPermissionCode
  | SystemActionPermissionCode
  | UserActionPermissionCode;

// ALL_ROUTE_PERMISSION_CODES 汇总全部页面级权限码，便于做调试、校验和文档输出。
export const ALL_ROUTE_PERMISSION_CODES = [
  ...Object.values(SYSTEM_ROUTE_PERMISSION_CODES),
  ...Object.values(USER_ROUTE_PERMISSION_CODES),
  ...Object.values(OPS_ROUTE_PERMISSION_CODES),
] as const satisfies readonly RoutePermissionCode[];

// ALL_ACTION_PERMISSION_CODES 汇总全部按钮与接口级权限码，便于做调试、校验和文档输出。
export const ALL_ACTION_PERMISSION_CODES = [
  ...Object.values(SYSTEM_ACTION_PERMISSION_CODES),
  ...Object.values(USER_ACTION_PERMISSION_CODES),
  ...Object.values(OPS_ACTION_PERMISSION_CODES),
] as const satisfies readonly ActionPermissionCode[];

// ALL_PERMISSION_CODES 汇总前端当前维护的全部页面与按钮权限码。
export const ALL_PERMISSION_CODES = [
  ...ALL_ROUTE_PERMISSION_CODES,
  ...ALL_ACTION_PERMISSION_CODES,
] as const satisfies readonly PermissionCode[];

// SUPER_ADMIN_ROLE_ID 表示后端约定的超级管理员角色 ID。
export const SUPER_ADMIN_ROLE_ID = 1;

// PermissionOwnerInfo 表示前端构造有效权限码时依赖的登录态信息。
export interface PermissionOwnerInfo {
  // isSuperAdmin 表示后端显式返回的超级管理员标记。
  isSuperAdmin?: boolean;
  // roleIds 表示后端登录信息中的启用角色 ID 列表。
  roleIds?: readonly number[];
}

// asRouteAuthority 把单个或多个页面级权限码标准化为路由 meta.authority 所需数组。
export function asRouteAuthority(
  codes: readonly RoutePermissionCode[] | RoutePermissionCode,
) {
  return Array.isArray(codes) ? [...codes] : [codes];
}

// asActionPermission 把单个或多个按钮/接口级权限码标准化为 v-access 与 auth 所需数组。
export function asActionPermission(
  codes: ActionPermissionCode | readonly ActionPermissionCode[],
) {
  return Array.isArray(codes) ? [...codes] : [codes];
}

// hasAnyPermission 判断当前权限集合中是否拥有任意一个目标权限码。
export function hasAnyPermission(
  ownedCodes: readonly string[] | undefined,
  targetCodes: PermissionCode | readonly PermissionCode[],
) {
  const currentOwnedCodes = new Set(ownedCodes || []);
  const currentTargetCodes = Array.isArray(targetCodes)
    ? targetCodes
    : [targetCodes];
  return currentTargetCodes.some((code) => currentOwnedCodes.has(code));
}

// hasEveryPermission 判断当前权限集合中是否拥有全部目标权限码。
export function hasEveryPermission(
  ownedCodes: readonly string[] | undefined,
  targetCodes: PermissionCode | readonly PermissionCode[],
) {
  const currentOwnedCodes = new Set(ownedCodes || []);
  const currentTargetCodes = Array.isArray(targetCodes)
    ? targetCodes
    : [targetCodes];
  return currentTargetCodes.every((code) => currentOwnedCodes.has(code));
}

// hasSuperAdminRoleId 判断当前角色 ID 列表中是否包含超级管理员角色。
export function hasSuperAdminRoleId(roleIds: readonly number[] | undefined) {
  return (roleIds || []).some(
    (roleId) => Number(roleId) === SUPER_ADMIN_ROLE_ID,
  );
}

// buildEffectiveAccessCodes 统一构造前端实际使用的权限码集合。
// 优先使用后端显式返回的 isSuperAdmin 标记；未命中时再按 roleIds 是否包含角色 ID 1 判断。
// 超级管理员即便后端 `/auth/codes` 返回空数组，前端也补齐全部权限码，保持与后端接口放行一致。
export function buildEffectiveAccessCodes(
  ownerInfo: PermissionOwnerInfo | undefined,
  accessCodes: readonly string[] | undefined,
) {
  const currentAccessCodes = accessCodes || [];
  const isSuperAdmin =
    ownerInfo?.isSuperAdmin ?? hasSuperAdminRoleId(ownerInfo?.roleIds);
  if (isSuperAdmin) {
    return [...new Set([...ALL_PERMISSION_CODES, ...currentAccessCodes])];
  }
  return [...new Set(currentAccessCodes)];
}
