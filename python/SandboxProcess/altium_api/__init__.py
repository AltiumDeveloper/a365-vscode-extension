"""
Altium API - Public API for Altium design data access.
"""

# Re-export design classes and utility functions
from .design_data import (
    Component,
    Net,
    NetDiffPair,
    NetItem,
    NetRule,
    NetRuleAttribute,
    Parameter,
    Pin,
    ProjectData,
    Variant,
    get_project_parameters,
    load_project_data,
)

from . import utils
from .utils import ComponentClassification
from .checks import ValidationResult

# Deprecated typo alias — kept for backward compatibility, hidden from docs
ComponetClassifaction = ComponentClassification
ComponetClassifaction.__doc__ = (ComponetClassifaction.__doc__ or "") + "\n\n@private"

__all__ = [
    # Design classes
    'Parameter',
    'Pin',
    'NetItem',
    'Component',
    'Net',
    'NetDiffPair',
    'NetRule',
    'NetRuleAttribute',
    'Variant',
    'ProjectData',
    'ComponentClassification',

    # Validation
    'ValidationResult',

    # Utilities
    'utils',
    'load_project_data',
    'get_project_parameters',
]
