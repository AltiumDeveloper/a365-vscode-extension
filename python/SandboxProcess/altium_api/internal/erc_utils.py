import re
from .data_models import Net, Component
from typing import List, Optional, Set

GROUND_NET_NAMES = {"GND", "AGND", "PGND", "CHASSIS", "SGND", "VSS", "GND_CHASSIS", "SHIELD"}
CHASSIS_NET_NAMES = {"CHASSIS", "SHIELD", "GND_CHASSIS"}
CONNECTOR_COMMENT_KEYWORDS = ["connector", "header", "jack", "plug", "socket", "terminal", "usb", "rj45", "hdmi", "receptacle"]
BOARD_TO_BOARD_KEYWORDS = ["board-to-board", "board to board", "b2b", "btb", "mezzanine", "stacking",
                           "df12", "df40", "df30", "df17", "df9", "df11", "df13",
                           "slimstack", "fpc", "ffc"]
MOUNTING_HOLE_KEYWORDS = ["mounting", "standoff", "spacer", "pth-m", "screw"]
MOUNTING_HOLE_DESIGNATOR_PREFIXES = ("PTH", "MH")
CAPACITOR_COMMENT_KEYWORDS = ["capacitor", "cap", "bypass", "decoupling", "decoupler", "filter"]
CAPACITOR_DESIGNATOR_PREFIXES = ("C",)
CONNECTOR_DESIGNATOR_PREFIXES = ("J", "P", "X", "CN")
TVS_ESD_COMMENT_KEYWORDS = ["tvs", "esd", "varistor", "suppressor", "transient", "protection diode", "tpd", "pesd", "cdsot", "smda", "sp05", "usblc", "prtr", "ip4"]
TVS_ESD_DESIGNATOR_PREFIXES = ("TVS", "Z", "RV")
IC_DESIGNATOR_PREFIXES = ("U", "IC")
RESISTOR_COMMENT_KEYWORDS = ["resistor"]
RESISTOR_DESIGNATOR_PREFIXES = ("R",)
CMC_COMMENT_KEYWORDS = ["common mode", "cmc", "choke"]
CMC_DESIGNATOR_PREFIXES = ("L", "FL", "CM")

DIFF_PAIR_SUFFIXES = (("_P", "_N"), ("_DP", "_DN"), ("+", "-"), ("_PLUS", "_MINUS"), ("P", "N"))
DEFAULT_CAPACITANCE_LIMITS = {
    "usb":      1.0,
    "hdmi":     0.5,
    "ethernet": 5.0,
    "can":     15.0,
    "default":  5.0,
}

USB_NET_PATTERN = re.compile(
    r'(?i)(USB.*[DP][+\-NP]|USB_[NP]|USB_D[+\-NP]|D[+\-].*USB|USB.*DATA)',
)


def is_usb_net(net: Net) -> bool:
    """Determines whether a net is a USB data net based on its name.

    Matches against `USB_NET_PATTERN`, which recognises common USB data-line
    naming conventions such as 'USB_DP', 'USB_DN', 'D+', 'USB_DATA', etc.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known USB data net pattern, False otherwise.
    """
    return bool(USB_NET_PATTERN.search(net.name))

def is_capacitor(c: Component) -> bool:
    """Determines whether a component is classified as a capacitor.

    Delegates to `classify_component` and checks for the 'capacitor' category.

    Args:
        c: The component to evaluate.

    Returns:
        True if the component is classified as a capacitor, False otherwise.
    """
    return "capacitor" == classify_component(c)

def is_power_net(net: Net) -> bool:
    """Determines whether a net is a power supply net based on its name.

    Matches against a fixed set of exact names (e.g. 3V3, 5V0) and common
    prefixes (e.g. VCC, VDD), as well as names ending in a digit followed by 'V'.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known power net pattern, False otherwise.
    """
    start_with_aliases = ["VCC", "VDD", "PWR", "VBAT", "VBUS"]
    exact_match_aliases = ["3V3", "5V0", "1V8"]

    net_name = net.name.strip().upper()
    if net_name in exact_match_aliases:
        return True

    if any(net_name.startswith(alias) for alias in start_with_aliases):
        return True

    # if ends with V and is preceded with digit
    if re.search(r'\dV$', net_name, re.IGNORECASE):
        return True

    return False


