"""
ERC utility functions for Altium API.
"""
from __future__ import annotations

from enum import Enum

from .internal import erc_utils as internal_erc
from .design_data import Component, Net


class ComponentClassification(Enum):
    """Functional classification of a schematic component."""

    TVS_ESD = "tvs_esd"
    CONNECTOR = "connector"
    CMC = "cmc"
    RESISTOR = "resistor"
    CAPACITOR = "capacitor"
    IC = "ic"
    DIODE = "diode"

    @classmethod
    def _missing_(cls, value):
        return None

# Deprecated typo alias — kept for backward compatibility, hidden from docs
ComponetClassifaction = ComponentClassification
ComponetClassifaction.__doc__ = (ComponetClassifaction.__doc__ or "") + "\n\n@private"


# Re-export constants
GROUND_NET_NAMES = internal_erc.GROUND_NET_NAMES
CHASSIS_NET_NAMES = internal_erc.CHASSIS_NET_NAMES
CONNECTOR_COMMENT_KEYWORDS = internal_erc.CONNECTOR_COMMENT_KEYWORDS
BOARD_TO_BOARD_KEYWORDS = internal_erc.BOARD_TO_BOARD_KEYWORDS
MOUNTING_HOLE_KEYWORDS = internal_erc.MOUNTING_HOLE_KEYWORDS
MOUNTING_HOLE_DESIGNATOR_PREFIXES = internal_erc.MOUNTING_HOLE_DESIGNATOR_PREFIXES
CAPACITOR_COMMENT_KEYWORDS = internal_erc.CAPACITOR_COMMENT_KEYWORDS
CAPACITOR_DESIGNATOR_PREFIXES = internal_erc.CAPACITOR_DESIGNATOR_PREFIXES
CONNECTOR_DESIGNATOR_PREFIXES = internal_erc.CONNECTOR_DESIGNATOR_PREFIXES
TVS_ESD_COMMENT_KEYWORDS = internal_erc.TVS_ESD_COMMENT_KEYWORDS
TVS_ESD_DESIGNATOR_PREFIXES = internal_erc.TVS_ESD_DESIGNATOR_PREFIXES
IC_DESIGNATOR_PREFIXES = internal_erc.IC_DESIGNATOR_PREFIXES
RESISTOR_COMMENT_KEYWORDS = internal_erc.RESISTOR_COMMENT_KEYWORDS
RESISTOR_DESIGNATOR_PREFIXES = internal_erc.RESISTOR_DESIGNATOR_PREFIXES
CMC_COMMENT_KEYWORDS = internal_erc.CMC_COMMENT_KEYWORDS
CMC_DESIGNATOR_PREFIXES = internal_erc.CMC_DESIGNATOR_PREFIXES
DIFF_PAIR_SUFFIXES = internal_erc.DIFF_PAIR_SUFFIXES
DEFAULT_CAPACITANCE_LIMITS = internal_erc.DEFAULT_CAPACITANCE_LIMITS
USB_NET_PATTERN = internal_erc.USB_NET_PATTERN



def classify_component(component: Component) -> ComponentClassification | None:
    """Classify a component into a known functional category.

    Args:
        component: The component to classify.

    Returns:
        A `ComponentClassification` value, or `None` if no category could be determined.
    """
    result = internal_erc.classify_component(component._internal_component)
    if result is None:
        return None
    return ComponentClassification(result)


def classify_interface(net_name: str) -> str:
    """Infers the signal interface type from a net name.

    Args:
        net_name: The name of the net.

    Returns:
        A lowercase interface type string: 'usb', 'hdmi', 'ethernet', 'can',
        or 'default' if no known interface is recognised.
    """
    return internal_erc.guess_interface_type(net_name)


def collect_component_pin_ids(component: Component) -> set[str]:
    """Returns the set of unique pin IDs belonging to a component.

    Args:
        component: A component object.

    Returns:
        Set of unique pin ID strings across all component parts.
    """
    return internal_erc.collect_component_pin_ids(component._internal_component)


