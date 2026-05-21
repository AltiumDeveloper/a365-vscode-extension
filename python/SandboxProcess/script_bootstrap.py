#!/usr/bin/env python3
import os
import json
from gql import gql, Client
from gql.transport.aiohttp import AIOHTTPTransport
from altium import ExecutionContext
# user's script that will be downloaded in runtime
import script as untrusted_script

SANDBOX_UNTRUSTED_SCRIPT_RESULT_PREFIX = '>>> script_result:'

def _create_graphql_client(api_url: str, auth_token: str) -> Client:
  # Select your transport with a defined URL endpoint
  transport = AIOHTTPTransport(url=api_url, headers={'Authorization': f'Bearer {auth_token}'})

  # Create a GraphQL client using the defined transport
  client = Client(transport=transport, fetch_schema_from_transport=True, execute_timeout=60)

  return client


def _normalize_on_execute_result(result: object) -> dict:
  """Convert onExecute output to a serialisable dictionary.

  Accept plain `dict` results as-is, or convert ValidationResult-like objects
  via a callable `to_result()` method.
  """

  if isinstance(result, dict):
    return result

  to_result = getattr(result, "to_result", None)
  if not callable(to_result):
    raise TypeError(
      "Invalid script return type from onExecute: expected ValidationResult-like object "
      "with callable to_result(), got {}".format(type(result).__name__)
    )

  converted = to_result()
  if not isinstance(converted, dict):
    raise TypeError(
      "Invalid ValidationResult.to_result() return type: expected dict, got {}".format(
        type(converted).__name__
      )
    )

  return converted

if __name__ == "__main__":
  def encode_script_result(result: object) -> None:
    if not result:
      result = {}
    print(SANDBOX_UNTRUSTED_SCRIPT_RESULT_PREFIX, json.dumps(result))

  workspace_url = os.getenv('WORKSPACE_URL', '')
  platform_api_url = os.getenv('PLATFORM_API_URL', '')
  auth_token = os.getenv('AUTH_TOKEN', '')
  tenant_id = os.getenv('TENANT_ID', '')
  input_data = os.getenv('SCRIPT_PARAMS', '')

  if input_data:
    parsed_input_data = json.loads(input_data)
  else:
    parsed_input_data = {}

  gql_client = _create_graphql_client(platform_api_url, auth_token)

  context = ExecutionContext(auth_token, tenant_id, workspace_url, gql_client)

  raw_result = untrusted_script.onExecute(context, parsed_input_data)
  result = _normalize_on_execute_result(raw_result)
  encode_script_result(result)
