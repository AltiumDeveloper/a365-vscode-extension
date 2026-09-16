# Security Policy

This policy covers the **Altium Developer** VS Code extension (`altium.developer` on
the VS Code Marketplace), published from this repository.

## Reporting a vulnerability

If you believe you have found a security vulnerability, please report it privately
rather than opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/AltiumDeveloper/a365-vscode-extension/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email the maintainers at **security@altium.com**.

Please include enough detail to reproduce the issue (extension version, VS Code
version, operating system, a minimal example, and the impact). We aim to acknowledge
reports within a few business days.

## Scope

The extension performs an OAuth2 PKCE flow, stores the resulting tokens, and passes
an access token to Python scripts that you run. The following are in scope:

- **Token storage.** Tokens are stored in VS Code
  [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
  (`altium365.tokens` for the account token, `altium365.workspaceTokens.<workspaceId>`
  for each workspace-scoped token), which delegates to the OS keychain. VS Code's
  `globalState` holds only the list of workspace IDs that have a cached token, never a
  token value. Anything that writes a token outside SecretStorage — to disk, to
  settings, to the Output channel — is a vulnerability.
- **The auth flow itself.** Dropping PKCE, failing to verify `state`, or leaking a
  token in an error message or log line.
- **Sign out.** Signing out revokes the refresh token at the authorization server and
  deletes every locally stored token. Access tokens already issued are self-expiring
  JWTs; they cannot be recalled and remain valid until they expire. Sign-out failing
  to revoke or failing to delete a token is a vulnerability.

The following are **out of scope**, because they follow from what the extension is:

- **The token in the script subprocess.** Running a script hands it your access token
  via the `ALTIUM365_TOKEN` environment variable, so the script can call the Altium
  365 API as you. Any code you choose to run already has your privileges on your
  machine; a script reading its own environment is not a privilege escalation. Treat
  scripts from other people the way you would treat any other code you execute.
- **Endpoint trust.** `altium365.environments` and the individual endpoint settings
  let you point the extension at any host. It sends credentials to whatever endpoints
  you configure, so only override the defaults with hosts you trust.
- **`altium365.clientId`.** This is a public OAuth client identifier for a PKCE flow,
  not a secret. It ships in the extension package by design.
- **Output channel contents.** Script output, including any parameters your script
  prints, goes to the **Altium 365** Output channel. Scrub logs before attaching them
  to an issue.

## Supported versions

Security fixes are provided for the **latest version published to the VS Code
Marketplace**. Pre-release builds are published on every push to `main` and are fixed
forward only; there are no patches for older pre-releases.
