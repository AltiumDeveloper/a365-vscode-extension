from gql import Client

class ExecutionContext:
  def __init__(self, auth_token: str, workspace_id: str, workspace_url: str, gql_client: Client) -> None:
    self.auth_token = auth_token
    self.workspace_id = workspace_id
    self.workspace_url = workspace_url
    self.gql_client = gql_client
