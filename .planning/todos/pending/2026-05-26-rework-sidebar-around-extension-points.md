---
created: 2026-05-26T19:58:50.043Z
title: Rework sidebar around extension points
area: general
files: []
---

## Problem

The extension still models remote customization work around low-level scripts, especially in the sidebar. That no longer matches the product capability we want to expose. The better top-level domain model is Customization via `gloCusExtensionPoints`, where each extension point represents a product surface that can be customized through assignments. We care primarily about `GloCusScriptAssignment` for the next iteration, because it links an extension point to the script that runs when that point is triggered.

If we keep presenting raw scripts directly, the extension misses the stronger product framing: where customization is available, what parameters are expected, and how assignments relate to executions and logs. This should become the next major iteration of the remote-script experience, starting with how items are shown in the sidebar.

## Solution

Rework the remote-script UX and data model around customization entities instead of standalone scripts.

- Introduce extension points as the primary tree concept for remote customization.
- Model assignments beneath each extension point, with first-class support for `GloCusScriptAssignment`.
- Preserve the useful script-level capabilities already built (parameters, execution, logs, editing/publish flows where applicable), but hang them off assignments/scripts in the new hierarchy.
- Use this capture as input for a future phase or backlog item that defines the GraphQL queries, tree shape, command surface, and migration path away from the current low-level script-first model.
