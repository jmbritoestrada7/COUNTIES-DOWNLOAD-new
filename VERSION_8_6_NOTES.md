# Version 8.6

- Fixes Marketing Activity uploads returning `Unexpected end of JSON input`.
- Marketing upload endpoint now always returns JSON, even on unexpected server-side errors.
- Frontend safely reads text first and reports HTTP/server errors instead of crashing on `response.json()`.
- Upload limit raised from 20 MB to 50 MB.
- WebSocket notification failure no longer causes an otherwise successful marketing upload to fail.
