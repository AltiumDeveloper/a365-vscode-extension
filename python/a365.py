"""Altium 365 helper module injected by the VS Code extension.

Usage in your script:

    import a365
    data = a365.query('{ viewer { id } }')

Reads ALTIUM365_GRAPHQL_ENDPOINT and ALTIUM365_TOKEN from the environment.
Uses only the Python standard library (urllib + json) so no extra deps are needed.
"""

from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


class Altium365Error(RuntimeError):
    """Raised when the GraphQL request fails or returns errors."""


def _endpoint() -> str:
    url = os.environ.get("ALTIUM365_GRAPHQL_ENDPOINT", "").strip()
    if not url:
        raise Altium365Error("ALTIUM365_GRAPHQL_ENDPOINT is not set.")
    return url


def _token() -> str:
    tok = os.environ.get("ALTIUM365_TOKEN", "").strip()
    if not tok:
        raise Altium365Error("ALTIUM365_TOKEN is not set.")
    return tok


def query(
    document: str,
    variables: Optional[Dict[str, Any]] = None,
    operation_name: Optional[str] = None,
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """Execute a GraphQL query/mutation and return the `data` field.

    Raises Altium365Error on transport or GraphQL errors.
    """
    payload: Dict[str, Any] = {"query": document}
    if variables is not None:
        payload["variables"] = variables
    if operation_name is not None:
        payload["operationName"] = operation_name

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _endpoint(),
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {_token()}",
        },
    )

    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise Altium365Error(f"HTTP {e.code} {e.reason}: {detail}") from e
    except urllib.error.URLError as e:
        raise Altium365Error(f"Network error: {e.reason}") from e

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        raise Altium365Error(f"Invalid JSON response: {raw[:500]}") from e

    if isinstance(result, dict) and result.get("errors"):
        raise Altium365Error(f"GraphQL errors: {json.dumps(result['errors'], indent=2)}")

    return result.get("data", {}) if isinstance(result, dict) else {}


__all__ = ["query", "Altium365Error"]
