"""Source-provenance and coverage-contract helpers."""

from worker.ai.generation.coverage import COVERAGE_CONTRACT
from worker.ai.service import _part_label, _source_reference


def test_source_reference_single_material_carries_revision() -> None:
    source = {"type": "MATERIAL", "id": "mat-1"}
    materials = [{"id": "mat-1", "revision": 3}]
    ref = _source_reference(source, materials)
    assert ref["revision"] == 3
    assert ref["revisions"] == {"mat-1": 3}


def test_source_reference_multi_material_has_no_scalar_revision() -> None:
    source = {"type": "TOPIC", "id": "topic-1"}
    materials = [{"id": "mat-1", "revision": 2}, {"id": "mat-2", "revision": 5}]
    ref = _source_reference(source, materials)
    assert "revision" not in ref
    assert ref["revisions"] == {"mat-1": 2, "mat-2": 5}


def test_part_label_appends_coverage_contract_and_part_suffix() -> None:
    label = _part_label("material: x (academic scope: s)", ["a", "b"], 0)
    assert "part 1 of 2" in label
    assert COVERAGE_CONTRACT in label


def test_part_label_can_opt_out_of_coverage() -> None:
    label = _part_label("material: x", ["a"], 0, coverage=False)
    assert COVERAGE_CONTRACT not in label
