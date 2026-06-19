"""
Design data classes for Altium API.
"""
from __future__ import annotations
from typing import Optional

from .internal.data_models import NetDiffPair as InternalNetDiffPair
from .internal.data_models import NetRule as InternalNetRule
from .internal.data_models import NetRuleAttribute as InternalNetRuleAttribute
from .internal.data_models import Variant as InternalVariant
from .internal.data_models import Parameter as InternalParameter
from .internal.data_models import Pin as InternalPin
from .internal.data_models import NetItem as InternalNetItem
from .internal.data_models import Net as InternalNet
from .internal.data_models import Component as InternalComponent
from .internal.data_models import ProjectData as InternalProjectData



class Parameter:
    """A name/value parameter attached to a design object.

    Exposes parameter name and value.
    """

    def __init__(self, internal_parameter: InternalParameter):
        self._internal_parameter = internal_parameter

    @property
    def name(self) -> str:
        """Get the parameter name.

        Returns:
            Parameter name string (e.g., "Comment", "Value", "Voltage")
        """
        return self._internal_parameter.name

    @property
    def value(self) -> str:
        """Get the parameter value.

        Returns:
            Parameter value string
        """
        return self._internal_parameter.value


class Pin:
    """An electrical pin on a schematic component.

    Exposes essential pin properties: design_pin_id, name, number, and links
    to the owning component and connected net.
    """

    def __init__(
        self,
        internal_pin: InternalPin,

    ):
        self._internal_pin = internal_pin


    @property
    def design_pin_id(self) -> str:
        """Get the design pin identifier of the pin.

        Returns:
            Design pin ID string
        """
        return self._internal_pin.design_pin_id

    @property
    def unique_id(self) -> str:
        """Get the unique identifier of the pin.

        Deprecated:
            Use `design_pin_id` instead.

        Returns:
            Unique ID string
        """
        return self._internal_pin.design_pin_id

    @property
    def component(self) -> Optional[Component]:
        """Get the component this pin belongs to.

        Returns:
            The owning Component, or None if not resolved.
        """
        if self._internal_pin.component is None:
            return None
        return Component(self._internal_pin.component)

    @property
    def description(self) -> Optional[str]:
        """Get the pin description.

        Returns:
            Pin description string, or None if not provided.
        """
        return self._internal_pin.description

    @property
    def electrical_type(self) -> Optional[str]:
        """Get the pin electrical type.

        Returns:
            Electrical type string, or None if not provided.
        """
        return self._internal_pin.electrical_type

    @property
    def functions(self) -> list[str]:
        """Get the pin functions.

        Returns:
            List of function names reported by the design data service.
        """
        return self._internal_pin.functions

    @property
    def name(self) -> str:
        """Get the functional name of the pin.

        Returns:
            Pin name string (e.g., "VCC", "GND", "D+")
        """
        return self._internal_pin.name

    @property
    def net(self) -> Optional[Net]:
        """Get the net this pin is connected to.

        Returns:
            The connected Net, or None if not resolved.
        """
        if self._internal_pin.net is None:
            return None
        return Net(self._internal_pin.net)

    @property
    def number(self) -> str:
        """Get the pin number.

        Returns:
            Pin number string as shown on the component symbol
        """
        return self._internal_pin.number

    @property
    def parameters(self) -> list[Parameter]:
        """Get the pin parameters.

        Returns:
            List of Parameter objects attached to the pin.
        """
        return [Parameter(p) for p in self._internal_pin.parameters]

    @property
    def propagation_delay(self) -> Optional[float]:
        """Get the pin propagation delay.

        Returns:
            Propagation delay value, or None if not provided.
        """
        return self._internal_pin.propagation_delay


class NetItem:
    """A named port or net label belonging to a net.

    Exposes essential net item properties: design_net_item_id, kind, and port_name.
    """

    def __init__(self, internal_net_item: InternalNetItem):
        self._internal_net_item = internal_net_item

    @property
    def design_net_item_id(self) -> str:
        """Get the design net item identifier.

        Returns:
            Design net item ID string
        """
        return self._internal_net_item.design_net_item_id

    @property
    def unique_id(self) -> str:
        """Get the unique identifier of the net item.

        Deprecated:
            Use `design_net_item_id` instead.

        Returns:
            Unique ID string
        """
        return self._internal_net_item.design_net_item_id

    @property
    def kind(self) -> str:
        """Get the kind of net item.

        Returns:
            Kind string (e.g., "Port", "NetLabel", "PowerSymbol")
        """
        return self._internal_net_item.kind

    @property
    def port_name(self) -> str:
        """Get the port name of the net item.

        Returns:
            Port name string
        """
        return self._internal_net_item.port_name


