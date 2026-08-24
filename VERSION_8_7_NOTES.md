# VERSION 8.7 — Render stability fix

This build addresses Render worker exits with code 139 (SIGSEGV) seen during file processing.

Changes:
- Pin Python to 3.12.8.
- Pin NumPy to 2.2.6 for a stable binary wheel with pandas 2.3.1.
- Limit OpenBLAS/OMP/MKL/NumExpr to one native thread.
- Reduce Gunicorn gthread concurrency from 8 threads to 2.
- Increase request timeout to 180 seconds for larger spreadsheet uploads.
- No analytics logic, county metrics, REF upsert logic, point controls, market analytics,
  or marketing-card behavior was removed.

If Render has a custom Start Command configured in its dashboard, replace it with the
command in Procfile or clear the custom command so Procfile is used.
