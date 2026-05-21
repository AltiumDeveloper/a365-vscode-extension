from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Dict, Protocol, Any, cast


class TypeDescribable(Protocol):
    """Protocol for objects that carry a type name and a document ID.

    Implemented by all schematic design-data model classes so that they can be
    used generically wherever object identity and document membership is needed
    (e.g. when building `RelatedObject` references in violation reports).
    """

    @property
    def type_name(self) -> str:
        """Internal type identifier which must match with ObjectType from DesignData service."""
        ...

    @property
    def document_id(self) -> str:
        """Document ID to which the object belongs."""
        ...

    @property
    def unique_id(self) -> str:
        """Globally unique identifier for this object."""
        ...



@dataclass
class Parameter:
    """A name/value pair attached to a schematic design object.

    Attributes:
        name: The parameter name (e.g. 'Comment', 'Value', 'Voltage').
        value: The raw string value of the parameter.
    """

    name: str
    value: str

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Parameter':
        """Deserialises a `Parameter` from a raw JSON dictionary.

        Args:
            data: Dictionary with 'name' and 'value' keys.

        Returns:
            A populated `Parameter` instance.
        """
        return Parameter(
            name=data.get('name', ''),
            value=data.get('value', '')
        )


@dataclass
class Location:
    """2-D coordinate representing the position of a schematic object.

    Attributes:
        x: Horizontal position in schematic units.
        y: Vertical position in schematic units.
    """

    x: int
    y: int

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Location':
        """Deserialises a `Location` from a raw JSON dictionary.

        Args:
            data: Dictionary with 'x' and 'y' keys.

        Returns:
            A populated `Location` instance.
        """
        return Location(
            x=data.get('x', 0),
            y=data.get('y', 0)
        )


@dataclass
class BoundingRectangle:
    """Axis-aligned bounding box of a schematic object.

    Attributes:
        left: Left edge x-coordinate.
        bottom: Bottom edge y-coordinate.
        right: Right edge x-coordinate.
        top: Top edge y-coordinate.
    """

    left: int
    bottom: int
    right: int
    top: int

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'BoundingRectangle':
        """Deserialises a `BoundingRectangle` from a raw JSON dictionary.

        Args:
            data: Dictionary with 'left', 'bottom', 'right', and 'top' keys.

        Returns:
            A populated `BoundingRectangle` instance.
        """
        return BoundingRectangle(
            left=data.get('left', 0),
            bottom=data.get('bottom', 0),
            right=data.get('right', 0),
            top=data.get('top', 0)
        )


@dataclass
class NetDiffPair:
    """Differential pair metadata attached to a net."""

    positive_net: str = ""
    negative_net: str = ""

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'NetDiffPair':
        return NetDiffPair(
            positive_net=data.get('positiveNet', ''),
            negative_net=data.get('negativeNet', ''),
        )


@dataclass
class NetRuleAttribute:
    """A single attribute on a net rule."""

    name: str = ""
    value: str = ""

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'NetRuleAttribute':
        return NetRuleAttribute(
            name=data.get('name', ''),
            value=data.get('value', ''),
        )


@dataclass
class NetRule:
    """A rule attached to a net."""

    name: str = ""
    attributes: List[NetRuleAttribute] = field(default_factory=list)

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'NetRule':
        return NetRule(
            name=data.get('name', ''),
            attributes=[NetRuleAttribute.from_dict(attribute) for attribute in (data.get('attributes') or [])],
        )


