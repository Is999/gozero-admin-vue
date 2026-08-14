import type { VbenFormSchema } from '#/adapter/form';
import type { OnActionClickFn, VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemPermissionApi } from '#/api/system';

import { h } from 'vue';

import { useAccess } from '@vben/access';

import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons-vue';
import { Switch, Tag } from 'ant-design-vue';

import { buildClampTextColumn } from '#/adapter/vxe-table';
import {
  asActionPermission,
  SYSTEM_ACTION_PERMISSION_CODES,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

// statusOptions 返回权限状态选项，避免语言切换后沿用模块初始化时的旧文案。
function statusOptions() {
  return [
    { label: $t('business.message.enable'), value: 1 },
    { label: $t('business.message.disable'), value: 0 },
  ];
}

// PERMISSION_TYPE_META 定义权限类型稳定枚举，文案在使用时从语言包读取。
const PERMISSION_TYPE_META = [
  {
    color: 'geekblue',
    labelKey: 'business.message.permissionTypeDirectory',
    value: 4,
  },
  {
    color: 'processing',
    labelKey: 'business.message.permissionTypeMenu',
    value: 5,
  },
  {
    color: 'purple',
    labelKey: 'business.message.permissionTypeButton',
    value: 7,
  },
  {
    color: 'success',
    labelKey: 'business.message.permissionTypeAdd',
    value: 1,
  },
  {
    color: 'warning',
    labelKey: 'business.message.permissionTypeUpdate',
    value: 2,
  },
  {
    color: 'red',
    labelKey: 'business.message.permissionTypeDelete',
    value: 3,
  },
  {
    color: 'cyan',
    labelKey: 'business.message.permissionTypeView',
    value: 0,
  },
  {
    color: 'blue',
    labelKey: 'business.message.permissionTypePage',
    value: 6,
  },
  {
    color: 'default',
    labelKey: 'business.message.permissionTypeOther',
    value: 8,
  },
];

// typeOptions 返回权限类型选项，按 laravel-admin 的 0-8 类型含义展示。
export function typeOptions() {
  return PERMISSION_TYPE_META.map((item) => ({
    color: item.color,
    label: $t(item.labelKey),
    value: item.value,
  }));
}

// typeTagMeta 返回权限类型标签元信息，列表和角色权限树共用同一套枚举。
export function typeTagMeta(value: number) {
  const item =
    PERMISSION_TYPE_META.find((option) => option.value === value) ||
    PERMISSION_TYPE_META[PERMISSION_TYPE_META.length - 1]!;
  return {
    color: item.color,
    text: $t(item.labelKey),
  };
}

type PermissionTreeTitleRow = {
  expanded?: boolean; // 当前行在权限列表中的展开状态
  treeDepth?: number; // 当前行在权限树中的层级，根节点为 1
  treeLast?: boolean; // 当前节点是否为同级最后一个节点
  treeLineParts?: boolean[]; // 祖先层级是否需要继续绘制竖向连接线
} & SystemPermissionApi.Item;

type PermissionTreeTitleOptions<T> = {
  onToggle: (row: T) => void; // 切换当前权限节点展开状态
};

type PermissionStatusOptions<T> = {
  canUpdate?: boolean; // 当前登录人是否允许修改权限状态
  onChange?: (newStatus: any, row: T) => PromiseLike<boolean | undefined>; // 修改当前权限状态前的确认与保存入口
};

// renderPermissionTitle 渲染权限名称列，保留树层级缩进和单行展开入口。
function renderPermissionTitle<T extends PermissionTreeTitleRow>(
  row: T,
  options?: PermissionTreeTitleOptions<T>,
) {
  const title = String(row.title || '-');
  const depth = Math.max(1, Number(row.treeDepth) || 1);
  const hasChild = Boolean(row.hasChild);
  const expanded = Boolean(row.expanded);
  const icon = expanded ? CaretDownOutlined : CaretRightOutlined;
  const lineParts = Array.isArray(row.treeLineParts) ? row.treeLineParts : [];
  const lineNodes = lineParts.map((visible) =>
    h('span', {
      class: [
        'permission-tree-line',
        visible ? 'permission-tree-line--through' : '',
      ],
    }),
  );
  if (depth > 1) {
    lineNodes.push(
      h('span', {
        class: [
          'permission-tree-branch',
          row.treeLast ? 'permission-tree-branch--last' : '',
        ],
      }),
    );
  }
  const toggleLabel = expanded
    ? $t('business.message.treeCollapseAll')
    : $t('business.message.treeExpandAll');

  return h(
    'div',
    {
      class: 'permission-title-cell',
    },
    [
      h(
        'span',
        { 'aria-hidden': 'true', class: 'permission-tree-lines' },
        lineNodes,
      ),
      h(
        'button',
        {
          'aria-label': hasChild ? toggleLabel : undefined,
          class: [
            'permission-title-toggle',
            hasChild ? 'permission-title-toggle--enabled' : '',
            expanded ? 'permission-title-toggle--expanded' : '',
          ],
          disabled: !hasChild,
          type: 'button',
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            if (hasChild) {
              options?.onToggle(row);
            }
          },
        },
        hasChild ? [h(icon)] : [],
      ),
      h('span', { class: 'permission-title-text', title }, title),
    ],
  );
}