def find_diff_pair_partner_name(net_name: str) -> str | None:
    """Returns the complementary net name for a differential pair signal.

    Args:
        net_name: The name of one net in a differential pair (e.g. "USB_DP").

    Returns:
        The partner net name (e.g. "USB_DN"), or None if the net name does not
        match a recognised differential pair pattern.
    """
    return internal_erc.find_diff_pair_partner_name(net_name)


def get_default_capacitance_limit(net: Net) -> float:
    """Returns the default TVS capacitance limit for the given net.

    Args:
        net: The net to evaluate.

    Returns:
        Capacitance limit in pF for the inferred interface type.
    """
    return internal_erc.get_default_capacitance_limit(net.name)


def get_param_value(component: Component, aliases: str | list[str]) -> str | None:
    """Returns the raw string value of the first matching parameter on a component.

    Args:
        component: A component object with parameters.
        aliases: A parameter alias string or list of alias strings to search for
            (case-insensitive).

    Returns:
        The stripped string value of the first matching parameter, or None if not found.
    """
    normalized_aliases = [aliases] if isinstance(aliases, str) else aliases
    return internal_erc.get_param_value(component._internal_component, normalized_aliases)


def is_connected_to_net(component: Component, net: Net) -> bool:
    """Checks whether a component is connected to a given net.

    Args:
        component: The component to evaluate.
        net: The target net.

    Returns:
        True if at least one component-connected net matches the target net,
        otherwise False.
    """
    return internal_erc.is_connected_to_net(component._internal_component, net._internal_net)


def is_board_to_board_or_mounting(component: Component) -> bool:
    """Determines whether a component is a board-to-board connector or a mounting hole.

    Args:
        component: A component object.

    Returns:
        True if the component is identified as a board-to-board connector or
        mounting hole, False otherwise.
    """
    return internal_erc.is_board_to_board_or_mounting(component._internal_component)


def is_chassis_net(net: Net) -> bool:
    """Determines whether a net is a chassis or shield ground net based on its name.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known chassis net name (e.g. CHASSIS,
        SHIELD, GND_CHASSIS), False otherwise.
    """
    return net._internal_net.name.strip().upper() in CHASSIS_NET_NAMES


def is_ground_net(net: Net) -> bool:
    """Determines whether a net is a ground net based on its name.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known ground net name (e.g. GND, AGND,
        PGND, CHASSIS, SGND, VSS, GND_CHASSIS, SHIELD), False otherwise.
    """
    return internal_erc.is_ground_net(net._internal_net)


def is_power_net(net: Net) -> bool:
    """Determines whether a net is a power supply net based on its name.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known power net pattern (e.g. VCC, VDD,
        3V3, 5V0, VBUS), False otherwise.
    """
    return internal_erc.is_power_net(net._internal_net)


def is_usb_net(net: Net) -> bool:
    """Determines whether a net is a USB data net based on its name.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known USB data net pattern, False otherwise.
    """
    return internal_erc.is_usb_net(net._internal_net)


def parse_param_float(component: Component, aliases: list[str]) -> float | None:
    """Returns the float value of the first matching parameter on a component.

    Args:
        component: A component object with parameters.
        aliases: A list of parameter name strings to search for (case-insensitive).

    Returns:
        The parsed float value, or None if the parameter is missing or unparseable.
    """
    return internal_erc.parse_param_float(component._internal_component, aliases)


def try_get_net_voltage(net: Net) -> float:
    """Attempts to determine the operating voltage of a net.

    Args:
        net: The net whose voltage is to be determined.

    Returns:
        The operating voltage as a float, or 0 if it cannot be determined.
    """
    return internal_erc.try_get_net_voltage(net._internal_net)


def try_parse_voltage(value: str) -> float | None:
    """Attempts to parse a numeric string with optional SI suffix into a float.

    Args:
        value: A string representing a numeric value with optional unit suffix.

    Returns:
        The parsed float value, or None if parsing fails or input is empty.
    """
    return internal_erc.try_parse_voltage(value)
