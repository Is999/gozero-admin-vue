import type { Router } from 'vue-router';

import type { AdminUserInfo } from '#/api/core/user';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';
import { startProgress, stopProgress } from '@vben/utils';

import { APP_DEFAULT_HOME_PATH } from '#/constants/app';
import { buildEffectiveAccessCodes } from '#/constants/permission-codes';
import { accessRoutes, coreRouteNames } from '#/router/routes';
import { useAuthStore } from '#/store';
import {
  currentSessionStateVersion,
  runSessionStateMutation,
  SESSION_STATE_CHANGED,
} from '#/utils/session-state-gate';

import { generateAccess } from './access';

const FALLBACK_NOT_FOUND_ROUTE_NAME = 'FallbackNotFound';

// safeDecodeRedirectPath 安全解析登录回跳路径，避免异常编码打断路由守卫。
function safeDecodeRedirectPath(
  rawPath: null | string | string[] | undefined,
  fallbackPath: string,
) {
  // targetPath 兼容 vue-router query 可能传入数组的情况，只取首个明确路径。
  const targetPath = Array.isArray(rawPath) ? rawPath[0] : rawPath;
  try {
    return decodeURIComponent(targetPath || fallbackPath);
  } catch {
    return targetPath || fallbackPath;
  }
}

// resolveAccessibleRedirectPath 校验登录后的目标路由是否已注册且不是 404 兜底页。
// 登录前访问无权限页面时，redirect 可能指向当前账号不可访问的路径；
// 此时统一降级到个人信息页，避免用户登录后被带入空白 404。
function resolveAccessibleRedirectPath(
  router: Router,
  rawPath: null | string | string[] | undefined,
  fallbackPath = APP_DEFAULT_HOME_PATH,
) {
  const targetPath = safeDecodeRedirectPath(rawPath, fallbackPath);
  const resolved = router.resolve(targetPath);
  const isNotFound = resolved.matched.some(
    (route) => route.name === FALLBACK_NOT_FOUND_ROUTE_NAME,
  );

  if (resolved.matched.length === 0 || isNotFound) {
    return fallbackPath;
  }

  return resolved.fullPath || fallbackPath;
}

/**
 * 通用守卫配置
 * @param router
 */
function setupCommonGuard(router: Router) {
  // 记录已经加载的页面
  const loadedPaths = new Set<string>();

  router.beforeEach((to) => {
    to.meta.loaded = loadedPaths.has(to.path);

    // 页面加载进度条
    if (!to.meta.loaded && preferences.transition.progress) {
      startProgress();
    }
    return true;
  });

  router.afterEach((to) => {
    // 记录页面是否加载,如果已经加载，后续的页面切换动画等效果不在重复执行

    loadedPaths.add(to.path);

    // 关闭页面加载进度条
    if (preferences.transition.progress) {
      stopProgress();
    }
  });
}

/**
 * 权限访问守卫配置
 * @param router
 */