@dataclass
class Pin:
    """A single electrical pin on a schematic component part.

    Attributes:
        unique_id: Globally unique identifier for this pin.
        name: Functional name of the pin (e.g. 'VCC', 'GND', 'D+').
        number: Pin number as shown on the component symbol.
        location: Position of the pin on the schematic.
        bounding_rectangle: Bounding box of the pin graphic.
        document_id: ID of the schematic document that contains this pin.
        variant_id: Optional identifier of the variant this pin belongs to.
        variant_name: Optional display name of the variant this pin belongs to.
    """

    unique_id: str
    name: str
    number: str
    location: Location
    bounding_rectangle: BoundingRectangle
    document_id: str
    component: Optional[Component] = None
    net: Optional[Net] = None
    variant_id: Optional[str] = None
    variant_name: Optional[str] = None
    functions: List[str] = field(default_factory=list)
    electrical_type: Optional[str] = None
    description: Optional[str] = None
    propagation_delay: Optional[float] = None
    parameters: List[Parameter] = field(default_factory=list)

    @property
    def type_name(self) -> str:
        return "Pin"

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Pin':
        """Deserialises a `Pin` from a raw JSON dictionary.

        Args:
            data: Dictionary with pin fields as returned by the DesignData service.

        Returns:
            A populated `Pin` instance.
        """
        propagation_delay = data.get('propagationDelay')
        if propagation_delay is not None:
            try:
                propagation_delay = float(propagation_delay)
            except (TypeError, ValueError):
                propagation_delay = None

        return Pin(
            unique_id=data.get('uniqueId', ''),
            name=data.get('name', ''),
            number=data.get('number', ''),
            location=Location.from_dict(data.get('location', {})),
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            document_id=data.get('documentId', ''),
            functions=list(data.get('functions') or []),
            electrical_type=data.get('electricalType'),
            description=data.get('description'),
            propagation_delay=propagation_delay,
            parameters=[Parameter.from_dict(p) for p in (data.get('parameters') or [])],
            variant_id=data.get('variantId'),
            variant_name=data.get('variantName'),
            component=data.get('component'),
            net=data.get('net'),
        )


@dataclass
class Part:
    """A single gate or section of a multi-part schematic component.

    A `Component` is composed of one or more `Part` instances, each of which
    carries its own pins, parameters, designator, and optional vault reference.

    Attributes:
        unique_id: Globally unique identifier for this part.
        logical_designator: Logical designator (e.g. 'U1A').
        physical_designator: Physical designator as placed on the PCB.
        vault_guid: GUID of the vault item, if linked to a managed library.
        item_guid: GUID of the specific library item.
        revision_guid: GUID of the library item revision.
        variant_id: Identifier of the variant this part belongs to.
        variant_name: Display name of the variant.
        variation_kind: Variation type ('Fitted', 'NotFitted', etc.).
        parameters: List of name/value parameters on this part.
        bounding_rectangle: Bounding box of this part on the schematic.
        location: Position of this part on the schematic.
        pins: List of electrical pins for this part.
        document_id: ID of the schematic document that contains this part.
    """

    unique_id: str
    logical_designator: str
    physical_designator: str
    vault_guid: Optional[str]
    item_guid: Optional[str]
    revision_guid: Optional[str]
    variant_id: Optional[str]
    variant_name: Optional[str]
    variation_kind: Optional[str]
    parameters: List[Parameter]
    bounding_rectangle: BoundingRectangle
    location: Location
    pins: List[Pin]
    document_id: str

    @property
    def type_name(self) -> str:
        return "Part"

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Part':
        """Deserialises a `Part` from a raw JSON dictionary.

        Args:
            data: Dictionary with part fields as returned by the DesignData service.

        Returns:
            A populated `Part` instance.
        """
        return Part(
            unique_id=data.get('uniqueId', ''),
            logical_designator=data.get('logicalDesignator', ''),
            physical_designator=data.get('physicalDesignator', ''),
            vault_guid=data.get('vaultGuid'),
            item_guid=data.get('itemGuid'),
            revision_guid=data.get('revisionGuid'),
            variant_id=data.get('variantId'),
            variant_name=data.get('variantName'),
            variation_kind=data.get('variationKind'),
            parameters=[Parameter.from_dict(p) for p in (data.get('parameters') or [])],
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            location=Location.from_dict(data.get('location', {})),
            pins=[Pin.from_dict(p) for p in (data.get('pins') or [])],
            document_id=data.get('documentId', ''),
        )


