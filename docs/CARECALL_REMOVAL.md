# CareCall contour removal

Mercy intentionally does not own professional or medical provider workflows.

The former experimental specialist contour is removed by migration `20260916094500_remove_specialist_directory.sql`.
Historical migrations remain in the repository only so a clean database replay can reproduce schema history deterministically before the removal migration runs.

Before preparing this change, Mercy-prod was checked and contained zero rows in `specialist_profiles`, `qualification_documents`, `qualification_requirements`, `specialist_status_events`, and zero objects in the `qualification-documents` storage bucket.

Future medical/provider features belong to a separate product and must not be reintroduced into Mercy without an explicit product-boundary decision.
