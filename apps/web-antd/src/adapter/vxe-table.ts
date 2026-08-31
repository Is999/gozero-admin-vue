import type { VxeTableGridOptions } from '@vben/plugins/vxe-table';

import type { ComponentPropsMap, ComponentType } from './component';

import { defineComponent, h, ref } from 'vue';

import { useAccess } from '@vben/access';
import {
  setupVbenVxeTable,
  useVbenVxeGrid as useGrid,
} from '@vben/plugins/vxe-table';

import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  KeyOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons-vue';
import { Button, Image, Switch, Tag, Tooltip } from 'ant-design-vue';

import { $t } from '#/locales';
import { router } from '#/router';
import { copyTextToClipboard } from '#/utils/security/password';

import { useVbenForm } from './form';
import { createRowFieldSingleFlight } from './row-field-single-flight';

// runCellSwitchChange 合并同一行字段的并发开关请求，避免重复提交与回写乱序。
const runCellSwitchChange = createRowFieldSingleFlight();

// OnActionClickParams 定义表格操作列点击事件参数。
export interface OnActionClickParams<T = any> {
  code: string; // 操作编码，例如 edit、delete 或业务自定义文案
  row: T; // 当前操作行数据
}

// OnActionClickFn 定义表格操作列点击事件函数。
export type OnActionClickFn<T = any> = (params: OnActionClickParams<T>) => void;

// ClampTextRenderParams 定义多行文本省略渲染器的参数结构。
export interface ClampTextRenderParams {
  column: Record<string, any>; // 当前列定义
  row: Record<string, any>; // 当前行数据
  value: any; // 当前字段原始值
}

// ClampTextRenderAttrs 定义多行文本省略渲染器可配置项。
export interface ClampTextRenderAttrs {
  copyButtonText?: string; // Tooltip 内复制按钮文案
  copiedButtonText?: string; // 复制成功后的按钮文案
  dblclickCopySuccessMessage?: string; // 双击复制成功提示文案
  emptyDblclickCopyMessage?: string; // 双击复制空值提示文案
  enableDblclickCopy?: boolean; // 是否启用双击复制，默认启用
  copySuccessMessage?: string; // 复制成功提示文案
  copyEmptyMessage?: string; // 无内容可复制提示文案
  getText?: (params: ClampTextRenderParams) => any; // 自定义文本提取逻辑
  lines?: number; // 显示行数，默认 2 行
  placeholder?: string; // 空值占位文案
}

// RoutePathLinkAttrs 定义前端路由链接单元格的展示与复制配置。
export interface RoutePathLinkAttrs {
  labelField?: string; // labelField 指向行数据中的短展示文案字段。
  copyButtonText?: string; // Tooltip 内复制按钮文案。
  copiedButtonText?: string; // 复制成功后的按钮文案。
  copySuccessMessage?: string; // 复制成功提示文案。
  copyEmptyMessage?: string; // 无内容可复制提示文案。
  placeholder?: string; // 空值占位文案。
}

// buildClampTextColumn 为列表页长文本列统一补齐“多行省略 + 悬浮查看全文”渲染配置。
export function buildClampTextColumn<T extends Record<string, any>>(
  column: T,
  attrs: ClampTextRenderAttrs = {},
) {
  return {
    ...column,
    cellRender: {
      attrs,
      name: 'CellClampText',
    },
    showOverflow: false,
  };
}

// resolveOperationText 把通用操作编码转换为多语言按钮文案。
function resolveOperationText(code: string) {
  const actionTextMap: Record<string, string> = {
    addChild: $t('business.message.operationAddChild'),
    delete: $t('business.message.operationDelete'),
    detail: $t('business.message.operationDetail'),
    edit: $t('business.message.operationEdit'),
    permission: $t('business.message.operationPermission'),
    renew: $t('business.message.operationRenewCache'),
  };
  return actionTextMap[code] || code;
}