@dataclass
class Component:
    """A logical schematic component, potentially composed of multiple parts.

    Represents the top-level unit of a schematic symbol (e.g. an IC, resistor,
    or connector). Top-level parameters and location data are stored here;
    pin-level detail lives on each child `Part`.

    Attributes:
        unique_id: Globally unique identifier for this component.
        physical_designator: Physical designator as placed on the PCB.
        logical_designator: Logical designator as shown on the schematic (e.g. 'U1').
        parts: Individual gate/section objects that make up this component.
        parameters: Top-level component parameters (e.g. Comment, Value).
        bounding_rectangle: Bounding box of the component on the schematic.
        location: Position of the component on the schematic.
        document_id: ID of the schematic document that contains this component.
        variant_id: Optional identifier of the variant this component belongs to.
        variant_name: Optional display name of the variant.
    """

    unique_id: str
    physical_designator: str
    logical_designator: str
    parts: List[Part]
    pins: List[Pin]
    parameters: List[Parameter]
    bounding_rectangle: BoundingRectangle
    location: Location
    document_id: str
    variant_id: Optional[str] = None
    variant_name: Optional[str] = None
    comment: str = ""
    description: str = ""
    type: str = ""
    nets: List['Net'] = field(default_factory=list)

    @property
    def type_name(self) -> str:
        return "Component"

    def is_connected_to(self, net: 'Net') -> bool:
        """Check whether any pin of this component is connected to the given net.

        Args:
            net: The net to check against.

        Returns:
            True if at least one component pin appears on the net.
        """
        component_pin_ids = {pin.unique_id for pin in self.pins}
        return any(net_pin.unique_id in component_pin_ids for net_pin in net.pins)

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Component':
        """Deserialises a `Component` from a raw JSON dictionary.

        Args:
            data: Dictionary with component fields as returned by the DesignData service.

        Returns:
            A populated `Component` instance with nested `Part` objects.
        """
        parts = [Part.from_dict(p) for p in data.get('parts', [])]
        tag_types = list(data.get('tagTypes') or [])
        component_type = tag_types[0] if tag_types else ''

        return Component(
            unique_id=data.get('uniqueId', ''),
            physical_designator=data.get('physicalDesignator', ''),
            logical_designator=data.get('logicalDesignator', ''),
            parts=parts,
            pins=[pin for part in parts for pin in part.pins],
            parameters=[Parameter.from_dict(p) for p in data.get('parameters', [])],
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            location=Location.from_dict(data.get('location', {})),
            document_id=data.get('documentId', ''),
            variant_id=data.get('variantId'),
            variant_name=data.get('variantName'),
            comment=data.get('comment', ''),
            description=data.get('description', ''),
            type=component_type,
            nets=[],
        )


@dataclass
class NetItem:
    """A named port or net label attached to a schematic net.

    Attributes:
        unique_id: Globally unique identifier for this net item.
        kind: Item kind (e.g. 'Port', 'NetLabel', 'PowerSymbol').
        port_name: Display name of the port or label.
        bounding_rectangle: Bounding box of this item on the schematic.
        location: Position of this item on the schematic.
        document_id: ID of the schematic document that contains this item.
        variant_id: Optional identifier of the variant
        variant_name: Optional display name variant.
    """

    unique_id: str
    kind: str
    port_name: str
    bounding_rectangle: BoundingRectangle
    location: Location
    document_id: str
    variant_id: Optional[str]
    variant_name: Optional[str]

    @property
    def type_name(self) -> str:
        return "NetItem"

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'NetItem':
        """Deserialises a `NetItem` from a raw JSON dictionary.

        Args:
            data: Dictionary with net-item fields as returned by the DesignData service.

        Returns:
            A populated `NetItem` instance.
        """
        return NetItem(
            unique_id=data.get('uniqueId', ''),
            kind=data.get('kind', ''),
            port_name=data.get('portName', ''),
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            location=Location.from_dict(data.get('location', {})),
            document_id=data.get('documentId', ''),
            variant_id=data.get('variantId'),
            variant_name=data.get('variantName')
        )


@dataclass
class Line:
    """A wire segment that forms part of a schematic net.

    Attributes:
        unique_id: Globally unique identifier for this line segment.
        bounding_rectangle: Bounding box of the wire segment.
        location: Start position of the wire segment on the schematic.
        document_id: ID of the schematic document that contains this segment.
    """

    unique_id: str
    bounding_rectangle: BoundingRectangle
    location: Location
    document_id: str

    @property
    def type_name(self) -> str:
        return "Line"

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Line':
        """Deserialises a `Line` from a raw JSON dictionary.

        Args:
            data: Dictionary with line fields as returned by the DesignData service.

        Returns:
            A populated `Line` instance.
        """
        return Line(
            unique_id=data.get('uniqueId', ''),
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            location=Location.from_dict(data.get('location', {})),
            document_id=data.get('documentId', '')
        )


