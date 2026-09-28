# Sudoku

Read docs/SPEC.md and docs/CONTRACT.md before editing. Vanilla JS ES modules; production has no build step. Keep game logic DOM/network independent. Japanese UI, iPhone first.

Only naked singles from legal candidates minus explicit exclusions may auto-fill. Never hidden singles. Auto-display OFF does not change effective candidates. DEL/clearNotes do not auto-fill. One input plus all auto-fill belongs to one Undo transaction. Wrong entries are allowed. Do not use solution in the playing client.

Do not publish credentials, spreadsheet IDs, script IDs, Drive folder IDs or local configuration. Store these in ignored .local or Script Properties. GAS public API is read-only with explicit action whitelist.

Run npm test, full puzzle validation and relevant browser checks before release. Keep local, GAS deployment, Pages publication and physical iPhone verification as distinct evidence.

During orchestration each scope has one writer, workers cannot delegate recursively. Freeze candidate before independent review.
