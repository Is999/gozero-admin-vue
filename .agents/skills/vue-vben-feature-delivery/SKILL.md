---
name: vue-vben-feature-delivery
description: "完整交付 Vue/vben 管理后台功能。用于 page、route、menu、table/form、drawer/modal、action、store、API wrapper、i18n、permission、状态收口。"
---

# Vue Vben 功能交付

## 工作流程

1. 修改前先读当前页面模式：route、menu、component 布局、table/form schema、API wrapper、type、store/composable、i18n、permission 和现有 action 风格。
2. 闭合完整用户流程，不只改可见组件。需求暗含列表、详情、新增、编辑、删除、导出、drawer/modal、分页、刷新、重复点击时，要一起接好。
3. 使用现有 vben 组件、hooks、icons、table action、请求 helper、权限 gate 和布局约定。
4. Vben Schema Form 或 Ant Form 已正确接管字段关联时，不得随意覆盖子控件 `id`；动态嵌套表单未被 schema 接管时，必须为控件配置稳定、唯一且匹配的 `id`、`name` 与 `label[for]`。只读文本、状态和操作区不得使用会生成无关联 `label` 的 FormItem 标签。
5. 前端业务文案进入 i18n 文件。除非仓库已有明确模式，不要硬编码业务文案。
6. 补齐用户自然预期的 loading、empty、error、disabled、confirm、success、retry 状态。
7. 敏感操作要对齐后端 MFA、签名、加密、权限和业务码行为。
8. 管理后台保持紧凑、可扫读、工作导向，不做装饰性落地页；页面风格必须统一，优先参考系统管理、任务运维、个人中心等已验证页面的布局骨架、标题层级、操作区和卡片样式，卡片之间统一保持 8px 间距，避免过紧或过松。
9. 表单类页面必须保证稳定、唯一且匹配的 `id`、`name` 与 `label[for]`；Vben Schema Form 或 Ant Form 已接管字段关联时不得重复覆盖子控件标识。表格必须复用仓库统一表格组件与适配器，列头、状态、分页和操作区保持同一套视觉与交互规范。

## 验证

- 运行仓库的 typecheck 命令，通常是 `pnpm -F @vben/web-antd run typecheck`。
- 仓库启用 lint、排序或 pre-commit 时，运行对应检查。
- 可见流程或布局敏感改动使用 `$vue-e2e-smoke-browser` 做浏览器冒烟。
- 表单页面必须实际打开列表筛选、新增、编辑、抽屉、弹框、动态数组和条件分支逐项检查；`label[for]` 目标必须存在且唯一，原生 `input/select/textarea` 至少具备 `id` 或 `name`，控件身份与标签关联必须稳定一致。DevTools 中控件缺少身份、标签未关联、标签目标不存在三类问题必须为 0，本轮路径 console warning/error 必须为 0；只跑 typecheck 不算完成。
- 运行 `git diff --check` 并检查 `git status --short`。

## 交付证据

交付时说明改动的页面、路由、组件，API/type/i18n/permission 是否同步，覆盖了哪些状态，运行了哪些命令，是否跳过浏览器检查，以及还依赖哪些后端条件。
