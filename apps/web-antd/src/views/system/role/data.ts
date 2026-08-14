import type { VbenFormSchema } from '#/adapter/form';
import type { OnActionClickFn, VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemRoleApi } from '#/api/system';

import { buildClampTextColumn } from '#/adapter/vxe-table';
import { fetchRoleTreeOptions } from '#/api/system';
import {
  asActionPermission,
  SYSTEM_ACTION_PERMISSION_CODES,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

// statusOptions 返回角色状态选项，避免语言切换后沿用模块初始化时的旧文案。
function statusOptions() {
  return [
    { label: $t('business.message.enable'), value: 1 },
    { label: $t('business.message.disable'), value: 0 },
  ];
}

// findDefaultParentRoleID 递归返回新增角色时首个可选父级角色 ID。
export function findDefaultParentRoleID(
  items: Array<Record<string, any>>,
): number {
  for (const item of items) {
    if (!item.disabled && item.selectable !== false) {
      return Number(item.id || 0);
    }
    const childID = findDefaultParentRoleID(
      Array.isArray(item.children) ? item.children : [],
    );
    if (childID > 0) {
      return childID;
    }
  }
  return 0;
}

// useFormSchema 返回角色新增与编辑表单配置。
export function useFormSchema(
  roleTree: Array<Record<string, any>> = [],
  disableProtectedFields = false,
  disableStatus = false,
): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.roleName'),
      rules: 'required',
    },
    {
      component: 'TreeSelect',
      fieldName: 'pid',
      help: $t('business.message.parentRoleHelp'),
      label: $t('business.message.parentRole'),
      componentProps: {
        allowClear: false,
        disabled: disableProtectedFields,
        fieldNames: {
          children: 'children',
          label: 'title',
          value: 'id',
        },
        placeholder: $t('business.message.selectParentRole'),
        style: { width: '100%' },
        treeData: roleTree,
        treeDefaultExpandAll: true,
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'RadioGroup',
      defaultValue: 1,
      fieldName: 'status',
      label: $t('business.message.roleStatus'),
      componentProps: {
        buttonStyle: 'solid',
        disabled: disableProtectedFields || disableStatus,
        options: statusOptions(),
        optionType: 'button',
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'Textarea',
      fieldName: 'description',
      label: $t('business.message.roleDescription'),
      componentProps: {
        rows: 3,
        maxlength: 255,
        showCount: true,
      },
      formItemClass: 'col-span-2',
    },
  ];
}

// useGridFormSchema 返回角色列表搜索表单配置。
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.roleName'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByRoleName'),
      },
    },
    {
      component: 'ApiTreeSelect',
      fieldName: 'pid',
      label: $t('business.message.parentRole'),
      componentProps: {
        api: fetchRoleTreeOptions,
        allowClear: true,
        fieldNames: {
          children: 'children',
          label: 'title',
          value: 'id',
        },
        placeholder: $t('business.message.filterByParentRole'),
        treeDefaultExpandAll: true,
      },
    },
    {
      component: 'Select',
      fieldName: 'status',
      label: $t('business.message.roleStatus'),
      componentProps: {
        allowClear: true,
        options: statusOptions(),
        placeholder: $t('business.message.filterByStatus'),
      },
    },
  ];
}

// useColumns 返回角色管理表格列配置。
export function useColumns<T = SystemRoleApi.Item>(
  onActionClick: OnActionClickFn<T>,
  onStatusChange?: (newStatus: any, row: T) => PromiseLike<boolean | undefined>,
): VxeTableGridOptions['columns'] {
  return [
    {
      align: 'center',
      field: 'id',
      fixed: 'left',
      title: $t('business.message.roleId'),
      width: 90,
    },
    {
      field: 'title',
      fixed: 'left',
      minWidth: 240,
      title: $t('business.message.roleName'),
      treeNode: true,
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          auth: asActionPermission(
            SYSTEM_ACTION_PERMISSION_CODES.ROLE_STATUS_UPDATE,
          ),
          beforeChange: onStatusChange,
          disabled: (row: SystemRoleApi.Item) =>
            Number(row.id) === 1 || row.manageable !== true,
        },
        name: onStatusChange ? 'CellSwitch' : 'CellTag',
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
    buildClampTextColumn({
      field: 'pids',
      minWidth: 160,
      title: $t('business.message.levelPath'),
    }),
    {
      field: 'createdAt',
      minWidth: 170,
      title: $t('business.message.createdAt'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          iconGridColumns: 3,
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
            auth: asActionPermission(SYSTEM_ACTION_PERMISSION_CODES.ROLE_ADD),
            visible: (row: SystemRoleApi.Item) => row.canCreateChild === true,
          },
          {
            code: 'edit',
            icon: 'edit',
            iconOnly: true,
            text: $t('business.message.edit'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.ROLE_UPDATE,
            ),
            visible: (row: SystemRoleApi.Item) => row.manageable === true,
          },
          {
            code: 'permission',
            icon: 'setting',
            iconOnly: true,
            text: $t('business.message.permissionConfig'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.ROLE_PERMISSION_TREE,
            ),
          },
          {
            code: 'cache',
            icon: 'search',
            iconOnly: true,
            text: $t('business.message.cacheManagement'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.CACHE_KEY_INFO,
            ),
          },
          {
            code: 'delete',
            danger: true,
            icon: 'delete',
            iconOnly: true,
            text: $t('business.message.delete'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.ROLE_DELETE,
            ),
            visible: (row: SystemRoleApi.Item) =>
              row.manageable === true && Number(row.id) !== 1,
          },
        ],
      },
      field: 'operation',
      fixed: 'right',
      headerAlign: 'center',
      showOverflow: false,
      title: $t('business.message.operation'),
      width: 104,
    },
  ];
}
