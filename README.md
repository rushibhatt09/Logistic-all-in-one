# Logistics Control Tower

Professional starter for a logistics, shipment tracking, carrier performance, cost validation, and dispute dashboard.

## What This First Version Has

- Backend API using Node.js
- MVC-style folder structure
- Dashboard UI in the browser
- Shipment status aggregation
- Carrier performance table
- RTO and exception signals
- Charge variance validation
- Auto dispute creation
- Audit log foundation
- Mock integration-ready endpoints

## How To Run

Easy way on Windows:

Double-click:

```txt
start-dashboard.bat
```

Manual way:

```bash
node server.js
```

Then open:

```txt
http://localhost:4173
```

## Important API Endpoints

```txt
GET  /api/health
GET  /api/dashboard/summary
GET  /api/shipments
GET  /api/disputes
POST /api/ingest/events
POST /api/charges/validate
```

## Example: Add Tracking Event

```json
{
  "source": "clickpost",
  "sourceEventId": "cp_new_001",
  "awb": "DLV123456789",
  "rawStatus": "Delivered",
  "eventTime": "2026-05-13T16:30:00+05:30",
  "location": "Mumbai",
  "metadata": {
    "hub": "Mumbai Final Mile"
  }
}
```

## Example: Validate Charge

```json
{
  "awb": "DLV123456789",
  "chargeType": "forward",
  "billedAmount": 120,
  "expectedAmount": 78,
  "invoiceId": "INV-002"
}
```

## Next Professional Upgrades

1. Replace JSON storage with PostgreSQL.
2. Add login and role-based access.
3. Connect Shopify webhooks.
4. Connect ClickPost tracking API.
5. Add Unicoure sync.
6. Add carrier invoice upload.
7. Add rate-card engine.
8. Add CSV/JSON audit exports.
9. Add alerting for large variance and stuck shipments.

## Upload Data

Open the app, go to `Integrations`, and use `Upload Data`.

Shipment CSV should include columns like:

```txt
awb,orderId,carrier,status,region,promisedDeliveryDate,actualDeliveryDate,attempts,rto
```

Charges CSV should include columns like:

```txt
awb,invoiceId,chargeType,billedAmount,expectedAmount,billingDate
```

## API Keys

Do not paste private API keys into chat.

Put them in:

```txt
config/api-connections.local.json
```

Start by copying:

```txt
config/api-connections.example.json
```