class Component:
    """A logical schematic component composed of one or more parts.

    Exposes essential component properties: design_component_id, designator, parameters, name, description, pins, and nets.
    """

    def __init__(self, internal_component: InternalComponent):
        self._internal_component = internal_component

    @property
    def unique_id(self) -> str:
        """Get the unique identifier of the component.

        Deprecated:
            Use `design_component_id` instead.

        Returns:
            Unique ID string
        """
        return self._internal_component.design_component_id

    @property
    def design_component_id(self) -> str:
        """Get the design component identifier.

        Returns:
            Design component ID string
        """
        return self._internal_component.design_component_id

    @property
    def library_component_id(self) -> Optional[str]:
        """Get the library component identifier.

        Returns:
            Library component ID string, or None if not available
        """
        return self._internal_component.library_component_id

    @property
    def description(self) -> str:
        """Get the component description from the Description parameter.

        Returns:
            Component description string
        """
        return self._internal_component.description

    @property
    def designator(self) -> str:
        """Get the component designator (logical designator).

        Returns:
            Designator string (e.g., "R1", "U5", "C10")
        """
        return self._internal_component.logical_designator


    @property
    def name(self) -> str:
        """Get the component name.

        Returns:
            Component name string
        """
        return self._internal_component.comment

    @property
    def nets(self) -> list[Net]:
        """Get all nets connected to this component.

        Returns:
            List of Net objects
        """
        return [Net(n) for n in self._internal_component.nets]

    @property
    def parameters(self) -> list[Parameter]:
        """Get all parameters of the component.

        Returns:
            List of Parameter objects
        """
        return [Parameter(p) for p in self._internal_component.parameters]

    @property
    def pins(self) -> list[Pin]:
        """Get all pins of the component.

        Returns:
            List of Pin objects
        """
        return [Pin(p) for p in self._internal_component.pins]

    @property
    def component_type(self) -> str:
        """Get the component type.

        Deprecated:
            Use `type` instead.

        Returns:
            Component type string.
        """
        return self._internal_component.type

    @property
    def type(self) -> str:
        """Get the component type.

        Returns:
            Component type string.
        """
        return self._internal_component.type

    @property
    def variant(self) -> Optional[str]:
        """Get the variant name of the component.

        Returns:
            Variant name string, or None if no variant is assigned
        """
        if self._internal_component.parts:
            return self._internal_component.parts[0].variant_name
        return None



class Net:
    """A schematic net grouping all electrically connected pins.

    Exposes essential net properties: design_net_id, name, parameters, pins, and net_items.
    """

    def __init__(self, internal_net: InternalNet):
        self._internal_net = internal_net

    @property
    def design_net_id(self) -> str:
        """Get the design net identifier.

        Returns:
            Design net ID string
        """
        return self._internal_net.design_net_id

    @property
    def unique_id(self) -> str:
        """Get the unique identifier of the net.

        Deprecated:
            Use `design_net_id` instead.

        Returns:
            Unique ID string
        """
        return self._internal_net.unique_id

    @property
    def diff_pair(self) -> Optional[NetDiffPair]:
        """Get the differential pair metadata, if present.

        Returns:
            NetDiffPair, or None if absent.
        """
        if self._internal_net.diff_pair is None:
            return None
        return NetDiffPair(self._internal_net.diff_pair)

    @property
    def name(self) -> str:
        """Get the net name.

        Returns:
            Net name string (e.g., "GND", "VCC3V3")
        """
        return self._internal_net.name

    @property
    def net_classes(self) -> list[str]:
        """Get the net classes associated with this net.

        Returns:
            List of net class names.
        """
        return self._internal_net.net_classes

    @property
    def net_items(self) -> list[NetItem]:
        """Get all net items (ports, labels) belonging to this net.

        Returns:
            List of NetItem objects
        """
        return [NetItem(ni) for ni in self._internal_net.net_items]

    @property
    def parameters(self) -> list[Parameter]:
        """Get all parameters of the net.

        Returns:
            List of Parameter objects
        """
        return [Parameter(p) for p in self._internal_net.parameters]

    @property
    def pins(self) -> list[Pin]:
        """Get all pins connected to this net.

        Returns:
            List of Pin objects
        """
        return [Pin(p) for p in self._internal_net.pins]

    @property
    def rules(self) -> list[NetRule]:
        """Get the rules attached to this net.

        Returns:
            List of NetRule objects.
        """
        return [NetRule(rule) for rule in self._internal_net.rules]


