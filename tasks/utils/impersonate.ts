import { Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

export async function impersonate(
  hre: HardhatRuntimeEnvironment,
  toImpersonate: string,
  action: (signer: Signer) => Promise<void>) {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [toImpersonate],
  });
  await hre.network.provider.send('hardhat_setBalance', [toImpersonate, '0xDE0B6B3A7640000']); // 1 eth
  const impersonatedSigner = await hre.ethers.getSigner(toImpersonate);

  await action(impersonatedSigner);

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [toImpersonate],
  });
}
