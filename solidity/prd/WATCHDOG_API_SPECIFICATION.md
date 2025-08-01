# Watchdog REST API Specification

**Document Version**: 1.0  
**Date**: 2025-08-01  
**Purpose**: Define the REST API interface for QC-Watchdog interactions  
**Status**: Specification

---

## Overview

Each QCWatchdog operates a REST API that allows Qualified Custodians (QCs) to request services directly. This eliminates the complexity of multiple watchdogs competing for the same operations and provides clear accountability.

## Authentication

All API endpoints require bearer token authentication:

```
Authorization: Bearer <QC_API_TOKEN>
```

Tokens are issued during QC onboarding and map to specific QC addresses.

## API Endpoints

### 1. Wallet Registration

**Endpoint**: `POST /api/v1/wallet/register`

**Purpose**: Request registration of a new Bitcoin wallet after QC has sent the OP_RETURN transaction

**Flow**:
1. QC sends Bitcoin transaction with OP_RETURN containing challenge hash
2. QC calls this API endpoint to notify watchdog
3. Watchdog independently verifies the Bitcoin transaction
4. Watchdog cross-checks QC-provided data with blockchain data
5. If valid, watchdog submits on-chain registration

**Request Body**:
```json
{
  "qcAddress": "0x1234567890123456789012345678901234567890",
  "btcAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "spvProof": {
    "txInfo": {
      "version": "0x01000000",
      "inputVector": "0x...",
      "outputVector": "0x...",
      "locktime": "0x00000000"
    },
    "proof": {
      "merkleProof": "0x...",
      "txIndexInBlock": 42,
      "bitcoinHeaders": "0x..."
    },
    "challengeHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
  }
}
```

**Response (Success - 200)**:
```json
{
  "status": "success",
  "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "btcAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Response (Error - 400/409)**:
```json
{
  "status": "error",
  "code": "WALLET_ALREADY_REGISTERED",
  "message": "Wallet bc1qxy... is already registered for this QC",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Error Codes**:
- `TRANSACTION_NOT_FOUND` - Bitcoin transaction not found or not confirmed
- `INVALID_SPV_PROOF` - SPV proof validation failed
- `TRANSACTION_MISMATCH` - QC-provided data doesn't match blockchain data
- `WALLET_ALREADY_REGISTERED` - Wallet already registered
- `QC_NOT_ACTIVE` - QC status is not Active
- `INSUFFICIENT_GAS` - Watchdog wallet has insufficient ETH

### 2. Reserve Attestation

**Endpoint**: `POST /api/v1/reserves/attest`

**Purpose**: Submit reserve balance attestation

**Request Body**:
```json
{
  "qcAddress": "0x1234567890123456789012345678901234567890",
  "balance": "1000000000000",
  "attestationData": {
    "timestamp": "2025-01-15T10:00:00Z",
    "wallets": [
      {
        "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        "balance": "500000000000"
      },
      {
        "address": "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "balance": "500000000000"
      }
    ],
    "signature": "0x..."
  }
}
```

**Response (Success - 200)**:
```json
{
  "status": "success",
  "transactionHash": "0xdef4567890abcdef4567890abcdef4567890abcdef4567890abcdef4567890ab",
  "attestedBalance": "1000000000000",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 3. Redemption Status Update

**Endpoint**: `POST /api/v1/redemption/fulfill`

**Purpose**: Record redemption fulfillment with SPV proof

**Request Body**:
```json
{
  "redemptionId": "0x9876543210987654321098765432109876543210987654321098765432109876",
  "userBtcAddress": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  "expectedAmount": "99500000",
  "spvProof": {
    "txInfo": {...},
    "proof": {...}
  }
}
```

**Response (Success - 200)**:
```json
{
  "status": "success",
  "transactionHash": "0x3456789012345678901234567890123456789012345678901234567890123456",
  "redemptionId": "0x9876543210987654321098765432109876543210987654321098765432109876",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 4. Health Check

**Endpoint**: `GET /api/v1/health`

**Purpose**: Check API and watchdog status

**Response (Success - 200)**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "watchdogAddress": "0xabcdef1234567890abcdef1234567890abcdef12",
  "ethBalance": "5.234",
  "blockNumber": 19234567,
  "services": {
    "ethereum": "connected",
    "bitcoin": "connected",
    "database": "connected"
  }
}
```

## Error Handling

### Standard Error Response Format

All errors follow this format:

```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human readable error message",
  "details": {
    // Optional additional context
  },
  "timestamp": "2025-01-15T10:30:00Z",
  "requestId": "req_1234567890"
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (valid token but insufficient permissions)
- `409` - Conflict (e.g., wallet already registered)
- `429` - Rate Limited
- `500` - Internal Server Error
- `503` - Service Unavailable

## Rate Limiting

- Per QC: 100 requests per minute
- Burst allowance: 20 requests
- Headers returned:
  - `X-RateLimit-Limit: 100`
  - `X-RateLimit-Remaining: 95`
  - `X-RateLimit-Reset: 1642248000`

## Security Considerations

1. **TLS Required**: All connections must use HTTPS
2. **Token Rotation**: API tokens should be rotated quarterly
3. **IP Allowlisting**: Optional IP-based access control
4. **Request Signing**: Critical operations may require request signing
5. **Audit Logging**: All API calls are logged for compliance

## Implementation Notes

### Watchdog Server Architecture

```
┌─────────────────┐
│   REST API      │ ← HTTPS requests from QCs
├─────────────────┤
│ Authentication  │ ← Bearer token validation
├─────────────────┤
│ Rate Limiting   │ ← Per-QC limits
├─────────────────┤
│ Request Handler │ ← Business logic
├─────────────────┤
│ Web3 Service    │ ← Ethereum interaction
├─────────────────┤
│ QCWatchdog.sol  │ ← On-chain contract
└─────────────────┘
```

### Transaction Management

- Watchdog maintains a pool of funded wallets for gas
- Nonce management prevents transaction conflicts  
- Failed transactions are retried with exponential backoff
- Transaction status webhook callbacks available

### Monitoring & Alerting

Watchdogs should monitor:
- API response times
- Transaction success rates
- Gas price spikes
- Authentication failures
- Rate limit violations

## Migration from Direct Chain Interaction

For QCs currently interacting directly with contracts:

1. Request API credentials from watchdog operator
2. Update integration to use REST API instead of web3 calls
3. Test in staging environment
4. Gradual rollout with fallback options

## Future Enhancements

- WebSocket support for real-time updates
- Batch operations for efficiency
- GraphQL alternative endpoint
- Multi-signature request approval