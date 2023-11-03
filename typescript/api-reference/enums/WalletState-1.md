# Enumeration: WalletState

## Table of contents

### Enumeration Members

- [Closed](WalletState-1.md#closed)
- [Closing](WalletState-1.md#closing)
- [Live](WalletState-1.md#live)
- [MovingFunds](WalletState-1.md#movingfunds)
- [Terminated](WalletState-1.md#terminated)
- [Unknown](WalletState-1.md#unknown)

## Enumeration Members

### Closed

• **Closed** = ``4``

The wallet finalized the closing period successfully and can no longer perform
any action in the Bridge.

#### Defined in

[lib/contracts/bridge.ts:371](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L371)

___

### Closing

• **Closing** = ``3``

The wallet moved or redeemed all their funds and is in the
losing period where it is still a subject of fraud challenges
and must defend against them.

#### Defined in

[lib/contracts/bridge.ts:366](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L366)

___

### Live

• **Live** = ``1``

The wallet can sweep deposits and accept redemption requests.

#### Defined in

[lib/contracts/bridge.ts:353](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L353)

___

### MovingFunds

• **MovingFunds** = ``2``

The wallet was deemed unhealthy and is expected to move their outstanding
funds to another wallet. The wallet can still fulfill their pending redemption
requests although new redemption requests and new deposit reveals are not
accepted.

#### Defined in

[lib/contracts/bridge.ts:360](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L360)

___

### Terminated

• **Terminated** = ``5``

The wallet committed a fraud that was reported, did not move funds to
another wallet before a timeout, or did not sweep funds moved to if from
another wallet before a timeout. The wallet is blocked and can not perform
any actions in the Bridge.

#### Defined in

[lib/contracts/bridge.ts:378](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L378)

___

### Unknown

• **Unknown** = ``0``

The wallet is unknown to the Bridge.

#### Defined in

[lib/contracts/bridge.ts:349](https://github.com/keep-network/tbtc-v2/blob/main/typescript/src/lib/contracts/bridge.ts#L349)