// renderPermissionType 使用稳定 key 渲染类型标签，避免虚拟滚动复用相邻行旧节点。
function renderPermissionType<T extends PermissionTreeTitleRow>(row: T) {
  const type = Number(row.type);
  const tagMeta = typeTagMeta(type);
  return h(
    Tag,
    {
      class: 'permission-type-tag',
      color: tagMeta.color,
      key: `permission-type-${row.id}-${type}`,
    },
    {
      default: () => String(tagMeta.text ?? '-'),
    },
  );
}

// renderPermissionStatus 使用受控 Switch 渲染状态，虚拟滚动时按行 ID 和状态强制稳定更新。
function renderPermissionStatus<T extends PermissionTreeTitleRow>(
  row: T,
  options?: PermissionStatusOptions<T>,
) {
  const status = Number(row.status);
  if (!options?.onChange) {
    return h(
      Tag,
      {
        class: 'permission-status-tag',
        key: `permission-status-tag-${row.id}-${status}`,
        color: status === 1 ? 'success' : 'default',
      },
      {
        default: () =>
          status === 1
            ? $t('business.message.enabled')
            : $t('business.message.disabledStatus'),
      },
    );
  }

  const canUpdate = options.canUpdate === true && row.manageable === true;

  return h(Switch, {
    checked: status === 1,
    checkedChildren: $t('business.message.enable'),
    class: 'permission-status-switch',
    disabled: !canUpdate,
    key: `permission-status-${row.id}-${status}`,
    unCheckedChildren: $t('business.message.disable'),
    async onChange(checked: any) {
      const nextStatus = checked ? 1 : 0;
      const allowChange = await options.onChange?.(nextStatus, row);
      if (allowChange !== false) {
        row.status = nextStatus as SystemPermissionApi.Status;
      }
    },
  });
}

// rootPermissionOption 返回权限树顶级节点选项，避免模块初始化时缓存旧文案。
function rootPermissionOption(): Array<Record<string, any>> {
  return [
    {
      children: [] as Array<Record<string, any>>,
      id: 0,
      title: $t('business.message.rootPermission'),
    },
  ];
}

// useFormSchema 返回权限新增与编辑表单配置。
export function useFormSchema(
  permissionTree: Array<Record<string, any>> = rootPermissionOption(),
  disableStatus = false,
): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'uuid',
      help: $t('business.message.permissionUuidHelp'),
      label: $t('business.message.permissionUuid'),
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.permissionName'),
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'module',
      label: $t('business.message.permissionModule'),
    },
    {
      component: 'TreeSelect',
      defaultValue: 0,
      fieldName: 'pid',
      help: $t('business.message.parentPermissionHelp'),
      label: $t('business.message.parentPermission'),
      componentProps: {
        allowClear: false,
        fieldNames: {
          children: 'children',
          label: 'title',
          value: 'id',
        },
        style: { width: '100%' },
        treeData: permissionTree,
        treeDefaultExpandAll: true,
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'RadioGroup',
      defaultValue: 4,
      fieldName: 'type',
      label: $t('business.message.permissionType'),
      rules: 'required',
      componentProps: {
        buttonStyle: 'solid',
        options: typeOptions(),
        optionType: 'button',
      },
      formItemClass: 'col-span-2',
    },
    {
      component: 'RadioGroup',
      defaultValue: 1,
      fieldName: 'status',
      label: $t('business.message.permissionStatus'),
      componentProps: {
        buttonStyle: 'solid',
        disabled: disableStatus,
        options: statusOptions(),
        optionType: 'button',
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'Textarea',
      fieldName: 'description',
      label: $t('business.message.permissionDescription'),
      componentProps: {
        rows: 3,
        maxlength: 255,
        showCount: true,
      },
      formItemClass: 'col-span-2',
    },
  ];
}

