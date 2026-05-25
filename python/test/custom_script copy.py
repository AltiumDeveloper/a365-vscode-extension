#!/usr/bin/env python3
from altium import ExecutionContext
from gql import gql


def onExecute(context: ExecutionContext, input_parameters: dict) -> dict:
    project_id = "grid:workspace:593aea78-190d-445e-b469-4de4bfa8fe3c:design:project/434C949E-2CEA-4F22-9089-875B5BEAEDE9" 
    print(f"Project ID: {project_id}")

    # Get project details (updated again)   
    query = gql("""
        mutation ($projectId: ID!, $title: String!, $description: String!) {
            desCreateProjectTask(
                input: {
                    projectId: $projectId
                    task: {
                        name: $title
                        description: $description
                        priority: MEDIUM
                        status: TO_DO
                    }
                }
            ) {
                task {
                    id
                }
            }
        }
    """)
    query.variable_values = {
        "projectId": project_id,
        "title": "Demo task",
        "description": "An example task created from a script"
    }

    print(f"Executing Platform API query...")
    result = context.gql_client.execute(query)
    print(f"Query result: {result}")

    # Process and return the result
    task_id = result["desCreateProjectTask"]["task"]["id"]
    project_info = {
        "taskId": task_id
    }
    print(f"Return values: {project_info}")
    return project_info