// resolveOperationIcon 根据操作编码返回统一的图标组件。
function resolveOperationIcon(icon: string | undefined, code: string) {
  const iconKey = icon || code;
  const actionIconMap: Record<string, any> = {
    add: PlusOutlined,
    addChild: PlusOutlined,
    check: CheckCircleOutlined,
    copy: CopyOutlined,
    delete: DeleteOutlined,
    detail: EyeOutlined,
    edit: EditOutlined,
    permission: SettingOutlined,
    play: PlayCircleOutlined,
    plus: PlusOutlined,
    read: CheckCircleOutlined,
    receivers: TeamOutlined,
    reload: ReloadOutlined,
    resetPassword: KeyOutlined,
    resetUser: UserSwitchOutlined,
    roleConfig: SettingOutlined,
    run: PlayCircleOutlined,
    runNow: PlayCircleOutlined,
    'self-check': CheckCircleOutlined,
    templateWarmup: ThunderboltOutlined,
    renew: ReloadOutlined,
    refreshCache: ReloadOutlined,
    search: SearchOutlined,
    setting: SettingOutlined,
    taskList: UnorderedListOutlined,
    toggle: PauseCircleOutlined,
    toggleConsume: PauseCircleOutlined,
    viewDetail: EyeOutlined,
    viewTasks: UnorderedListOutlined,
  };
  return actionIconMap[iconKey];
}

// resolveTagMeta 根据字段和值生成通用标签颜色与文案。
function resolveTagMeta(field: string, value: any) {
  if (field === 'mfaStatus') {
    return Number(value) === 1
      ? { color: 'processing', text: $t('business.message.enabled') }
      : { color: 'default', text: $t('business.message.disabled') };
  }
  if (typeof value === 'boolean') {
    return value
      ? { color: 'success', text: $t('business.message.yes') }
      : { color: 'default', text: $t('business.message.no') };
  }
  if (Number(value) === 1) {
    return { color: 'success', text: $t('business.message.enabled') };
  }
  if (Number(value) === 0) {
    return { color: 'default', text: $t('business.message.disabledStatus') };
  }
  return { color: 'default', text: value ?? '-' };
}

// resolveClampText 统一解析单元格要展示的完整文本。
function resolveClampText(
  renderOpts: Record<string, any>,
  params: Record<string, any>,
) {
  const attrs = (renderOpts?.attrs || {}) as ClampTextRenderAttrs;
  const row = (params?.row || {}) as Record<string, any>;
  const column = (params?.column || {}) as Record<string, any>;
  const field = String(column.field || '');
  const rawValue = row[field];
  const value = attrs.getText
    ? attrs.getText({ column, row, value: rawValue })
    : rawValue;
  const text = String(value ?? '').trim();
  return text || attrs.placeholder || '-';
}

// resolveRoutePathText 统一提取表格中的前端页面路径文本。
function resolveRoutePathText(params: Record<string, any>) {
  const row = (params?.row || {}) as Record<string, any>;
  const column = (params?.column || {}) as Record<string, any>;
  return String(row[String(column.field || '')] ?? '').trim();
}

// resolveRoutePathLabel 解析路由链接短文案，避免长路径撑开表格。
function resolveRoutePathLabel(
  renderOpts: Record<string, any>,
  params: Record<string, any>,
  path: string,
) {
  const attrs = (renderOpts?.attrs || {}) as RoutePathLinkAttrs;
  const row = (params?.row || {}) as Record<string, any>;
  const labelField = String(attrs.labelField || '').trim();
  const label = labelField ? String(row[labelField] ?? '').trim() : '';
  return label || path;
}

// resolveRoutablePath 校验当前文本是否为可跳转的前端路由路径。
function resolveRoutablePath(rawPath: string) {
  if (!rawPath || !rawPath.startsWith('/')) {
    return '';
  }
  const resolvedRoute = router.resolve(rawPath);
  if (
    resolvedRoute.matched.length === 0 ||
    resolvedRoute.name === 'FallbackNotFound'
  ) {
    return '';
  }
  return rawPath;
}

