"""A fresh, non-AI Harunobu process for one exact original file."""
from __future__ import annotations

import argparse
from collections import Counter
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--memory-mib", type=int)
    args = parser.parse_args()
    if args.memory_mib is not None:
        if args.memory_mib < 128:
            parser.error("memory limit must be at least 128 MiB")
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (args.memory_mib * 1024**2,) * 2)
    os.environ["HARUNOBU_AI_DISABLED"] = "1"
    with tempfile.TemporaryDirectory(prefix="harunobu-metadata-") as directory:
        root = Path(directory)
        meta = root / "harunobu-0.2.2.dist-info"
        meta.mkdir()
        (meta / "METADATA").write_text("Metadata-Version: 2.1\nName: harunobu\nVersion: 0.2.2\n")
        sys.path[:0] = [str(root), str(args.engine)]
        from harunobu import Config, analyze
        from harunobu.core.scorer import LevelScorer
        from harunobu.output.json_writer import to_dict
        result = analyze(args.input, Config(mode="thorough", strict=True))
        scorer = LevelScorer()
        counts = {}
        sheet_scores = []
        for sheet in result.sheets:
            scores = scorer.score_sheet_result(sheet)
            sheet_scores.append({"sheet": sheet.sheet_meta.name, "tables": len(sheet.tables), "level_scoring": scores.model_dump(mode="json")})
            for table in sheet.tables:
                for level in (1, 2, 3):
                    for key, check in getattr(table.mr_result, f"level{level}").items():
                        bucket = counts.setdefault(key, Counter())
                        state = "skipped" if check.confidence == 0 else "passed" if check.passed else "failed"
                        bucket[state] += 1
        scoring = scorer.score_analysis(result)
        summary = {"scores": {str(i): scoring.get(i).score for i in (1, 2, 3)},
                   "level_scoring": scoring.model_dump(mode="json"), "rule_counts": counts,
                   "sheets": sheet_scores, "no_tables_detected": not any(s.tables for s in result.sheets),
                   "dependencies": {n: importlib.metadata.version(n) for n in ["openpyxl", "pydantic", "PyYAML"]}}
        args.output.write_text(json.dumps({"summary": summary, "official": to_dict(result, include_original_description=True)}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
