import BigNumber from 'bignumber.js'

// #region Maker
export interface CDPInfo {
  id: number
  ilk: string
  urn: string
}

export interface VaultInfo {
  coll: BigNumber
  debt: BigNumber
}
// #endregion

// #region 1inch
export interface OneInchBaseResponse {
  toTokenAmount: string
  fromTokenAmount: string
}

export interface OneInchSwapResponse extends OneInchBaseResponse {
  tx: {
    from: string
    to: string
    data: string
    value: string
    gasPrice: string
  }
}
// #endregion