@dataclass
class Net:
    """A schematic net, grouping all electrically connected pins and wire segments.

    The `document_id` is derived at deserialisation time from the first
    `NetItem` or `Line` child, since the raw service payload does not include
    it at the net level directly.

    Attributes:
        unique_id: Globally unique identifier for this net.
        name: User-assigned net name (e.g. 'GND', 'VCC3V3').
        calculated_net_name: Net name as resolved by the ERC engine.
        color: Colour value used to highlight the net on the schematic.
        parameters: Net-level parameters (e.g. expected voltage annotations).
        bounding_rectangle: Bounding box enclosing all elements of the net.
        location: Representative position of the net on the schematic.
        pins: All component pins connected to this net.
        lines: Wire segments that make up this net.
        net_items: Port or net-label items belonging to this net.
    """

    unique_id: str
    name: str
    calculated_net_name: str
    color: int
    parameters: List[Parameter]
    bounding_rectangle: BoundingRectangle
    location: Location
    pins: List[Pin]
    lines: List[Line]
    net_items: List[NetItem]
    _document_id: str
    net_classes: List[str] = field(default_factory=list)
    diff_pair: Optional[NetDiffPair] = None
    rules: List[NetRule] = field(default_factory=list)

    @property
    def type_name(self) -> str:
        return "Net"

    @property
    def document_id(self) -> str:
        return self._document_id

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Net':
        """Deserialises a `Net` from a raw JSON dictionary.

        The document ID is inferred from the first `NetItem`, falling back to
        the first `Line`, and defaulting to an empty string if neither exists.

        Args:
            data: Dictionary with net fields as returned by the DesignData service.

        Returns:
            A populated `Net` instance with nested pins, lines, and net items.
        """
        net_items = [NetItem.from_dict(n) for n in (data.get('netItems') or [])]
        lines = [Line.from_dict(l) for l in (data.get('lines') or [])]

        document_id = net_items[0].document_id if net_items else (lines[0].document_id if lines else "")

        return Net(
            unique_id=data.get('uniqueId', ''),
            name=data.get('name', ''),
            calculated_net_name=data.get('calculatedNetName', ''),
            color=data.get('color', 0),
            parameters=[Parameter.from_dict(p) for p in (data.get('parameters') or [])],
            bounding_rectangle=BoundingRectangle.from_dict(data.get('boundingRectangle', {})),
            location=Location.from_dict(data.get('location', {})),
            pins=[Pin.from_dict(p) for p in (data.get('pins') or [])],
            lines=lines,
            net_items=net_items,
            _document_id=document_id,
            net_classes=list(data.get('netClasses') or []),
            diff_pair=NetDiffPair.from_dict(data['diffPair']) if data.get('diffPair') else None,
            rules=[NetRule.from_dict(rule) for rule in (data.get('rules') or [])],
        )


@dataclass
class CustomCheck:
    """A user-defined ERC check rule from the project configuration.

    Attributes:
        custom_check_id: Unique identifier for this custom check.
        name: Human-readable name of the check.
        error_report_level: Severity level used when reporting violations
            (e.g. 0 = no report, 1 = warning, 2 = error).
    """

    custom_check_id: str
    name: str
    error_report_level: int

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'CustomCheck':
        """Deserialises a `CustomCheck` from a raw JSON dictionary.

        Args:
            data: Dictionary with 'customCheckId', 'name', and 'errorReportLevel' keys.

        Returns:
            A populated `CustomCheck` instance.
        """
        return CustomCheck(
            custom_check_id=data.get('customCheckId', ''),
            name=data.get('name', ''),
            error_report_level=data.get('errorReportLevel', 0)
        )


@dataclass
class Variant:
    """A variant defined in the Altium project.

    Attributes:
        name: Display name of the variant (e.g. 'Production', 'Prototype').
        variant_guid: GUID that uniquely identifies this variant in the project.
    """

    name: str
    variant_guid: str

    @property
    def type_name(self) -> str:
        return "Variant"

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Variant':
        """Deserialises a `Variant` from a raw JSON dictionary.

        Args:
            data: Dictionary with 'name' and 'variantGuid' keys.

        Returns:
            A populated `Variant` instance.
        """
        return Variant(
            name=data.get('name', ''),
            variant_guid=data.get('variantGuid', '')
        )


@dataclass
class Configuration:
    """Project-level ERC configuration loaded from the service.

    Attributes:
        custom_checks: List of user-defined ERC check rules active for the project.
    """

    custom_checks: List[CustomCheck]

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Configuration':
        """Deserialises a `Configuration` from a raw JSON dictionary.

        Args:
            data: Dictionary with a 'customChecks' list as returned by the DesignData service.

        Returns:
            A populated `Configuration` instance.
        """
        return Configuration(
            custom_checks=[CustomCheck.from_dict(c) for c in data.get('customChecks', [])]
        )