def try_parse_voltage(value: str) -> Optional[float]:
    """Attempts to parse a numeric string with optional SI suffix into a float.

    Handles common formats such as '3.3', '3V3', '3.3V', '+5V', '2.2k', '-1.5M', etc.
    Leading sign characters and trailing 'V'/'v' suffixes are stripped.
    The 'NVN' notation (e.g. '3V3') is converted to decimal (e.g. '3.3').
    Recognises SI multiplier suffixes: p (pico), n (nano), u (micro),
    m (milli), k/K (kilo), M (mega).

    Args:
        value: A string representing a numeric value with optional unit suffix.

    Returns:
        The parsed float value, or None if parsing fails or input is empty.
    """
    SI_SUFFIXES = {'p': 1e-12, 'n': 1e-9, 'u': 1e-6, 'm': 1e-3, 'k': 1e3, 'K': 1e3, 'M': 1e6}

    if not value:
        return None
    v = value.strip()
    
    # Extract and preserve the sign
    sign = 1
    if v and v[0] in '+-':
        if v[0] == '-':
            sign = -1
        v = v[1:].lstrip('+-')
    
    if re.match(r'^\d+V\d+$', v, re.IGNORECASE):
        v = v.upper().replace('V', '.')
    else:
        v = v.rstrip('Vv')

    multiplier = 1
    if v and v[-1] in SI_SUFFIXES:
        multiplier = SI_SUFFIXES[v[-1]]
        v = v[:-1]

    try:
        result = sign * float(v) * multiplier
        # Round to avoid floating-point precision artifacts
        return round(result, 12)
    except ValueError:
        return None


def try_get_net_voltage(net: Net) -> float:
    """Attempts to determine the operating voltage of a net.

    First tries to extract a voltage from the net name itself (e.g. 'VCC3V3' -> 3.3).
    If that fails, falls back to inspecting net parameters for a 'Voltage' or
    'ExpectedVoltage' key in bracket notation (e.g. '[Voltage = 3.3V]').

    Args:
        net: The net whose voltage is to be determined.

    Returns:
        The operating voltage as a float, or 0 if it cannot be determined.
    """
    net_voltage_aliases = ["Voltage", "ExpectedVoltage"]
    start_with_aliases = ["VCC", "VDD", "PWR", "VBAT", "VBUS"]

    voltage_value = 0

    # try get from name
    match_from_name = next((alias for alias in start_with_aliases if net.name.strip().upper().startswith(alias)), None)
    if match_from_name:
        remaining = net.name.strip()[len(match_from_name):]
        numeric_match = re.match(r'^[\d]*V?[\d]*', remaining, re.IGNORECASE)
        if numeric_match and numeric_match.group():
            parsed = try_parse_voltage(numeric_match.group())
            if parsed is not None:
                voltage_value = parsed

        if voltage_value != 0:
            return voltage_value

    # fallback to parameters
    for netParam in net.parameters:
        value = netParam.value.strip()

        if any(v.lower() in value.lower() for v in net_voltage_aliases):

            match = (
                re.search(r'\[Voltage\s*=\s*([^\]]+)\]', value)
                or re.search(r'\[ExpectedVoltage\s*=\s*([^\]]+)\]', value)
            )
            if not match:
                return voltage_value

            parsed = try_parse_voltage(match.group(1).strip())
            return parsed if parsed is not None else voltage_value
    
    return voltage_value


def get_component_comment(c: Component) -> str:
    """Returns the lowercase 'Comment' parameter value of a component.

    Searches top-level component parameters first, then falls back to
    checking parameters on individual parts.

    Args:
        c: A component object with `parameters` and `parts` attributes.

    Returns:
        The comment string in lowercase, or an empty string if not found.
    """
    for p in c.parameters:
        if p.name.strip().lower() == "comment":
            return p.value.strip().lower()
    for part in c.parts:
        for p in part.parameters:
            if p.name.strip().lower() == "comment":
                return p.value.strip().lower()
    return ""


