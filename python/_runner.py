"""Bootstrap that emulates the Altium 365 ScriptingService runtime.

Invoked as:  python -u _runner.py <script_path> [<input_parameters_json_path>]

It imports the user script as a module and calls onExecute(context, input_parameters),
mirroring how the A365 in-browser editor runs the script.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path


class Context:
    """Mimics the `context` object passed by the A365 ScriptingService."""

    def __init__(
        self,
        auth_token: str,
        graphql_url: str | None = None,
        workspace_id: str | None = None,
        workspace_auth_id: str | None = None,
        workspace_name: str | None = None,
    ) -> None:
        self.auth_token = auth_token
        # Extra attributes (not part of the documented contract but useful locally)
        self.graphql_url = graphql_url
        self.workspace_id = workspace_id
        self.workspace_auth_id = workspace_auth_id
        self.workspace_name = workspace_name
        self._gql_client = None

    @property
    def gql_client(self):
        """Lazily build a ``gql.Client`` matching the A365 ScriptingService runtime.

        Requires the ``gql`` package (``pip install "gql[requests]"``).
        """
        if self._gql_client is not None:
            return self._gql_client
        if not self.graphql_url:
            raise RuntimeError(
                "context.gql_client unavailable: ALTIUM365_GRAPHQL_ENDPOINT is not set."
            )
        if not self.auth_token:
            raise RuntimeError(
                "context.gql_client unavailable: ALTIUM365_TOKEN is not set."
            )
        try:
            from gql import Client  # type: ignore
            from gql.transport.requests import RequestsHTTPTransport  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "context.gql_client requires the 'gql' package. "
                "Install it with: pip install \"gql[requests]\""
            ) from e
        transport = RequestsHTTPTransport(
            url=self.graphql_url,
            headers={"Authorization": f"Bearer {self.auth_token}"},
            verify=True,
            retries=2,
        )
        self._gql_client = Client(transport=transport, fetch_schema_from_transport=False)
        return self._gql_client


def _load_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("_user_script", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load script: {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_user_script"] = module
    spec.loader.exec_module(module)
    return module


def _load_input_parameters(path: str | None) -> dict:
    if not path:
        return {}
    p = Path(path)
    if not p.is_file():
        return {}
    with p.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"input_parameters file must contain a JSON object: {path}")
    return data


def main() -> int:
    if len(sys.argv) < 2:
        print("[runner] Missing script path argument.", file=sys.stderr)
        return 2

    script_path = Path(sys.argv[1]).resolve()
    params_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not script_path.is_file():
        print(f"[runner] Script not found: {script_path}", file=sys.stderr)
        return 2

    # Make the script's directory importable so sibling modules (e.g. ProjectData) work.
    sys.path.insert(0, str(script_path.parent))

    auth_token = os.environ.get("ALTIUM365_TOKEN", "")
    graphql_url = os.environ.get("ALTIUM365_GRAPHQL_ENDPOINT") or None
    workspace_id = os.environ.get("ALTIUM365_WORKSPACE_ID") or None
    workspace_auth_id = os.environ.get("ALTIUM365_WORKSPACE_AUTH_ID") or None
    workspace_name = os.environ.get("ALTIUM365_WORKSPACE_NAME") or None
    context = Context(
        auth_token=auth_token,
        graphql_url=graphql_url,
        workspace_id=workspace_id,
        workspace_auth_id=workspace_auth_id,
        workspace_name=workspace_name,
    )

    try:
        input_parameters = _load_input_parameters(params_path)
    except Exception as e:
        print(f"[runner] Failed to read input_parameters: {e}", file=sys.stderr)
        return 2

    print(f"[runner] Script:      {script_path}")
    print(f"[runner] GraphQL URL: {graphql_url or '(not set)'}")
    print(f"[runner] Workspace:   {workspace_name or '(not set)'} ({workspace_id or '-'})")
    print(f"[runner] Token:       {'<set>' if auth_token else '<missing>'}")
    print(f"[runner] input_parameters: {json.dumps(input_parameters)}")
    print("[runner] --- script output ---")

    try:
        module = _load_module(script_path)
    except Exception:
        print("[runner] Error while importing the script:", file=sys.stderr)
        traceback.print_exc()
        return 1

    on_execute = getattr(module, "onExecute", None)
    if not callable(on_execute):
        print(
            "[runner] Script does not define `onExecute(context, input_parameters)`.",
            file=sys.stderr,
        )
        return 1

    try:
        result = on_execute(context, input_parameters)
    except Exception:
        print("[runner] onExecute raised an exception:", file=sys.stderr)
        traceback.print_exc()
        return 1

    print("[runner] --- onExecute result ---")
    try:
        if isinstance(result, str):
            # Some scripts return json.dumps(...). Try to pretty-print.
            try:
                parsed = json.loads(result)
                print(json.dumps(parsed, indent=2, ensure_ascii=False))
            except Exception:
                print(result)
        else:
            print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    except Exception:
        print(repr(result))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