class NetDiffPair:
    """Differential pair metadata attached to a net."""

    def __init__(self, internal_net_diff_pair: InternalNetDiffPair):
        self._internal_net_diff_pair = internal_net_diff_pair

    @property
    def negative_net(self) -> str:
        """Get the negative net name.

        Returns:
            Net name used as the negative side of the differential pair.
        """
        return self._internal_net_diff_pair.negative_net

    @property
    def positive_net(self) -> str:
        """Get the positive net name.

        Returns:
            Net name used as the positive side of the differential pair.
        """
        return self._internal_net_diff_pair.positive_net


class NetRuleAttribute:
    """A single name/value attribute attached to a net rule."""

    def __init__(self, internal_net_rule_attribute: InternalNetRuleAttribute):
        self._internal_net_rule_attribute = internal_net_rule_attribute

    @property
    def name(self) -> str:
        """Get the attribute name.

        Returns:
            Attribute name string.
        """
        return self._internal_net_rule_attribute.name

    @property
    def value(self) -> str:
        """Get the attribute value.

        Returns:
            Attribute value string.
        """
        return self._internal_net_rule_attribute.value


class NetRule:
    """A rule attached to a net."""

    def __init__(self, internal_net_rule: InternalNetRule):
        self._internal_net_rule = internal_net_rule

    @property
    def attributes(self) -> list[NetRuleAttribute]:
        """Get rule attributes.

        Returns:
            List of NetRuleAttribute objects
        """
        return [NetRuleAttribute(attribute) for attribute in self._internal_net_rule.attributes]

    @property
    def name(self) -> str:
        """Get the rule name.

        Returns:
            Rule name string.
        """
        return self._internal_net_rule.name

class Variant:
    """A Design variant defined in the project.

    Exposes variant name and GUID.
    """

    def __init__(self, internal_variant: InternalVariant):
        self._internal_variant = internal_variant

    @property
    def name(self) -> str:
        """Get the variant name.

        Returns:
            Variant name string (e.g., "Production", "Prototype")
        """
        return self._internal_variant.name

    @property
    def variant_guid(self) -> str:
        """Get the variant GUID.

        Returns:
            Variant GUID string
        """
        return self._internal_variant.variant_guid


class ProjectData:
    """Complete design data snapshot for a project.

    Exposes only the main design collections: components, nets, and variants.
    """

    def __init__(self, internal_data: InternalProjectData):
        self._internal_data = internal_data

    @property
    def components(self) -> list[Component]:
        """Get all components in the project.

        Returns:
            List of Component objects
        """
        return [Component(c) for c in self._internal_data.components]

    @property
    def nets(self) -> list[Net]:
        """Get all nets in the project.

        Returns:
            List of Net objects
        """
        return [Net(n) for n in self._internal_data.nets]

    @property
    def variants(self) -> list[Variant]:
        """Get all variants in the project.

        Returns:
            List of Variant objects
        """
        return [Variant(v) for v in self._internal_data.variants]


# Utility functions for loading design data
from altium import ExecutionContext
from .internal import data_client as client


def load_project_data(context: ExecutionContext, input_parameters: dict) -> ProjectData:
    """Load project design data for the current execution.

    Args:
        context: Execution context for the current run.
        input_parameters: Input parameters provided for the run.

    Returns:
        Project data with components, nets, and variants.
    """
    internal_data = client.get_design_data(context, input_parameters)
    return ProjectData(internal_data)


def get_project_parameters(
        context: ExecutionContext,
        input_parameters: dict,
) -> list[Parameter]:
    """Load project parameters for the current execution.

    Args:
        context: Execution context for the current run.
        input_parameters: Input parameters provided for the run.

    Returns:
        Project parameters.
    """
    internal_params = client.get_design_parameters(context, input_parameters)
    return [Parameter(p) for p in internal_params]