// ClampTextTooltipContent 统一渲染长文本 Tooltip 内容，并提供复制成功后的瞬时反馈。
const ClampTextTooltipContent = defineComponent({
  name: 'ClampTextTooltipContent',
  props: {
    attrs: {
      default: () => ({}),
      type: Object as () => ClampTextRenderAttrs,
    },
    text: {
      default: '-',
      type: String,
    },
  },
  setup(props) {
    const copied = ref(false);

    const handleCopy = async () => {
      const copiedOk = await copyTextToClipboard(
        props.text,
        props.attrs.copySuccessMessage || $t('business.message.contentCopied'),
        props.attrs.copyEmptyMessage || $t('business.message.emptyCopyContent'),
      );
      if (!copiedOk) {
        return;
      }
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1500);
    };

    return () =>
      h(
        'div',
        {
          class: 'max-w-[640px]',
        },
        [
          h(
            'div',
            {
              class:
                'inline-flex max-w-[640px] flex-wrap items-center gap-x-3 gap-y-1',
            },
            [
              h(
                'span',
                {
                  class: 'whitespace-pre-wrap break-all leading-5',
                },
                props.text,
              ),
              h(
                Button,
                {
                  class: 'shrink-0 px-0',
                  size: 'small',
                  type: 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    void handleCopy();
                  },
                },
                {
                  default: () =>
                    copied.value
                      ? props.attrs.copiedButtonText ||
                        $t('business.message.copied')
                      : props.attrs.copyButtonText ||
                        $t('business.message.copy'),
                  icon: () => h(CopyOutlined),
                },
              ),
            ],
          ),
        ],
      );
  },
});

