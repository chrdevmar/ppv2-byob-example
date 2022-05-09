import { ethers } from 'ethers';

import { PoolWatcher } from '@tracer-protocol/perpetual-pools-v2-pool-watcher';
import { encodeCommitParams, CommitEnum } from '@tracer-protocol/pools-js'

import {
  LeveragedPool__factory,
  PoolCommitter__factory,
  ERC20__factory,
} from '@tracer-protocol/perpetual-pools-contracts/types'

const nodeUrl = 'wss://rinkeby.arbitrum.io/ws'
const privateKey = 'my_private_key'
const poolAddress = '0x654e7b6A222a79aDeA105f997F3C1D85D20C3B02'
const chainId = '421611'

async function main () {
  try {
    const provider = ethers.getDefaultProvider(nodeUrl);
    // wallet (provider with signing capabilities)
    const wallet = new ethers.Wallet(privateKey, provider);

    // connect to the target pool contract
    const poolInstance = LeveragedPool__factory.connect(poolAddress, provider);

    const [
      settlementTokenAddress,
      poolCommitterAddress
    ] = await Promise.all([
      poolInstance.settlementToken(),
      poolInstance.poolCommitter()
    ])

    // connect to settlement token contract
    // connect as wallet so we can submit transactions
    const settlementToken = ERC20__factory.connect(settlementTokenAddress, wallet);
    const settlementTokenDecimals = await settlementToken.decimals();

    // connect to pool committer with signing capabilities
    const poolCommitter = PoolCommitter__factory.connect(poolCommitterAddress, wallet);

    const allowance = await settlementToken.allowance(wallet.address, poolAddress);
    console.log(`${poolAddress} is approved to spend ${allowance.toString()} settlement token`);

    if(allowance.eq(0)) {
      console.log(`approving settlement token spend for pool ${poolAddress}...`);
      // approve pool to spend (required for minting)
      const approvalAmount = '340282366920938463463374607431768211455'; // max uint
      await settlementToken.approve(poolAddress, approvalAmount)
      console.log(`settlement token spend approved for pool ${poolAddress}`);
    }


    const poolWatcher = new PoolWatcher({
      nodeUrl,
      commitmentWindowBuffer: 30, // calculate pool state 30 seconds before end of window
      chainId,
      poolAddress
    });

    await poolWatcher.initializeWatchedPool();

    poolWatcher.startWatchingPool();

    poolWatcher.on('COMMITMENT_WINDOW_ENDING', async poolState => {
      // only open a position if the skew is sufficiently out of balance either direction

      const payForClaim = false; // whether or not use PPV2 Autoclaim functionality
      const fromAggregateBalance = false; // always pay directly from wallet balance
      const mintAmount = '50' // mint $50 worth at a time
      const formattedMintAmount = ethers.utils.parseUnits(mintAmount, settlementTokenDecimals);
      const { shortMint, longMint } = CommitEnum;

      if(poolState.expectedSkew.gt(1.01)) {
        // there is excess collateral on the long side, increase short position
        const commitParams = encodeCommitParams(payForClaim, fromAggregateBalance, shortMint, formattedMintAmount);

        console.log('performing short mint...')
        await poolCommitter.commit(commitParams);
        console.log('done')
      } else if(poolState.expectedSkew.lt(0.99)) {
        // there is excess collateral on the short side, increase long position
        const commitParams = encodeCommitParams(payForClaim, fromAggregateBalance, longMint, formattedMintAmount);

        console.log('performing long mint...')
        await poolCommitter.commit(commitParams);
        console.log('done')
      } else {
        console.log(`skew is between 0.9 and 1.1 ${poolState.expectedSkew.toNumber()}, not doing anything...`)
      }
    })
  } catch (error) {
    console.error(error)
  }
}

main();