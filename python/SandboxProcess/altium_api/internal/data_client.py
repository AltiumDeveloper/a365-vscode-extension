from altium import ExecutionContext
from .data_models import ProjectData, Parameter
from gql import gql, transport
from typing import List, Optional


_SHARED_FRAGMENTS = """
fragment LocationFields on DesignDataLocation_Preview {
  x
  y
}

fragment RectangleFields on DesignDataRectangle_Preview {
  bottom
  left
  right
  top
}

fragment PinCoreFields on DesignDataPin_Preview {
  documentId
  name
  number
  uniqueId
  variantId
  variantName
  functions
  electricalType
  description
  propagationDelay
  parameters {
    name
    value
  }
}

fragment NetParameterFields on DesignDataNetParameter_Preview {
  name
  value
}

fragment ComponentParameterFields on DesignDataComponentParameter_Preview {
  name
  value
}

fragment PartParameterFields on DesignDataPartParameter_Preview {
  name
  value
}
"""

_SHARED_DESIGN_DATA_FIELDS = """
        designData {
          nets {
            name
            calculatedNetName
            color
            netClasses
            diffPair {
              positiveNet
              negativeNet
            }
            rules {
              name
              attributes {
                name
                value
              }
            }
            location {
              ...LocationFields
            }
            boundingRectangle {
              ...RectangleFields
            }
            netItems {
              documentId
              kind
              portName
              uniqueId
              variantId
              variantName
              location {
                ...LocationFields
              }
              boundingRectangle {
                ...RectangleFields
              }
            }
            lines {
              documentId
              uniqueId
              boundingRectangle {
                ...RectangleFields
              }
              location {
                ...LocationFields
              }
            }
            parameters {
              ...NetParameterFields
            }
            pins {
              ...PinCoreFields
              boundingRectangle {
                ...RectangleFields
              }
              location {
                ...LocationFields
              }
            }
          }
          components {
            documentId
            logicalDesignator
            physicalDesignator
            designComponentId
            libraryComponentId
            variantId
            variantName
            comment
            description
            componentType
            boundingRectangle {
              ...RectangleFields
            }
            location {
              ...LocationFields
            }
            parameters {
              ...ComponentParameterFields
            }
            parts {
              documentId
              itemGuid
              logicalDesignator
              physicalDesignator
              revisionGuid
              designPartId
              variantId
              variantName
              variationKind
              vaultGuid
              boundingRectangle {
                ...RectangleFields
              }
              location {
                ...LocationFields
              }
              parameters {
                ...PartParameterFields
              }
              pins {
                ...PinCoreFields
              }
            }
          }
          variants {
            name
            variantGuid
            variations {
              alternatePart
              componentDesignator
              componentUniqueId
              kind
            }
          }
        }
"""

_SHARED_LATEST_GENERATION_FIELDS = """
        status
        message
        revisionId
""" + _SHARED_DESIGN_DATA_FIELDS + """
        designId
        message
        revisionId
        status
"""


def get_project_grid(input_parameters: dict, workspace_id: Optional[str] = None) -> str:
    """Constructs the project grid identifier for GraphQL queries.

    If the provided projectId is already in the expected grid format, it is returned as-is.
    Otherwise, it is transformed into the full grid format using the workspace ID.

    Args:
        input_parameters: A dict containing either a 'projectId' or 'ProjectId' key
            with the project GUID to query.
        workspace_id: The workspace ID to use if transformation is needed.

    Returns:
        A string representing the project grid identifier for GraphQL queries.

    Raises:
        ValueError: If neither 'projectId' nor 'ProjectId' is present in input_parameters.
        ValueError: If workspace_id is missing when the projectId requires grid format transformation.
    """

    project_id = input_parameters.get("projectId") or input_parameters.get("ProjectId")

    if not project_id:
        raise ValueError("Missing required parameter: projectId")

    if not project_id.startswith("grid:workspace"):
        if not workspace_id:
            raise ValueError("workspace_id is required when projectId is not in grid format")
        return f"grid:workspace:{workspace_id}:design:project/{project_id}"

    return project_id


def build_status_query() -> str:
    """Builds a GraphQL query string to retrieve the latest design generation data.

    Constructs a query that fetches the full design data for a given project,
    including documents, components, nets, variants, and configuration.
    Uses GraphQL variables for parameterization.

    Returns:
        A GraphQL query string targeting the latestGeneration endpoint.
    """

    return _SHARED_FRAGMENTS + """
query ($designGrid: ID!, $revisionId: String) {
  design {
    preview {
      latestGeneration(
        designGrid: $designGrid
        revisionId: $revisionId
      ) {
""" + _SHARED_LATEST_GENERATION_FIELDS + """
      }
    }
  }
}
    """


def _try_get_upload_grid(input_parameters: dict) -> Optional[str]:
    """Returns the upload grid, if provided in the input parameters.

    Args:
        input_parameters: A dict containing a parameter with upload ID to use.

    Returns:
        A string representing the upload grid for GraphQL queries, or None.
    """

    return input_parameters.get("uploadId") or input_parameters.get("UploadId")


