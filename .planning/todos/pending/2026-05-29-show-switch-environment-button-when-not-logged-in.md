---
created: 2026-05-29T13:42:26.555Z
title: Show Switch Environment button when not logged in
area: ui
files:
  - src/sidePanel.ts
  - package.json:contributes.views
---

## Problem

The Switch Environment button (globe icon) on the sidebar view/title bar is currently only visible after successful login. This creates a UX problem: users cannot select their target environment (Dev/UAT/Prod) before authenticating, which means they might sign in to the wrong environment and then need to switch afterward.

The button should be visible even when the user has not logged in, allowing them to select their environment first, then authenticate to that environment.

Current behavior:
- Sign in required → sidebar shows welcome view
- After sign in → globe button appears in view/title
- User realizes they're on wrong environment → needs to switch

Desired behavior:
- Globe button visible immediately in view/title (always)
- User can select environment before or after login
- Sign in command uses the selected environment

## Solution

Update the `package.json` view/title contribution for the globe button to remove any `when` clause that gates it on sign-in state (likely `altium365.signedIn` context key).

Files to check:
- `package.json`: Look for the view/title contribution with the globe icon, check its `when` clause
- `src/sidePanel.ts`: Verify the tree data provider handles the pre-login state correctly when environment changes
- Possibly `src/extension.ts`: Ensure environment selection works before tokens are available

The globe button should always be visible in the Altium 365 view title bar, regardless of authentication state.
