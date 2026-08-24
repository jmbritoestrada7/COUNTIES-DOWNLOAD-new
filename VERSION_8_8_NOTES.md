# VERSION 8.8 — Safe Marketing Import / Render code 139 isolation

This build specifically addresses Render worker code 139 during Marketing Activity uploads.

Changes:
- Marketing Activity CSV/XLSX parsing no longer uses pandas or NumPy.
- XLSX/XLSM is streamed using openpyxl read_only=True.
- CSV is streamed using Python's csv module.
- Date/count parsing for marketing is pure Python.
- Gunicorn changed to one sync worker (no threaded request concurrency).
- Upload phase markers are written to Render logs:
  MARKETING_UPLOAD phase=save_file
  MARKETING_UPLOAD phase=parse_start
  MARKETING_UPLOAD phase=parse_done
  MARKETING_UPLOAD phase=load_existing_done
  MARKETING_UPLOAD phase=save_activity_done
  MARKETING_UPLOAD phase=merge_counties_done
  MARKETING_UPLOAD phase=save_project_start
  MARKETING_UPLOAD phase=save_project_done

If code 139 still occurs, the last MARKETING_UPLOAD phase in Render identifies the exact operation.
Existing map, STR, property analytics, market analytics, point controls, layer order,
marketing metrics, dates, and configurable county cards are preserved.
