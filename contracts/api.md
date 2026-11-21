# ShelfSync — API Contract

Version: 1.0

Base URL: `/api`

All API requests and responses use JSON.

## 1. Product Search

`GET /api/products`

Query parameters:
- `q`: Search query (optional)
- `city`: `pune`, `delhi`, or `bengaluru` (required)
- `category`: Product category (optional)
- `minPrice`: Minimum price (optional)
- `maxPrice`: Maximum price (optional)

Response (200):

```json
{
  "products": [
    {
      "id": "prod_001",
      "name": "Wireless Bluetooth Earphones",
      "description": "Noise-isolating wireless earphones",
      "category": "electronics",
      "price": 1999,
      "imageUrl": "/images/earphones.jpg",
      "city": "pune",
      "stock": 1,
      "available": true
    }
  ],
  "total": 1
}
```

Prices are in INR.

## 2. Product Details

`GET /api/products/:id?city=pune`

Response (200): A single product object with the same fields as a product in the search response.

Return HTTP 404 with a standard error response when the product does not exist.

## 3. Place Order

`POST /api/orders`

Request:

```json
{
  "city": "pune",
  "items": [
    {
      "productId": "prod_001",
      "quantity": 1
    }
  ]
}
```

Success response (201):

```json
{
  "success": true,
  "orderId": "ord_001",
  "status": "confirmed",
  "total": 1999
}
```

Insufficient stock response (409):

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock available"
  }
}
```

Checkout requirements:
- PostgreSQL is the source of truth.
- Validate stock inside a database transaction.
- Never allow negative stock.
- Create order, update inventory, and insert outbox events atomically.
- Calculate prices and totals on the server.
- Roll back the entire order if any item is unavailable.

## 4. Order Details

`GET /api/orders/:id`

Response (200):

```json
{
  "id": "ord_001",
  "city": "pune",
  "status": "confirmed",
  "total": 1999,
  "items": [
    {
      "productId": "prod_001",
      "name": "Wireless Bluetooth Earphones",
      "quantity": 1,
      "unitPrice": 1999
    }
  ]
}
```

## 5. Health Check

`GET /api/health`

Response (200):

```json
{
  "status": "ok"
}
```

## 6. Standard Error Format

All API errors must follow:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation"
  }
}
```

## 7. Integration Rules

- Frontend must follow this contract exactly.
- Backend must implement these endpoints and response formats.
- No unapproved API changes.
- Use `VITE_API_BASE_URL` for frontend API configuration.
- Support CORS for the configured frontend origin.
- Frontend may use mock data during development, but the final demo must use real backend responses.