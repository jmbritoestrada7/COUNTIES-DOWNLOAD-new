# Permanent County Maps on Render with Cloudflare R2

This version stores every project in Cloudflare R2. County data, notes, priorities, assignments, review dates, and drawn polygons remain available even when Render restarts or redeploys the service.

## Required Render environment variables

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME=banapropertiesmap`
- `SECRET_KEY` (keep the existing Flask value)

Optional:

- `R2_PROJECT_PREFIX=projects`
- `R2_ENDPOINT_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

The endpoint variable is optional because the app builds it automatically from `R2_ACCOUNT_ID`.

## Deploy

1. Replace the files in the current GitHub repository with the contents of this folder.
2. Commit and push the changes.
3. Render will redeploy automatically. You can also use **Manual Deploy → Deploy latest commit**.
4. Open the app homepage.
5. Confirm that the green badge says: `Permanent R2 storage is active`.
6. Create a test map, upload an Excel file, copy its link, and open it again after a restart or redeploy.

## Important

Do not place R2 keys inside `app.py` or commit them to GitHub. Keep them only in Render Environment Variables.
