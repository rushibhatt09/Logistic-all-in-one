# API Connection Setup

Do not paste private API keys into chat.

Use this folder instead:

1. Copy `api-connections.example.json`.
2. Rename the copy to `api-connections.local.json`.
3. Put your real Shopify, ClickPost, Unicoure, and carrier API details inside `api-connections.local.json`.
4. Restart the dashboard server.

The next implementation step is to wire live sync jobs that read this local file and call the enabled APIs.