def get_component_description(c: Component) -> str:
    """Returns the lowercase 'Description' parameter value of a component.

    Searches top-level component parameters first, then falls back to
    checking parameters on individual parts.

    Args:
        c: A component object with `parameters` and `parts` attributes.

    Returns:
        The description string in lowercase, or an empty string if not found.
    """
    for p in c.parameters:
        if p.name.strip().lower() == "description":
            return p.value.strip().lower()
    for part in c.parts:
        for p in part.parameters:
            if p.name.strip().lower() == "description":
                return p.value.strip().lower()
    return ""


def get_param_value(c: Component, aliases: List[str]) -> Optional[str]:
    """Returns the raw string value of the first matching parameter on a component.

    Performs a case-insensitive search against a list of parameter name aliases.
    Checks top-level component parameters first, then part-level parameters.

    Args:
        c: A component object with `parameters` and `parts` attributes.
        aliases: A list of parameter name strings to search for (case-insensitive).

    Returns:
        The stripped string value of the first matching parameter, or None if not found.
    """
    lower_aliases = [a.lower() for a in aliases]
    for p in c.parameters:
        if p.name.strip().lower() in lower_aliases:
            return p.value.strip()
    for part in c.parts:
        for p in part.parameters:
            if p.name.strip().lower() in lower_aliases:
                return p.value.strip()
    return None


def parse_param_float(c: Component, aliases: List[str]) -> Optional[float]:
    """Returns the float value of the first matching parameter on a component.

    Convenience wrapper around `get_param_value` and `try_parse_voltage`.

    Args:
        c: A component object with `parameters` and `parts` attributes.
        aliases: A list of parameter name strings to search for (case-insensitive).

    Returns:
        The parsed float value, or None if the parameter is missing or unparseable.
    """
    raw = get_param_value(c, aliases)
    if raw is None:
        return None
    return try_parse_voltage(raw)


def is_board_to_board_or_mounting(c: Component) -> bool:
    """Determines whether a component is a board-to-board connector or a mounting hole.

    Checks the component's comment, description, and designator against known
    keyword lists for board-to-board connectors, mounting holes, and standoffs.
    These components are excluded from ESD protection checks as they are not
    considered externally exposed signal interfaces.

    Args:
        c: A component object with `parameters`, `parts`, `logical_designator`,
           and `physical_designator` attributes.

    Returns:
        True if the component is identified as a board-to-board connector or
        mounting hole, False otherwise.
    """
    comment = get_component_comment(c)
    desc = get_component_description(c)
    desig = (c.logical_designator or c.physical_designator or "").strip().upper()
    combined = comment + " " + desc
    if any(kw in combined for kw in BOARD_TO_BOARD_KEYWORDS):
        return True
    if any(kw in combined for kw in MOUNTING_HOLE_KEYWORDS):
        return True
    if desig.startswith(MOUNTING_HOLE_DESIGNATOR_PREFIXES):
        return True
    return False


def classify_component(c: Component) -> Optional[str]:
    """Classifies a component into a known functional category.

    Uses the component's Comment parameter and designator prefix to determine
    its type. Classification priority (highest to lowest):
    tvs_esd > connector > cmc > resistor > capacitor > ic > diode.

    Args:
        c: A component object with `parameters`, `parts`, `logical_designator`,
           and `physical_designator` attributes.

    Returns:
        A string category label ('tvs_esd', 'connector', 'cmc', 'resistor',
        'capacitor', 'ic', 'diode'), or None if no category could be determined.
    """
    comment = get_component_comment(c)
    desig = (c.logical_designator or c.physical_designator or "").strip().upper()

    if any(kw in comment for kw in TVS_ESD_COMMENT_KEYWORDS):
        return "tvs_esd"
    if desig.startswith(TVS_ESD_DESIGNATOR_PREFIXES):
        return "tvs_esd"

    if any(kw in comment for kw in CONNECTOR_COMMENT_KEYWORDS):
        return "connector"
    if desig.startswith(CONNECTOR_DESIGNATOR_PREFIXES):
        return "connector"

    if any(kw in comment for kw in CMC_COMMENT_KEYWORDS):
        return "cmc"
    if desig.startswith(CMC_DESIGNATOR_PREFIXES):
        return "cmc"

    if any(kw in comment for kw in RESISTOR_COMMENT_KEYWORDS):
        return "resistor"
    if desig.startswith(RESISTOR_DESIGNATOR_PREFIXES):
        return "resistor"

    if any(kw in comment for kw in CAPACITOR_COMMENT_KEYWORDS):
        return "capacitor"
    if desig.startswith(CAPACITOR_DESIGNATOR_PREFIXES):
        return "capacitor"

    if desig.startswith(IC_DESIGNATOR_PREFIXES):
        return "ic"

    desc = get_component_description(c)
    if "diode" in desc.lower():
        return "diode"

    return None