@dataclass
class ProjectData:  
    """Complete design data snapshot for an Altium project.

    This is the top-level object produced by deserialising the DesignData
    service response. All ERC checks operate against an instance of this class.

    Attributes:
        components: All schematic components in the project.
        nets: All schematic nets in the project.
        variants: Design variants defined in the project.
        configuration: Project ERC configuration (custom checks, etc.).
    """

    components: List[Component]
    nets: List[Net]
    variants: List[Variant]
    configuration: Configuration

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'ProjectData':
        """Deserialises a `ProjectData` from a raw JSON dictionary.

        Args:
            data: Top-level dictionary as returned by the DesignData service,
                containing 'components', 'nets', 'variants', and 'configuration'.

        Returns:
            A fully populated `ProjectData` instance.
        """
        project_data = ProjectData(
            components=[Component.from_dict(c) for c in data.get('components', [])],
            nets=[Net.from_dict(n) for n in data.get('nets', [])],
            variants=[Variant.from_dict(v) for v in data.get('variants', [])],
            configuration=Configuration.from_dict(data.get('configuration', {}))
        )

        
        # Link each component pin to its owner and net based on pin unique_id.
        pin_to_component: Dict[str, Component] = {}
        for component in project_data.components:
            component.pins = [pin for part in component.parts for pin in part.pins]
            for part in component.parts:
                for pin in part.pins:
                    pin.component = component
                    pin_to_component[pin.unique_id] = component

        pin_to_net: Dict[str, Net] = {}
        for net in project_data.nets:
            for pin in net.pins:
                pin.component = pin_to_component.get(pin.unique_id)
                pin.net = net
                pin_to_net[pin.unique_id] = net

        for component in project_data.components:
            for part in component.parts:
                for pin in part.pins:
                    pin.net = pin_to_net.get(pin.unique_id)

        # Derive connected nets per component from linked part pins.
        for component in project_data.components:
            component_nets: List[Net] = []
            seen_net_ids: set[str] = set()
            for part in component.parts:
                for pin in part.pins:
                    if pin.net is None or pin.net.unique_id in seen_net_ids:
                        continue
                    seen_net_ids.add(pin.net.unique_id)
                    component_nets.append(pin.net)
            component.nets = component_nets

        return project_data


@dataclass
class RelatedObject:
    """A lightweight reference to a design object used inside violation reports.

    Carries the minimal set of fields needed to identify and locate a design
    object (component, pin, net, etc.) without embedding the full object graph.

    Attributes:
        uniqueId: Unique identifier of the referenced object.
        name: Human-readable name (e.g. designator, net name, pin name).
        designator: Designator or secondary label for the object.
        type: Type discriminator string matching the `type_name` of the source object.
        documentId: ID of the schematic document that contains this object.
        location: Optional position on the schematic.
        boundingRectangle: Optional bounding box on the schematic.
        variantId: Optional identifier of the variant this object belongs to.
        variantName: Optional display name of the variant.
    """

    uniqueId: str
    name: str
    designator: str
    type: str
    documentId: str
    location: Optional[Location] = None
    boundingRectangle: Optional[BoundingRectangle] = None
    variantId: Optional[str] = None
    variantName: Optional[str] = None

    @staticmethod
    def from_typeable(obj: TypeDescribable) -> 'RelatedObject':
        """Constructs a `RelatedObject` from any `TypeDescribable` design object.

        Extracts the appropriate name and designator fields based on the
        concrete type of `obj` (Component, Part, Net, Pin, Line, NetItem, or
        Variant).

        Args:
            obj: Any design-data object that implements the `TypeDescribable` protocol.

        Returns:
            A `RelatedObject` populated from the fields of `obj`.
        """
        # Determine name and designator based on type
        name = ""
        designator = ""

        if isinstance(obj, Component):
            name = obj.logical_designator
            designator = obj.logical_designator
        elif isinstance(obj, Part):
            name = obj.logical_designator
            designator = obj.physical_designator
        elif isinstance(obj, Net):
            name = obj.name
            designator = obj.calculated_net_name
        elif isinstance(obj, Line):
            name = obj.unique_id
            designator = obj.unique_id
        elif isinstance(obj, Pin):
            name = obj.name
            designator = obj.number
        elif isinstance(obj, NetItem):
            name = obj.port_name
            designator = obj.port_name
        elif isinstance(obj, Variant):
            return RelatedObject(
                uniqueId=obj.variant_guid,
                name=obj.name,
                designator=obj.name,
                type=obj.type_name,
                documentId="",
                location=None,
                boundingRectangle=None,
                variantId=obj.variant_guid,
                variantName=obj.name
            )

        return RelatedObject(
            uniqueId=obj.unique_id,
            name=name,
            designator=designator,
            type=obj.type_name,
            documentId=obj.document_id,
            location=getattr(obj, 'location', None),
            boundingRectangle=getattr(obj, 'bounding_rectangle', None),
            variantId=getattr(obj, 'variant_id', None),
            variantName=getattr(obj, 'variant_name', None)
        )


