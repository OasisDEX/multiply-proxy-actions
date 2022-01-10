import { ethers } from 'hardhat'

export const MCD_MANAGER_ADDR = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39'

export async function canGenerateDebt(ilkInfo) {
  const vat = await ethers.getContractAt('IVat', '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B')

  const ilkData = await vat.ilks(ilkInfo.ilkBytes)
  const debtCeiling = Math.round(ilkData.line / 1e45)
  const debt = (ilkData.Art / 1e18) * (ilkData.rate / 1e27)

  return debtCeiling > debt + 10000
}

export async function getVaultsForUser(user, makerAddresses) {
  const GetCdps = await ethers.getContractAt('IGetCdps', makerAddresses['GET_CDPS'])

  const vaults = await GetCdps.getCdpsAsc(makerAddresses['CDP_MANAGER'], user)

  return vaults
}

export async function getRatio(mcdView, vaultId) {
  const ratio = await mcdView.getRatio(vaultId)

  return ratio / 1e16
}

export async function getVaultInfoRaw(mcdView, vaultId, ilk) {
  const info = await mcdView.getVaultInfo(vaultId, ilk)
  return {
    coll: info[0].toString(),
    debt: info[1].toString(),
  }
}

export async function getVaultInfo(mcdView, vaultId, ilk) {
  const info = await mcdView.getVaultInfo(vaultId, ilk)
  return {
    coll: parseFloat(ethers.utils.formatUnits(info[0].toString()).toString()),
    debt: parseFloat(ethers.utils.formatUnits(info[1].toString()).toString()),
  }
}
