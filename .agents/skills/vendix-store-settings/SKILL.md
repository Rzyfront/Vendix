---
name: vendix-store-settings
description: >
  Deprecated legacy store settings skill.
  Trigger: Do not auto-invoke; use vendix-settings-system instead.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
---

# Vendix Store Settings

## Status

Deprecated. Use `vendix-settings-system` for current `store_settings`, `organization_settings`, defaults, templates, and branding behavior.

This file intentionally stays as a minimal redirect so agents do not follow outdated patterns such as `BehaviorSubject` settings state, legacy `domain_settings.config.branding`, or obsolete autosave examples.

## Related Skills

- `vendix-settings-system` - Current settings source of truth
- `vendix-panel-ui` - Module/sidebar visibility through `panel_ui`
- `vendix-s3-storage` - Logo/favicon URL handling