@dataclass
class Violation:
    """A single ERC violation to be reported for a schematic document.

    Groups all objects related to one specific error message under a shared
    document ID, forming the payload serialised into the final ERC result.

    Attributes:
        documentId: ID of the schematic document where the violation occurs.
        description: Short human-readable description of the violation.
        errorText: Full error message text (may equal `description`).
        relatedObjects: Design objects implicated in this violation.
    """

    documentId: str
    description: str
    errorText: str
    relatedObjects: List[RelatedObject]


@dataclass
class ViolationEntry:
    """An intermediate per-object violation record accumulated during ERC checks.

    Multiple `ViolationEntry` instances with the same `errorText` in the same
    document are merged into a single `Violation` by `ValidationResult.to_result`.

    Attributes:
        description: Human-readable description of this entry.
        errorText: Error message text; used as the grouping key when producing
            `Violation` objects.
        relatedObject: The specific design object that triggered this entry.
    """

    description: str
    errorText: str
    relatedObject: RelatedObject

    @staticmethod
    def create(violation_reason: str, relatedObject: RelatedObject) -> 'ViolationEntry':
        """Convenience factory that creates a `ViolationEntry` with identical
        description and errorText.

        Args:
            violation_reason: The human-readable violation message.
            relatedObject: The design object implicated in the violation.

        Returns:
            A new `ViolationEntry` with both text fields set to `violation_reason`.
        """
        return ViolationEntry(
            description=violation_reason,
            errorText=violation_reason,
            relatedObject=relatedObject
        )


@dataclass
class ValidationResult:
    """Accumulator for ERC violations collected during a validation run.

    Stores entries keyed by document ID; call `to_result` when all checks are
    complete to obtain the JSON-serialisable output expected by the caller.

    Attributes:
        violations_dict: Mapping from document ID to the list of
            `ViolationEntry` objects recorded for that document.
    """

    violations_dict: Dict[str, List[ViolationEntry]] = field(default_factory=dict)

    def add_violation(self, violation_reason: str, obj: TypeDescribable) -> None:
        """Records a violation against a design object.

        Creates a `ViolationEntry` from `violation_reason` and `obj`, and
        appends it to the list for `obj`'s document ID.

        Args:
            violation_reason: Human-readable message describing the violation.
            obj: The design object that triggered the violation; must implement
                `TypeDescribable` so that its document ID and type can be resolved.
        """
        self.violations_dict.setdefault(obj.document_id, []).append(
            ViolationEntry.create(violation_reason, RelatedObject.from_typeable(obj))
        )

    def to_result(self) -> Dict[str, str]:
        """Serialises all accumulated violations into the output dictionary.

        Entries with the same `errorText` within the same document are merged
        into a single `Violation` with multiple `relatedObjects`.

        Returns:
            A dictionary with a single 'violations' key whose value is a
            JSON string containing the list of serialised `Violation` objects.
        """

        violations = []
        for doc_id, entries in self.violations_dict.items():
            grouped: Dict[str, List[RelatedObject]] = {}
            for entry in entries:
                grouped.setdefault(entry.errorText, []).append(entry.relatedObject)

            for error_text, related_objects in grouped.items():
                violations.append(Violation(
                    documentId=doc_id,
                    description=error_text,
                    errorText=error_text,
                    relatedObjects=related_objects
                ))
        return {
            "violations": json.dumps([asdict(cast(Any, v)) for v in violations]),
        }