def _build_upload_status_query() -> str:
    """Builds a GraphQL query string to retrieve the latest design generation data.

    Constructs a query that fetches the full design data for a given project,
    including documents, components, nets, variants, and configuration.
    Uses GraphQL variables for parameterization.

    Returns:
        A GraphQL query string targeting the latestGeneration endpoint.
    """

    return _SHARED_FRAGMENTS + """
query ($uploadId: String!) {
  design {
    preview {
      latestGenerationByUploadId(
        uploadId: $uploadId
      ) {
""" + _SHARED_LATEST_GENERATION_FIELDS + """
      }
    }
  }
}
    """


def get_design_data(context: ExecutionContext, input_parameters: dict) -> ProjectData:
    """Fetches and returns the latest design data for a design.

    Executes a GraphQL query to retrieve the latest generation of design data,
    including documents, components, nets, variants, and configuration.

    Args:
        context: The Altium provided execution context containing the authenticated GQL client.
        input_parameters: A dict containing either a 'projectId' or 'ProjectId' key
            with the project GUID to query; or a 'uploadId' or 'UploadId' key with the upload GUID to query.

    Returns:
        A ProjectData instance populated with documents, variants, and configuration.

    Raises:
        ValueError: If no valid ID is present in input_parameters.
        RuntimeError: If the design data generation has a FAILED status.
        RuntimeError: If the design data generation status is not COMPLETED.
    """
    print("Preparing query")

    variables = {}
    primary_id = _try_get_upload_grid(input_parameters)
    latest_generation_field = 'unset_latest_generation_field'
    if primary_id:
        print(f"Upload grid provided: {primary_id}.")
        query = _build_upload_status_query()
        latest_generation_field = 'latestGenerationByUploadId'
        variables["uploadId"] = primary_id
    else:
        primary_id = get_project_grid(input_parameters, context.workspace_id)
        print(f"Project ID: {primary_id}")
        query = build_status_query()
        latest_generation_field = 'latestGeneration'
        variables["designGrid"] = primary_id
        
        revision_id = input_parameters.get("ProjectRevisionId")
        if revision_id:
            variables["revisionId"] = revision_id

    gql_query = gql(query)

    try:
        response = context.gql_client.execute(gql_query, variable_values=variables)
    except transport.exceptions.TransportQueryError as e:
        # By default printing the exception only includes the first error message, which is often not useful 
        # (ex. "Cannot return null for non-nullable field" - caused by failure to resolve some fields, described in further errors).
        print(f"GraphQL query execution failed: {e}")
        print()
        for error in e.errors:
            print(f"GraphQL error: {error}")
        
        print()
        print(f"GraphQL query: {gql_query}")
        print(f"GraphQL variables: {variables}")
        raise

    print("Polling data...")
    latest_generation = response.get('design', {}).get('preview', {}).get(latest_generation_field, {})

    status = latest_generation.get('status')
    print(f"Current status: {status}")
    if status == "FAILED":
        error_msg = latest_generation.get('message', 'Unknown error')
        print(f"Failed with error: '{error_msg}'")
        raise RuntimeError(f"Design data generation failed: {error_msg}")

    if status != "COMPLETED":
        print(f"Design data generation is not completed yet for design: '{primary_id}'. Please try again later.")
        raise RuntimeError(f"Design data generation status is not completed yet for design: '{primary_id}'. Please try again later.")

    design_data_dict = latest_generation.get('designData', {})

    # Map to ProjectData class
    print("Mapping response to data classes...")
    project_data = ProjectData.from_dict(design_data_dict)
    print("Returning data")

    return project_data


def build_project_parameters_query() -> str:
    """Builds a GraphQL query string to retrieve parameters for a given project.
    Uses GraphQL variables for parameterization.

    Returns:
        A GraphQL query string targeting the desProjectById endpoint.
    """
    return """
query ($id: ID!) {
  desProjectById(id: $id) {
    parameters {
      name
      value
    }
  }
}
    """


def get_design_parameters(context: ExecutionContext, input_parameters: dict) -> List[Parameter]:
    """Fetches and returns the parameters for a given project.

    Executes a GraphQL query to retrieve all name/value parameters
    associated with the specified project.

    Args:
        context: The Altium provided execution context containing the authenticated GQL client.
        input_parameters: A dict containing either a 'projectId' or 'ProjectId' key
            with the project GUID to query.

    Returns:
        A list of Parameter instances representing the project's parameters.

    Raises:
        ValueError: If neither 'projectId' nor 'ProjectId' is present in input_parameters.
    """
    print("Preparing query")

    project_id = get_project_grid(input_parameters, context.workspace_id)
    print(f"Project ID: {project_id}")

    response = context.gql_client.execute(gql(build_project_parameters_query()), variable_values={"id": project_id})

    print("Polling data...")
    parameters = [
        Parameter.from_dict(p)
        for p in response.get('desProjectById', {}).get('parameters', [])
    ]

    print(f"Current parameters count: {len(parameters)}")
    print("Returning data")
    return parameters