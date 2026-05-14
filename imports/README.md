# Import Folder

Put CSV or Excel `.xlsx` files here when browser upload does not work.

Use:

```txt
imports/shipments
imports/charges
imports/rate-cards
imports/reference-audits
```

Then double-click:

```txt
import-all-data.bat
```

Busybees shipment files should go in:

```txt
imports/shipments
```

Courier invoice / charge files should go in:

```txt
imports/charges
```

Editable rate cards should go in:

```txt
imports/rate-cards
```

Rate card CSV/XLSX columns:

```txt
carrier,zone,first500Amount,additional500Amount,codFlat,codPercent,taxPercent
Delhivery,C1,30,25,14,1,18
```

Image rate cards are useful for reference, but exact dispute calculation needs CSV/XLSX table data.

Reference audit files should go in:

```txt
imports/reference-audits
```

Add one previous final audit per courier when possible. The app can then copy the exact formulas and column meanings instead of treating image rate cards as estimates.

Note: old `.xls` files should be opened in Excel and saved as `.xlsx` first.
