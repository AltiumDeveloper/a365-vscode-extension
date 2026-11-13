import json
import os

from gql import Client

SECRETS_FILE_PATH_ENV_VAR = 'SECRETS_FILE_PATH'


class SecretsUnavailableError(RuntimeError):
  """This run has a secrets file, but it cannot be read or is not a name-to-value map."""


class SecretNotFoundError(LookupError):
  """The run has a secrets file, but not the secret the script asked for."""


def _read_secrets_file() -> dict:
  path = os.getenv(SECRETS_FILE_PATH_ENV_VAR, '').strip()

  if not path:
    return {}

  try:
    with open(path, 'r', encoding='utf-8') as secrets_file:
      secrets = json.load(secrets_file)
  except FileNotFoundError:
    return {}
  except (OSError, ValueError):
    failure = 'The secrets file for this run could not be read.'
  else:
    failure = None

  if failure is not None:
    raise SecretsUnavailableError(failure)

  if not isinstance(secrets, dict):
    raise SecretsUnavailableError('The secrets file for this run is not a name-to-value map.')

  return secrets


class ExecutionContext:
  def __init__(self, auth_token: str, workspace_id: str, workspace_url: str, gql_client: Client) -> None:
    self.auth_token = auth_token
    self.workspace_id = workspace_id
    self.workspace_url = workspace_url
    self.gql_client = gql_client
    self._secrets = None

  def get_secret(self, name: str) -> str:
    """Return the value of a workspace secret mapped to this script revision."""

    if self._secrets is None:
      self._secrets = _read_secrets_file()

    if name not in self._secrets:
      raise SecretNotFoundError(
        "Secret '{}' is not available to this script. Add it to the script's secrets in the "
        'workspace, then run the script again.'.format(name)
      )

    return self._secrets[name]
