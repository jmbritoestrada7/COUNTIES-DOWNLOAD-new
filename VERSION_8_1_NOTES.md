# Version 8.1 — REF UPSERT Property Master

- `REF` is now required and is the unique property key.
- Uploading a REF already stored updates that property instead of duplicating it.
- New REF values are inserted; older REF values not present in the new upload remain stored.
- Duplicate REF rows inside one upload collapse to one record (last row wins).
- Missing REF rows are skipped and reported.
- Owner identity remains independent from REF and is built from normalized owner name + mailing address (plus city/state/ZIP safeguards).
- County metrics and points are rebuilt from the complete persistent REF master after every upload.
- The upload status reports New / Updated / Unchanged / Total.
- Property point popups now show REF and APN.
- Duplicating a map copies its property master and point layer when available.
