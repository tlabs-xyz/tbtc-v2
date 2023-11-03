# Interface: RedemptionRequest

Represents a redemption request.

## Table of contents

### Properties

- [redeemer](RedemptionRequest.md#redeemer)
- [redeemerOutputScript](RedemptionRequest.md#redeemeroutputscript)
- [requestedAmount](RedemptionRequest.md#requestedamount)
- [requestedAt](RedemptionRequest.md#requestedat)
- [treasuryFee](RedemptionRequest.md#treasuryfee)
- [txMaxFee](RedemptionRequest.md#txmaxfee)

## Properties

### redeemer

• **redeemer**: [`ChainIdentifier`](ChainIdentifier.md)

On-chain identifier of the redeemer.

#### Defined in

[lib/contracts/bridge.ts:296](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L296)

___

### redeemerOutputScript

• **redeemerOutputScript**: [`Hex`](../classes/Hex.md)

The output script the redeemed Bitcoin funds are locked to. It is not
prepended with length.

#### Defined in

[lib/contracts/bridge.ts:302](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L302)

___

### requestedAmount

• **requestedAmount**: `BigNumber`

The amount of Bitcoins in satoshis that is requested to be redeemed.
The actual value of the output in the Bitcoin transaction will be decreased
by the sum of the fee share and the treasury fee for this particular output.

#### Defined in

[lib/contracts/bridge.ts:309](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L309)

___

### requestedAt

• **requestedAt**: `number`

UNIX timestamp the request was created at.

#### Defined in

[lib/contracts/bridge.ts:328](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L328)

___

### treasuryFee

• **treasuryFee**: `BigNumber`

The amount of Bitcoins in satoshis that is subtracted from the amount of
the redemption request and used to pay the treasury fee.
The value should be exactly equal to the value of treasury fee in the Bridge
on-chain contract at the time the redemption request was made.

#### Defined in

[lib/contracts/bridge.ts:317](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L317)

___

### txMaxFee

• **txMaxFee**: `BigNumber`

The maximum amount of Bitcoins in satoshis that can be subtracted from the
redemption's `requestedAmount` to pay the transaction network fee.

#### Defined in

[lib/contracts/bridge.ts:323](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L323)