setupVbenVxeTable({
  configVxeTable: (vxeUI) => {
    vxeUI.setConfig({
      grid: {
        align: 'center',
        border: false,
        columnConfig: {
          resizable: true,
        },
        minHeight: 180,
        formConfig: {
          // 全局禁用vxe-table的表单配置，使用formOptions
          enabled: false,
        },
        proxyConfig: {
          autoLoad: true,
          response: {
            result: 'items',
            total: 'total',
            list: 'items',
          },
          showActiveMsg: true,
          showResponseMsg: false,
        },
        round: true,
        showOverflow: true,
        size: 'small',
      } as VxeTableGridOptions,
    });

    // 表格配置项可以用 cellRender: { name: 'CellImage' },
    vxeUI.renderer.add('CellImage', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        return h(Image, { src: row[column.field], ...props });
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellLink' },
    vxeUI.renderer.add('CellLink', {
      renderTableDefault(renderOpts) {
        const { props } = renderOpts;
        return h(
          Button,
          { size: 'small', type: 'link' },
          { default: () => props?.text },
        );
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellRoutePathLink' }，仅对真实前端路由渲染跳转链接。
    vxeUI.renderer.add('CellRoutePathLink', {
      renderTableDefault(renderOpts, params) {
        const attrs = (renderOpts?.attrs || {}) as RoutePathLinkAttrs;
        const text = resolveRoutePathText(params);
        if (!text) {
          return attrs.placeholder || '-';
        }
        const routablePath = resolveRoutablePath(text);
        const label = resolveRoutePathLabel(renderOpts, params, text);
        const tooltipAttrs: ClampTextRenderAttrs = {
          copiedButtonText: attrs.copiedButtonText,
          copyButtonText: attrs.copyButtonText,
          copyEmptyMessage: attrs.copyEmptyMessage,
          copySuccessMessage: attrs.copySuccessMessage,
        };
        const title = () =>
          h(ClampTextTooltipContent, {
            attrs: tooltipAttrs,
            text,
          });
        if (!routablePath) {
          return h(
            Tooltip,
            {
              placement: 'topLeft',
            },
            {
              default: () =>
                h(
                  'span',
                  {
                    class: 'block max-w-full truncate text-left',
                  },
                  label,
                ),
              title,
            },
          );
        }
        const routeHref = router.resolve(routablePath).href;
        return h(
          Tooltip,
          {
            placement: 'topLeft',
          },
          {
            default: () =>
              h(
                'a',
                {
                  class:
                    'inline-block max-w-full truncate text-left text-primary hover:underline',
                  href: routeHref,
                  onClick: (event: MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void router.push(routablePath);
                  },
                },
                label,
              ),
            title,
          },
        );
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellTag' }，统一渲染状态标签。
    vxeUI.renderer.add('CellTag', {
      renderTableDefault(renderOpts, params) {
        const { attrs } = renderOpts;
        const { column, row } = params;
        const field = String(column.field || '');
        const rowMap = row as Record<string, any>;
        const value = rowMap[field];
        const tagMeta =
          attrs?.getMeta?.({ column, field, row, value }) ||
          attrs?.tagMap?.[value] ||
          resolveTagMeta(field, value);
        return h(
          Tag,
          { color: tagMeta.color },
          {
            default: () => String(tagMeta.text ?? '-'),
          },
        );
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellSwitch' }，统一渲染状态开关。
    vxeUI.renderer.add('CellSwitch', {
      renderTableDefault(renderOpts, params) {
        const { attrs } = renderOpts;
        const { column, row } = params;
        const field = String(column.field || '');
        const rowMap = row as Record<string, any>;
        const checkedValue = attrs?.checkedValue ?? 1;
        const uncheckedValue = attrs?.uncheckedValue ?? 0;
        const checkedChildren =
          attrs?.checkedChildren ?? $t('business.message.enable');
        const unCheckedChildren =
          attrs?.unCheckedChildren ?? $t('business.message.disable');
        const auth = attrs?.auth;
        let auths: string[] = [];
        if (Array.isArray(auth)) {
          auths = auth;
        } else if (auth) {
          auths = [auth];
        }
        const { hasAccessByCodes } = useAccess();
        const hasAuth = auths.length === 0 || hasAccessByCodes(auths);
        const currentValue = rowMap[field];
        const rowDisabled =
          typeof attrs?.disabled === 'function'
            ? attrs.disabled(row)
            : Boolean(attrs?.disabled);
        const disabled = !hasAuth || rowDisabled;
        const isChecked =
          currentValue === true ||
          currentValue === checkedValue ||
          Number(currentValue) === Number(checkedValue);

        return h(Switch, {
          checked: isChecked,
          checkedChildren,
          disabled,
          unCheckedChildren,
          async onChange(checked: any) {
            const nextValue = checked ? checkedValue : uncheckedValue;
            await runCellSwitchChange(rowMap, field, async () => {
              const allowChange = attrs?.beforeChange
                ? await attrs.beforeChange(nextValue, row)
                : true;
              if (allowChange !== false) {
                rowMap[field] = nextValue;
              }
            });
          },
        });
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellClampText' }，统一渲染多行省略文本与悬浮提示。
    vxeUI.renderer.add('CellClampText', {
      renderTableDefault(renderOpts, params) {
        const attrs = (renderOpts?.attrs || {}) as ClampTextRenderAttrs;
        const text = resolveClampText(renderOpts, params);
        const lines = Math.max(1, Number(attrs.lines) || 2);
        const enableDblclickCopy = attrs.enableDblclickCopy !== false;
        return h(
          Tooltip,
          {
            placement: 'topLeft',
          },
          {
            default: () =>
              h(
                'div',
                {
                  class:
                    'w-full cursor-help text-left leading-5 whitespace-pre-wrap break-all',
                  onDblclick: (event: MouseEvent) => {
                    if (!enableDblclickCopy) {
                      return;
                    }
                    event.stopPropagation();
                    void copyTextToClipboard(
                      text,
                      attrs.dblclickCopySuccessMessage ||
                        $t('business.message.contentCopied'),
                      attrs.emptyDblclickCopyMessage ||
                        $t('business.message.emptyCopyContent'),
                    );
                  },
                  style: {
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: String(lines),
                    display: '-webkit-box',
                    overflow: 'hidden',
                  },
                },
                text,
              ),
            title: () => h(ClampTextTooltipContent, { attrs, text }),
          },
        );
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellOperation' }，统一渲染行操作按钮。
    vxeUI.renderer.add('CellOperation', {
      renderTableDefault(renderOpts, params) {
        const { attrs, options } = renderOpts;
        const { row } = params;
        const actionOptions = Array.isArray(options) ? options : [];
        if (actionOptions.length === 0) {
          return [];
        }
        const { hasAccessByCodes } = useAccess();
        const visibleOptions = actionOptions.filter((item: any) => {
          if (
            typeof item !== 'string' &&
            typeof item?.visible === 'function' &&
            !item.visible(row)
          ) {
            return false;
          }
          if (typeof item !== 'string' && item?.visible === false) {
            return false;
          }
          // allAuth 用于必须同时具备多个接口权限的复合行操作；auth 继续保留原有任一权限语义。
          const allAuth = item?.allAuth;
          if (allAuth) {
            const requiredCodes = Array.isArray(allAuth) ? allAuth : [allAuth];
            if (
              !requiredCodes.every((code: string) => hasAccessByCodes([code]))
            ) {
              return false;
            }
          }
          const auth = item?.auth;
          if (!auth) return true;
          const auths = Array.isArray(auth) ? auth : [auth];
          return hasAccessByCodes(auths);
        });
        if (visibleOptions.length === 0) {
          return [];
        }
        const allIconOnly = visibleOptions.every(
          (item: any) => typeof item !== 'string' && Boolean(item?.iconOnly),
        );
        const shouldWrap = visibleOptions.length > 3;
        const useIconGrid = shouldWrap && allIconOnly;
        const iconGridColumns = Number(attrs?.iconGridColumns) === 3 ? 3 : 2;
        const columnCount = 3;
        const itemStyle =
          shouldWrap && !allIconOnly
            ? {
                width: `calc(${100 / columnCount}% - 4px)`,
              }
            : undefined;
        let containerClass = 'flex flex-wrap items-center gap-x-1 gap-y-1';
        if (useIconGrid) {
          containerClass =
            iconGridColumns === 3
              ? 'mx-auto grid w-fit grid-cols-3 justify-items-center gap-x-1 gap-y-0.5'
              : 'mx-auto grid w-fit grid-cols-2 justify-items-center gap-x-1 gap-y-0.5';
        } else if (shouldWrap) {
          containerClass = 'flex w-full flex-wrap items-center gap-x-2 gap-y-1';
        }
        let itemClass: string | undefined;
        if (useIconGrid) {
          itemClass = 'flex h-6 w-6 items-center justify-center';
        } else if (shouldWrap) {
          itemClass = allIconOnly ? 'flex justify-center' : 'pr-1';
        }
        return h(
          'div',
          {
            class: containerClass,
          },
          {
            default: () =>
              visibleOptions.map((item: any) => {
                const code =
                  typeof item === 'string'
                    ? item
                    : String(item?.code || item?.label || '');
                const text =
                  typeof item === 'string'
                    ? resolveOperationText(item)
                    : String(
                        item?.text || item?.label || resolveOperationText(code),
                      );
                const danger = Boolean(item?.danger) || code === 'delete';
                const icon = resolveOperationIcon(item?.icon, code);
                const iconOnly = Boolean(item?.iconOnly);
                // buttonClass 按操作按钮展示方式计算样式，避免模板中出现嵌套三元表达式。
                let buttonClass = 'px-0';
                if (iconOnly) {
                  buttonClass = 'h-6 w-6 px-0 text-sm leading-none';
                } else if (shouldWrap) {
                  buttonClass = 'w-full justify-start px-0 text-left';
                }
                const button = h(
                  Button,
                  {
                    'aria-label': iconOnly ? text : undefined,
                    danger,
                    class: buttonClass,
                    size: 'small',
                    type: 'link',
                    onClick: () => attrs?.onClick?.({ code, row }),
                  },
                  {
                    default: () => (iconOnly ? undefined : text),
                    icon: icon ? () => h(icon) : undefined,
                  },
                );
                const content = iconOnly
                  ? h(
                      Tooltip,
                      { title: item?.tooltip || text },
                      { default: () => button },
                    )
                  : button;
                return h(
                  'div',
                  {
                    class: itemClass,
                    style: itemStyle,
                  },
                  content,
                );
              }),
          },
        );
      },
    });

    // 这里可以自行扩展 vxe-table 的全局配置，比如自定义格式化
    // vxeUI.formats.add
  },
  useVbenForm,
});

export const useVbenVxeGrid = <T extends Record<string, any>>(
  ...rest: Parameters<typeof useGrid<T, ComponentType, ComponentPropsMap>>
) => useGrid<T, ComponentType, ComponentPropsMap>(...rest);

export type * from '@vben/plugins/vxe-table';