def is_ground_net(net: Net) -> bool:
    """Determines whether a net is a ground net based on its name.

    Args:
        net: The net to evaluate.

    Returns:
        True if the net name matches a known ground net name (e.g. GND, AGND,
        PGND, CHASSIS, SGND, VSS, GND_CHASSIS, SHIELD), False otherwise.
    """
    return net.name.strip().upper() in GROUND_NET_NAMES


def collect_component_pin_ids(c: Component) -> Set[str]:
    """Collects all design pin IDs belonging to a component across all its parts.

    Args:
        c: A component object with a `parts` attribute, where each part has a
           `pins` attribute containing pin objects with a `design_pin_id` field.

    Returns:
        A set of pin design_pin_id strings for all pins of the component.
    """
    pin_ids = set()
    for part in c.parts:
        for pin in part.pins:
            pin_ids.add(pin.design_pin_id)
    return pin_ids


def is_connected_to_net(component: Component, net: Net) -> bool:
    """Checks whether a component is connected to a given net.

    Args:
        component: The component to evaluate.
        net: The target net.

    Returns:
        True if at least one component-connected net matches the target net,
        otherwise False.
    """
    target_net_id = net.design_net_id
    if target_net_id:
        return any(component_net.design_net_id == target_net_id for component_net in component.nets)

    target_net_name = (net.name or "").strip()
    return any((component_net.name or "").strip() == target_net_name for component_net in component.nets)


def guess_interface_type(net_name: str) -> str:
    """Infers the signal interface type from a net name.

    Used to select the appropriate TVS junction capacitance limit for a net.
    Recognises USB, HDMI, Ethernet (ETH/MDIO/MII), and CAN by substring matching.

    Args:
        net_name: The name of the net.

    Returns:
        A lowercase interface type string: 'usb', 'hdmi', 'ethernet', 'can',
        or 'default' if no known interface is recognised.
    """
    upper = net_name.upper()
    if "USB" in upper:
        return "usb"
    if "HDMI" in upper:
        return "hdmi"
    if "ETH" in upper or "MDIO" in upper or "MII" in upper:
        return "ethernet"
    if "CAN" in upper:
        return "can"
    return "default"


def get_default_capacitance_limit(net_name: str) -> float:
    """Returns the default TVS junction capacitance limit for a net name.

    Args:
        net_name: The name of the net.

    Returns:
        Capacitance limit in pF for the inferred interface type.
    """
    interface_type = guess_interface_type(net_name)
    return DEFAULT_CAPACITANCE_LIMITS.get(
        interface_type,
        DEFAULT_CAPACITANCE_LIMITS["default"],
    )


def find_diff_pair_partner_name(net_name: str) -> Optional[str]:
    """Finds the complementary net name of a differential pair signal.

    Checks the net name against known positive/negative suffix pairs (e.g.
    '_P'/'_N', '_DP'/'_DN', '+'/'−', 'P'/'N') and returns the name with the
    opposite suffix.

    Args:
        net_name: The name of one side of a differential pair net.

    Returns:
        The inferred partner net name, or None if the net name does not match
        any known differential-pair suffix pattern.
    """
    upper = net_name.upper()
    for pos_suffix, neg_suffix in DIFF_PAIR_SUFFIXES:
        if upper.endswith(pos_suffix.upper()):
            base = net_name[: len(net_name) - len(pos_suffix)]
            return base + neg_suffix
        if upper.endswith(neg_suffix.upper()):
            base = net_name[: len(net_name) - len(neg_suffix)]
            return base + pos_suffix
    return None
