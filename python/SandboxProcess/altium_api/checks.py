"""Validation checks API surface."""

from __future__ import annotations

from typing import Any, cast

from .internal.data_models import ValidationResult as InternalValidationResult


class ValidationResult:
	"""Interface for validation result accumulator.

    Used to collect violations during validation checks.
    """

	def __init__(self):
		"""Initialize a new ValidationResult."""
		self._internal_result = InternalValidationResult()

	def add_violation(self, violation_reason: str, obj) -> None:
		"""Add a violation for a design object.

        Args:
            violation_reason: Human-readable description of the violation.
            obj: Design object related to the violation.
        """
		from .design_data import Component, Net, Pin, NetItem

		if isinstance(obj, Component):
			internal_obj = obj._internal_component
		elif isinstance(obj, Net):
			internal_obj = obj._internal_net
		elif isinstance(obj, Pin):
			internal_obj = obj._internal_pin
		elif isinstance(obj, NetItem):
			internal_obj = obj._internal_net_item
		else:
			raise TypeError(f"Unsupported object type: {type(obj)}")
		self._internal_result.add_violation(violation_reason, cast(Any, internal_obj))

	def to_result(self) -> dict[str, str]:
		"""Return the serialized violation payload."""
		return self._internal_result.to_result()