// useGridFormSchema 返回权限列表搜索表单配置。
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'uuid',
      label: $t('business.message.permissionUuid'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByPermissionUuid'),
      },
    },
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.permissionName'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByPermissionName'),
      },
    },
    {
      component: 'Input',
      fieldName: 'module',
      label: $t('business.message.permissionModule'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByPermissionModule'),
      },
    },
    {
      component: 'Select',
      fieldName: 'type',
      label: $t('business.message.permissionType'),
      componentProps: {
        allowClear: true,
        options: typeOptions(),
        placeholder: $t('business.message.filterByType'),
      },
    },
    {
      component: 'Select',
      fieldName: 'status',
      label: $t('business.message.permissionStatus'),
      componentProps: {
        allowClear: true,
        options: statusOptions(),
        placeholder: $t('business.message.filterByStatus'),
      },
    },
  ];
}

// useColumns 返回权限管理表格列配置。
export function useColumns<T extends PermissionTreeTitleRow>(
  onActionClick: OnActionClickFn<T>,
  onStatusChange?: (newStatus: any, row: T) => PromiseLike<boolean | undefined>,
  titleOptions?: PermissionTreeTitleOptions<T>,
): VxeTableGridOptions['columns'] {
  const { hasAccessByCodes } = useAccess();
  const canUpdateStatus = hasAccessByCodes(
    asActionPermission(SYSTEM_ACTION_PERMISSION_CODES.PERMISSION_STATUS_UPDATE),
  );

  return [
    {
      align: 'center',
      field: 'id',
      fixed: 'left',
      title: 'ID',
      width: 90,
    },
    {
      field: 'title',
      fixed: 'left',
      minWidth: 240,
      slots: {
        default: ({ row }: { row: T }) =>
          renderPermissionTitle(row, titleOptions),
      },
      title: $t('business.message.permissionName'),
    },
    {
      align: 'center',
      field: 'uuid',
      minWidth: 160,
      title: $t('business.message.permissionUuid'),
    },
    buildClampTextColumn({
      field: 'module',
      minWidth: 200,
      title: $t('business.message.permissionModule'),
    }),
    {
      align: 'center',
      slots: {
        default: ({ row }: { row: T }) => renderPermissionType(row),
      },
      field: 'type',
      title: $t('business.message.type'),
      width: 100,
    },
    {
      align: 'center',
      slots: {
        default: ({ row }: { row: T }) =>
          renderPermissionStatus(row, {
            canUpdate: canUpdateStatus,
            onChange: onStatusChange,
          }),
      },
      field: 'status',
      title: $t('business.message.status'),
      width: 140,
    },
    buildClampTextColumn({
      field: 'description',
      minWidth: 260,
      title: $t('business.message.remark'),
    }),
    {
      align: 'center',
      cellRender: {
        attrs: {
          nameField: 'title',
          onClick: onActionClick,
        },
        name: 'CellOperation',
        options: [
          {
            code: 'addChild',
            icon: 'plus',
            iconOnly: true,
            text: $t('business.message.addChild'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.PERMISSION_ADD,
            ),
            visible: (row: SystemPermissionApi.Item) =>
              row.canCreateChild === true,
          },
          {
            code: 'edit',
            icon: 'edit',
            iconOnly: true,
            text: $t('business.message.edit'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.PERMISSION_UPDATE,
            ),
            visible: (row: SystemPermissionApi.Item) => row.manageable === true,
          },
          {
            code: 'delete',
            danger: true,
            icon: 'delete',
            iconOnly: true,
            text: $t('business.message.delete'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.PERMISSION_DELETE,
            ),
            visible: (row: SystemPermissionApi.Item) => row.manageable === true,
          },
        ],
      },
      field: 'operation',
      fixed: 'right',
      headerAlign: 'center',
      showOverflow: false,
      title: $t('business.message.operation'),
      width: 120,
    },
  ];
}