function setupAccessGuard(router: Router) {
  router.beforeEach(async (to, from) => {
    const accessStore = useAccessStore();
    const userStore = useUserStore();
    const authStore = useAuthStore();

    // 基本路由，这些路由不需要进入权限拦截
    if (coreRouteNames.includes(to.name as string)) {
      if (to.path === LOGIN_PATH && accessStore.accessToken) {
        return resolveAccessibleRedirectPath(
          router,
          (to.query?.redirect as string | string[] | undefined) ||
            userStore.userInfo?.homePath,
          APP_DEFAULT_HOME_PATH,
        );
      }
      return true;
    }

    // accessToken 检查
    if (!accessStore.accessToken) {
      // 明确声明忽略权限访问权限，则可以访问
      if (to.meta.ignoreAccess) {
        return true;
      }

      // 没有访问权限，跳转登录页面
      if (to.fullPath !== LOGIN_PATH) {
        return {
          path: LOGIN_PATH,
          // 如不需要，直接删除 query
          query:
            to.fullPath === APP_DEFAULT_HOME_PATH
              ? {}
              : { redirect: encodeURIComponent(to.fullPath) },
          // 携带当前跳转的页面，登录后重新跳转该页面
          replace: true,
        };
      }
      return to;
    }

    // 是否已经生成过动态路由
    if (accessStore.isAccessChecked) {
      return true;
    }
    const sourceToken = String(accessStore.accessToken || '');
    const sourceSessionVersion = currentSessionStateVersion();

    // 生成动态路由前，先读取当前登录用户资料。
    // 这里的角色信息仅用于 Vben 路由过滤入参；真正的页面/按钮/API 权限显隐仍以 accessCodes 为主。
    let userInfo: AdminUserInfo | null =
      userStore.userInfo as AdminUserInfo | null;
    try {
      userInfo = userInfo || (await authStore.fetchUserInfo());
    } catch (error) {
      // 登录阶段取消 MFA 时，authStore 已经清理登录态并回到登录页；守卫这里直接中断当前跳转。
      if (error instanceof Error && error.message === 'MFA_CANCELLED') {
        return {
          path: LOGIN_PATH,
          query: {},
          replace: true,
        };
      }
      if (error instanceof Error && error.message === SESSION_STATE_CHANGED) {
        return false;
      }
      // 401 拦截器已经清理旧会话并发起登录页跳转时，中止当前导航，避免把含请求上下文的已处理异常交给 Vue Router。
      if (
        !accessStore.accessToken ||
        sourceToken !== String(accessStore.accessToken || '') ||
        sourceSessionVersion !== currentSessionStateVersion()
      ) {
        return false;
      }
      throw error;
    }
    // 获取当前登录账号的角色名称、角色 ID与权限码。
    // `roles` 主要用于 Vben 的路由过滤入参与布局展示，不直接承担按钮/API 鉴权职责。
    // `roleIds` 主要用于识别超级管理员角色；当前约定角色 ID 1 为超级管理员。
    // `accessCodes` 来自后端 `/auth/codes`，实际内容是 admin_permission.uuid 列表，
    // 会与路由 meta.authority、按钮 v-access、表格 action.auth 做字符串匹配。
    // 超级管理员兜底只认后端显式返回的 isSuperAdmin 或 roleIds 是否包含角色 ID 1，不再按角色名推断权限。
    const userRoles = userInfo.roles ?? [];
    const accessCodes = buildEffectiveAccessCodes(
      userInfo,
      accessStore.accessCodes,
    );
    const generatedAccess = await runSessionStateMutation(async () => {
      if (
        !sourceToken ||
        sourceToken !== accessStore.accessToken ||
        sourceSessionVersion !== currentSessionStateVersion()
      ) {
        return null;
      }
      // 将兜底后的权限码回写到 accessStore，保证按钮、表格和运行时显隐判断使用同一份数据。
      accessStore.setAccessCodes(accessCodes);

      // Vben 默认使用 roles 过滤路由，这里将角色和权限码合并传入。
      const generated = await generateAccess({
        roles: [...userRoles, ...accessCodes],
        router,
        // 无权限但要求保留菜单时，由路由组件显示 403 页面。
        routes: accessRoutes,
      });
      if (
        sourceToken !== accessStore.accessToken ||
        sourceSessionVersion !== currentSessionStateVersion()
      ) {
        return null;
      }
      accessStore.setAccessMenus(generated.accessibleMenus);
      accessStore.setAccessRoutes(generated.accessibleRoutes);
      accessStore.setIsAccessChecked(true);
      return generated;
    });
    if (!generatedAccess) {
      return false;
    }
    if (
      sourceToken !== accessStore.accessToken ||
      sourceSessionVersion !== currentSessionStateVersion()
    ) {
      return false;
    }

    const needResetPassword = Number(userInfo.needResetPassword || 0) === 1;
    if (needResetPassword && to.name !== 'SystemProfile') {
      return {
        name: 'SystemProfile',
        query: { forceChangePassword: '1' },
        replace: true,
      };
    }

    const homePath = resolveAccessibleRedirectPath(
      router,
      userInfo.homePath || APP_DEFAULT_HOME_PATH,
      APP_DEFAULT_HOME_PATH,
    );
    const redirectPath = resolveAccessibleRedirectPath(
      router,
      (from.query.redirect ??
        (to.path === APP_DEFAULT_HOME_PATH ? homePath : to.fullPath)) as
        | null
        | string
        | string[]
        | undefined,
      homePath,
    );

    return {
      ...router.resolve(redirectPath),
      replace: true,
    };
  });
}

/**
 * 项目守卫配置
 * @param router
 */
function createRouterGuard(router: Router) {
  /** 通用 */
  setupCommonGuard(router);
  /** 权限访问 */
  setupAccessGuard(router);
}

export { createRouterGuard, resolveAccessibleRedirectPath };
